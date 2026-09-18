# FINEXA frontend integration guide

Machine-readable contract: [`openapi.json`](openapi.json) (regenerate with `python -m app.export_openapi`; a test fails if it drifts from the code). Interactive docs are served at `/docs` when the API runs.

- **Base URL:** `http://localhost:8000/api/v1` (all paths below are relative to it)
- **Format:** JSON, UTF-8. Timestamps of real events are ISO 8601 UTC with a `Z` suffix (`2026-09-18T18:36:05.640870Z`).
- **Auth:** HttpOnly session cookie + CSRF token (section 2). Everything except `GET /health` and `/auth/*` needs a session. CORS is allow-list based with credentials, see *Environment*.

## 1. Read this first: what the numbers mean

| Field | What it is | What it is **not** |
|---|---|---|
| `score` | Uncalibrated model ranking score in `[0, 1]`. Higher = ranked as more suspicious. | A probability or "% chance of fraud". Calibration was never evaluated. |
| `recommended_action` | `allow` / `review` / `hold`, derived from `score` and the policy thresholds. | A real action. **`hold` is a simulated recommendation; nothing is blocked.** |
| `source_time_seconds` / `source_time_label` | Seconds since the dataset start, and its `T+HH:MM:SS` rendering. | A calendar date or local clock time. |
| `processed_at` | When the backend actually processed an event/request (UTC). | The transaction's source time. |
| `known_outcome` | The dataset's verified label (`fraud` / `legitimate`). | Something the model predicted. Hidden for validation/test rows unless `reveal_outcome=true`. |
| `analyst_assessment` | A human's opinion stored in SQLite. | A dataset label. It never changes labels and is never used for retraining. |
| `V1`–`V28` | Anonymous numeric features. | Anything with business meaning. Do not label them ("location", "device", …). |
| clusters / similar cases | Groups of similar records. | Fraud rings or networks of people. |
| "flagged fraud" | Known fraud that the policy recommended for review or hold. | Verified prevention or recovery. |

**Score presentation.** Show the score as a number `0.00–1.00` (e.g. `0.87`) with the risk band and action, labelled "model score". Do not format it as a percentage or write "probability". Suggested colours: `low` neutral, `medium` amber, `high` red.

**Live vs retrospective.** The live/replay UI must not show `known_outcome`. Retrospective views (model evaluation, policy rehearsal, reveal toggles) may.

**Metric scopes.** Every metrics block carries a `scope`: `historical_dataset` (counts over the whole file), `replay` (what the simulation has processed so far; no labels), `evaluation` (held-out test split), `policy_rehearsal` (chosen split, see `split`), `training_reference` (Pattern Lab, labelled training split). Never mix scopes in one chart without a label.

## 2. Authentication (session cookie + CSRF)

Browser clients must send cookies: `fetch(url, { credentials: "include" })`. The API origin must be in `FINEXA_CORS_ORIGINS` (no wildcard: credentialed CORS needs explicit origins).

| Endpoint | Purpose |
|---|---|
| `POST /auth/signup` `{email, password}` | Create an account and start a session. `201 AuthSession`. Duplicate email → `409 EMAIL_ALREADY_REGISTERED`. |
| `POST /auth/login` `{email, password}` | Start a session. `200 AuthSession`. Wrong credentials → `401 INVALID_CREDENTIALS` (same message for unknown accounts). 5 failures per email+client in 10 minutes → `429 TOO_MANY_ATTEMPTS`. |
| `POST /auth/logout` | End the session (idempotent), clears the cookie. `200 {ok: true}`. |
| `GET /auth/me` | Restore the session on page load. `200 AuthSession`, or `401 UNAUTHENTICATED` (no cookie) / `401 SESSION_EXPIRED` (cookie no longer valid). |

`AuthSession` = `{ user: {id, email, created_at}, csrf_token, expires_at }`.

- The session cookie `finexa_session` is `HttpOnly` and `SameSite=Lax` (`Secure` when `FINEXA_COOKIE_SECURE=true`). It is never readable by JavaScript; do not store it or the password anywhere.
- **CSRF:** every `POST`/`PATCH` to a protected endpoint (and the case `PATCH`) must send `X-CSRF-Token: <csrf_token>` from the latest `AuthSession`. Keep the token in memory only and re-fetch it with `GET /auth/me` after a page refresh. Missing/wrong → `403 CSRF_FAILED`. State-changing requests from an `Origin` that is not allow-listed → `403 ORIGIN_NOT_ALLOWED`.
- Sessions last `FINEXA_SESSION_HOURS` (default 8) from login. Any protected call may return `401 SESSION_EXPIRED`: clear client state and send the user to login.
- Password rules (also enforced on signup): 10-128 characters, at least one letter and one number, not identical to the email. Emails are trimmed and lower-cased. Validation problems come back as `422 VALIDATION_ERROR` with `details[].location` such as `body.password`.
- Auth is checked before readiness: a signed-in user gets `503 MODEL_NOT_READY` when artifacts are missing; a signed-out one gets `401`.
- Analyst notes' `author` defaults to the signed-in user's email when not supplied.

## 3. Errors

Every non-2xx response has this shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.",
             "details": [ { "location": "body.transaction.V3", "message": "Field required", "type": "missing" } ] } }
```

`details` is `[]` unless it is a validation error. Branch on `error.code`:

| HTTP | `code` | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Bad body/query/path (missing/extra fields, wrong types, NaN/Infinity, out of range, malformed transaction id, unknown enum). |
| 422 | `INVALID_TRANSACTION` | Input rejected by the scoring validator. |
| 422 | `INVALID_THRESHOLDS` | Threshold override breaks `0 <= review < hold <= 1`. |
| 422 | `INVALID_FILTER`, `OUTCOME_REVEAL_REQUIRED`, `INVALID_FEATURE`, `INVALID_SPLIT`, `FINAL_EVALUATION_NOT_ACKNOWLEDGED`, `INVALID_SPEED`, `INVALID_CURSOR`, `ASSESSMENT_REQUIRED_TO_CLOSE` | See the relevant endpoint. |
| 401 | `UNAUTHENTICATED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS` | Not signed in / session no longer valid / bad login. |
| 403 | `CSRF_FAILED`, `ORIGIN_NOT_ALLOWED` | Missing CSRF header / disallowed origin. |
| 409 | `EMAIL_ALREADY_REGISTERED` | Signup with an existing email. |
| 429 | `TOO_MANY_ATTEMPTS` | Too many failed logins. |
| 503 | `SERVICE_UNAVAILABLE` | The SQLite database is unavailable. |
| 404 | `TRANSACTION_NOT_FOUND`, `NOT_FOUND` | Unknown reference / unknown route. |
| 409 | `INVALID_STATE_TRANSITION`, `SIMULATION_RESET` | Simulation control / polling conflicts. |
| 503 | `MODEL_NOT_READY` | Artifacts or dataset missing/mismatched. `message` says why. |
| 500 | `INTERNAL_ERROR` | Unexpected. |

Poll `GET /health` on load: it always returns 200, and `ready: false` + `reasons` explains a 503 elsewhere.

## 4. Enums

| Name | Values |
|---|---|
| `risk_band` | `low`, `medium`, `high` |
| `recommended_action` | `allow`, `review`, `hold` (`low→allow`, `medium→review`, `high→hold`) |
| `split` | `train`, `validation`, `test` |
| `known_outcome` | `legitimate`, `fraud` (nullable) |
| `review_status` | `unreviewed`, `in_review`, `closed` |
| `analyst_assessment` | `suspected_fraud`, `likely_legitimate`, `inconclusive` (nullable) |
| simulation `status` | `idle`, `running`, `paused`, `completed` |
| simulation `action` | `start`, `pause`, `resume`, `reset`, `set_speed` |
| list `sort` / `order` | `time`, `amount`, `score` / `asc`, `desc` |
| explanation `status` | `available`, `unavailable` |

Transaction references look like `TXN-000123` (0-based source row position, 6+ digits). Ad-hoc analyses get `ADHOC-<12 hex>` (content hash, not a dataset row).

## 5. Endpoints

### `GET /health`
`{status: "ok"|"degraded", ready, api_version, model_loaded, data_loaded, database_ok, model_version|null, policy_version|null, reasons: string[], checked_at}`.

### `GET /dataset`  ·  scope `historical_dataset`
Fingerprint (SHA-256 of the file), row count, feature list, `class_counts`, per-split counts (`splits.counts.{train,validation,test}`), time/amount stats, `declared_vs_actual` (the supplied file's counts vs. the counts in the project brief, with a note), and the full `data_quality` report (missing/non-finite checks, duplicates, label conflicts, `cleaning_performed`).

### `GET /metrics`
`{historical_dataset, replay, evaluation}` — each with its own `scope`. `replay` has `status`, `processed`, `total`, `by_action`, `by_risk_band` (no labels). `evaluation` is the test-split summary (see below).

### `GET /overview/activity`  ·  scope `historical_dataset`
Server-side aggregate for charts (no rows are sent). Query: `split`, `risk_band`, `action`, `bucket_seconds` (600-86400, default 7200), `reveal_outcome` (default false). Response: `{scope, split|null, bucket_seconds, labels_revealed, buckets: [{start_seconds, end_seconds, label, transactions, by_risk_band: {low, medium, high}, model_flagged, known_fraud|null}], totals: {transactions, by_risk_band, by_action, model_flagged, known_fraud|null}, model_version, policy_version, note}`. `model_flagged` = recommended review or hold (a model output, not a label). `known_fraud` is `null` unless labels are revealed (`reveal_outcome=true` or `split=train`).

### `GET /model/evaluation`  ·  scope `evaluation`
Retrospective, held-out results. Key fields: `model_version`, `selected_model`, `candidates[]` (validation AP/ROC-AUC of each), `selection_rule`, `thresholds {review, hold, selection_rule}`, `average_precision_definition`, `score_note`, `caveat`, `validation` and `test`. Each split block:

```
{ split, rows, fraud, legitimate, evaluation_prevalence, average_precision, roc_auc,
  operating_points: { hold: OP, review: OP },
  always_legitimate_baseline: { confusion_matrix, precision: null, recall: 0, f1: 0, average_precision, roc_auc: 0.5, accuracy_context_only } }
OP = { threshold, flagged, precision|null, recall|null, f1|null, confusion_matrix: {tn, fp, fn, tp} }
```

Metric definitions: **average precision** = step-wise area under the precision–recall curve (no interpolation); a no-skill scorer's AP equals `evaluation_prevalence`. **precision** = tp/(tp+fp), **recall** = tp/(tp+fn), **f1** = 2tp/(2tp+fp+fn); `null` when the denominator is 0. A row is "flagged" at an operating point when `score >= threshold`. **ROC-AUC** is secondary. Lead with average precision, precision/recall and the confusion matrix; show the always-legitimate baseline next to them. Accuracy appears only as `accuracy_context_only` in the baseline block: don't headline it. Always show the `caveat` (stratified historical evaluation ≠ future production performance).

### `GET /transactions`
Query parameters (all optional):

| Param | Type / range | Notes |
|---|---|---|
| `page` | int ≥ 1 (default 1) | |
| `page_size` | 1–200 (default 50) | |
| `split` | enum | |
| `risk_band`, `action` | enum | |
| `min_score`, `max_score` | 0–1 | `min_score <= max_score` |
| `min_amount`, `max_amount` | ≥ 0 | |
| `time_from`, `time_to` | ≥ 0 seconds | dataset-relative, inclusive |
| `review_status` | enum | `unreviewed` = no saved analyst activity or status `unreviewed` |
| `outcome` | `fraud`/`legitimate` | for validation/test rows requires `reveal_outcome=true` (else `422 OUTCOME_REVEAL_REQUIRED`) |
| `reveal_outcome` | bool (default false) | fills `known_outcome` for validation/test rows |
| `sort`, `order` | `time`(default)/`amount`/`score`, `asc`(default)/`desc` | |

Response: `{items: TransactionSummary[], page, page_size, total, total_pages, model_version, policy_version}`. A page past the end returns `items: []`.

`TransactionSummary`: `{transaction_ref, split, source_time_seconds, source_time_label, amount, score, risk_band, recommended_action, known_outcome|null, review_status, analyst_assessment|null}`. Train rows always show `known_outcome` (reference cases); validation/test rows show `null` unless revealed.

### `GET /transactions/{id}`
`TransactionSummary` + `features` (V1–V28 raw values), `model_version`, `policy_version`, `cluster_id|null`. Also accepts `reveal_outcome`. Malformed id → 422, unknown → 404.

### `POST /analyze`
Provide **exactly one** of:

```jsonc
{ "transaction_ref": "TXN-000123" }                      // score a dataset row
{ "transaction": { "Time": 406, "V1": -2.3, /* … V2..V28 … */ "Amount": 0 } }   // ad-hoc: all 30 fields
```
Optional: `include_explanation` (default true), `top_features` (1–30, default 10), `review_threshold`, `hold_threshold` (per-request overrides; validated together with the active values). Unknown fields — including **`Class`** — are rejected with 422. `Time`/`Amount` must be ≥ 0; NaN/Infinity are rejected.

Response: `{transaction_ref, score, risk_band, recommended_action, model_version, policy_version, review_threshold, hold_threshold, explanation, source: "dataset_reference"|"ad_hoc", source_time_seconds, processed_at}`. Pipeline: validate → saved preprocessing → model score → explanation → policy.

### `GET /transactions/{id}/explanation?top_features=10`
Local (per-transaction) contributions:

```
{ transaction_ref, model_version, status, method|null, method_description|null,
  contribution_scale: "log_odds"|null, additive: bool|null, baseline_logit: number|null, logit: number|null,
  contributions: [ { feature, value, contribution, direction } ], unavailable_reason: string|null, note }
```
`contribution > 0` pushes the model log-odds up (`increases_score`). `status: "unavailable"` means no contributions were computed (`contributions: []`, `unavailable_reason` says why): show that state, never invent reasons. Predictions keep working. Methods: `linear_logodds_decomposition` (exact, `additive: true`) or `single_feature_substitution` (approximate, `additive: false`, currently used). Contributions are not global importance.

### `GET /transactions/{id}/similar?k=5`  (`k` 1–25)
Nearest **training** records in standardized V1–V28 + log-Amount space (Time and the label excluded from the distance). `{transaction_ref, reference_set, space, k, neighbors: [{transaction_ref, distance, amount, source_time_seconds, known_outcome, cluster_id|null}], known_fraud_among_neighbors, note}`. Neighbor `known_outcome` is the verified historical label.

### `GET /transactions/{id}/case`  ·  `PATCH /transactions/{id}/case`
GET returns the analyst case (or a default with `persisted: false`):

```
{ transaction_ref, persisted, review_status, analyst_assessment|null, assessed_at|null, closed_at|null,
  created_at|null, updated_at|null, model_version_at_last_update|null, policy_version_at_last_update|null,
  score_at_last_update|null, action_at_last_update|null,
  notes: [{id, note, author|null, created_at, model_version, policy_version}],
  history: [{field, old_value|null, new_value|null, changed_at, model_version, policy_version}],
  current: {score, risk_band, recommended_action, model_version, policy_version} }
```
PATCH body (at least one key; unknown keys rejected):

```json
{ "review_status": "in_review", "analyst_assessment": "suspected_fraud", "note": "Called the merchant", "author": "ana" }
```
- `review_status` cannot be `null`; `analyst_assessment` may be `null` to clear it (omit the key to leave it unchanged).
- `note` is **appended** (notes are never overwritten). `author` (≤ 80 chars) is optional free text; there is no authentication.
- Closing (`review_status: "closed"`) requires an assessment in the same request or already saved, otherwise `422 ASSESSMENT_REQUIRED_TO_CLOSE`.
- Returns the updated case. Each write records the model and policy version in effect.

### Simulation (historical replay)
Replays the held-out **test** split (configurable) in dataset-time order through the real scoring pipeline. Always label it *Historical simulation*.

`GET /simulation[?reveal_outcome=false]` →
`{label, replay_split, status, run_id, speed, base_events_per_second, effective_events_per_second, total, processed, remaining, cursor, started_at|null, updated_at, last_source_time_seconds|null, by_action, by_risk_band, retrospective|null}`. `retrospective` (action × known outcome for processed events) appears only with `reveal_outcome=true`.

`POST /simulation/control` body `{ "action": "start|pause|resume|reset|set_speed", "speed": 20 }`; returns the same state object.
- `speed` is a multiplier (0.1–1000) of `base_events_per_second` (default 5 events/s); optional on `start`/`resume`, required for `set_speed`.
- Transitions: `idle —start→ running ⇄ (pause / resume) paused`; `running → completed` when all rows are processed; `reset` (from any state) → `idle` with a **new `run_id`**. Anything else → `409 INVALID_STATE_TRANSITION` (e.g. `start` when not idle, `pause` when not running).

`GET /simulation/events?cursor=0&limit=100&run_id=…&reveal_outcome=false` →
`{label, run_id, status, events: SimulationEvent[], next_cursor, has_more}`.

`SimulationEvent`: `{event_id, sequence, run_id, transaction_ref, source_time_seconds, source_time_label, processed_at, amount, score, risk_band, recommended_action, model_version, policy_version, known_outcome|null}`. `known_outcome` is `null` unless `reveal_outcome=true`.

**Polling contract**
1. Call `GET /simulation`; remember `run_id`. Start with `cursor=0`.
2. Every 500–1000 ms while `status` is `running`, call `/simulation/events?cursor=<next_cursor>&run_id=<run_id>&limit=100`.
3. Append `events`, set `cursor = next_cursor`. If `has_more` is true, poll again immediately.
4. `event_id` (`evt-000001`) and `sequence` are stable within a run, so de-duplicating by `event_id` is safe. Re-requesting an old cursor returns the same events.
5. `409 SIMULATION_RESET` means the run was reset: clear the UI, re-read `/simulation`, restart at `cursor=0` with the new `run_id`.
6. `cursor` greater than `processed` → `422 INVALID_CURSOR`. Keep polling at a slow rate (or stop) when `status` is `paused`, `idle` or `completed`.
7. Display `processed_at` as the real processing time and `source_time_label` as dataset-relative time; they are different clocks.

### `GET /patterns[?feature=V14]`  ·  scope `training_reference`
`{scope, note, amount_distribution, feature_summary, feature_distribution|null, global_importance, clusters}`.
- `amount_distribution[]`: `{label, lower, upper|null, count, fraud_count, fraud_prevalence|null}`.
- `feature_distribution` (only with `feature`): `{feature, bins: [{lower, upper, legitimate_count, fraud_count}], range_percentiles, note}`. Unknown feature → `422 INVALID_FEATURE`.
- `global_importance`: `{method, computed_on, is_local_explanation: false, note, items: [{feature, importance, signed_coefficient|null, importance_std|null}]}`: about the model overall, not one transaction.
- `clusters`: `{algorithm, k, space, fitted_on, note, items: [{cluster_id, size, share_of_reference, fraud_count, fraud_prevalence, median_amount, mean_amount, low_sample}]}`. Show `size` next to every prevalence; treat `low_sample: true` prevalences as unreliable. Clusters are similar records, not networks.

### `POST /policies/compare`  ·  scope `policy_rehearsal`
```json
{ "policies": [ { "name": "Default", "review_threshold": 0.0107, "hold_threshold": 0.9737, "review_capacity": 25 } ],
  "split": "validation", "batch_size": 10000, "acknowledge_final_evaluation": false }
```
- 1–10 policies; each needs `0 <= review_threshold < hold_threshold <= 1`. `review_capacity` = max review cases **per batch** (`null` = unlimited, `0` = none).
- `batch_size`: rows per batch in dataset-time order (`null` = the whole split is one batch).
- `split`: `validation` (default) is for interactive tuning. `test` is reserved for final evaluation and needs `acknowledge_final_evaluation: true` (else `422 FINAL_EVALUATION_NOT_ACKNOWLEDGED`). `train` is rejected. The response echoes `split` and an `evaluation_split_note`; show it.
- Review candidates in each batch are ranked by descending score; the first `review_capacity` are "within capacity", the rest are **overflow** and are never counted as reviewed. Holds don't use review capacity.

Each result's `metrics`:
```
population   { rows, known_fraud, known_legitimate, fraud_prevalence, fraud_value_total }
alerts       { hold_recommended, review_demand, cases_within_capacity, overflow, allowed, batches, review_capacity_per_batch, batch_size }
known_fraud  { recommended_hold, recommended_review, review_within_capacity, review_overflow, allowed, flagged_total, flagged_share_of_fraud }
known_legitimate { recommended_hold, recommended_review, review_within_capacity, review_overflow, allowed, flagged_total }
fraud_value  { recommended_hold, review_within_capacity, review_overflow, allowed, allowed_or_unreviewed }
flag_precision   // share of flagged (review+hold) that are known fraud; null if nothing flagged
```
Amounts are in the dataset's (unspecified) currency units: show them as plain numbers, not with a currency symbol. `known_*` uses verified labels (retrospective). "Flagged" ≠ prevented or recovered, and analyst review success is not assumed.

## 6. Startup and environment

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate        # Windows; use source .venv/bin/activate elsewhere
pip install -r requirements.txt
python -m app.ml.train                                  # once; needs data/raw/creditcard.csv (~1 min)
uvicorn app.main:app --port 8000
```

The API never trains. Without artifacts it still starts, `GET /health` reports `ready: false`, and other endpoints return `503 MODEL_NOT_READY`.

| Variable | Default | Meaning |
|---|---|---|
| `FINEXA_DATA_PATH` | `data/raw/creditcard.csv` | Dataset (must be the file used in training: SHA-256 is verified at startup). |
| `FINEXA_ARTIFACTS_DIR` | `artifacts/` | Trained model + metadata. |
| `FINEXA_DATABASE_PATH` | `data/finexa.sqlite3` | Analyst cases. |
| `FINEXA_CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173,http://localhost:4173` | Comma-separated allow-list. Add your frontend's origin. |
| `FINEXA_REVIEW_THRESHOLD` / `FINEXA_HOLD_THRESHOLD` | from model metadata | Override active policy thresholds; invalid combos make the service not ready. |
| `FINEXA_EXPLANATIONS_ENABLED` | `true` | `false` → explanations report `unavailable`. |
| `FINEXA_SIM_SPLIT` | `test` | Replay `test`, `validation` or `holdout` (both). |
| `FINEXA_SIM_BASE_EVENTS_PER_SECOND` | `5` | Events/s at speed 1. |
| `FINEXA_SIM_BACKGROUND_TASK` | `true` | Run the replay ticker. |
| `FINEXA_SESSION_HOURS` | `8` | Absolute session lifetime. |
| `FINEXA_COOKIE_SECURE` / `FINEXA_COOKIE_SAMESITE` | `false` / `lax` | Set `Secure` when served over HTTPS; use `none` (with Secure) only for cross-site deployments. |
| `FINEXA_AUTH_REQUIRED` | `true` | `false` disables auth. Automated tests only; never in a shared deployment. |

Allowed methods: `GET`, `POST`, `PATCH`, `OPTIONS`. Startup takes a few seconds (it scores the whole dataset once for browsing and policy rehearsal). Changing thresholds via env restarts the process; `policy_version` (`policy-v1:r<review>:h<hold>`) changes accordingly.
