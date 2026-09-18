"""docs/openapi.json and docs/frontend-integration.md must match the implemented API."""
import json
import re

from app.config import ROOT
from app.export_openapi import build_spec

DOCS = ROOT / "docs"
REQUIRED = [
    ("get", "/api/v1/health"), ("get", "/api/v1/dataset"), ("get", "/api/v1/metrics"),
    ("get", "/api/v1/transactions"), ("get", "/api/v1/transactions/{transaction_id}"),
    ("post", "/api/v1/analyze"), ("get", "/api/v1/transactions/{transaction_id}/explanation"),
    ("get", "/api/v1/transactions/{transaction_id}/similar"),
    ("get", "/api/v1/transactions/{transaction_id}/case"), ("patch", "/api/v1/transactions/{transaction_id}/case"),
    ("get", "/api/v1/simulation"), ("post", "/api/v1/simulation/control"), ("get", "/api/v1/simulation/events"),
    ("get", "/api/v1/patterns"), ("get", "/api/v1/model/evaluation"), ("post", "/api/v1/policies/compare"),
]


def test_all_required_endpoints_exist():
    paths = build_spec()["paths"]
    for method, path in REQUIRED:
        assert method in paths.get(path, {}), f"missing {method.upper()} {path}"


def test_committed_openapi_matches_code():
    committed = json.loads((DOCS / "openapi.json").read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(build_spec())), "docs/openapi.json is stale: run `python -m app.export_openapi`"


def test_integration_doc_covers_every_endpoint_and_error_code():
    text = (DOCS / "frontend-integration.md").read_text(encoding="utf-8")
    for _, path in REQUIRED:
        short = path.replace("/api/v1", "").replace("{transaction_id}", "{id}")
        assert short in text, f"{short} not documented"
    codes = set(re.findall(r'code="([A-Z_]+)"|ApiError\(\s*\d+,\s*"([A-Z_]+)"', "".join(
        p.read_text(encoding="utf-8") for p in (ROOT / "backend" / "app").rglob("*.py")
    )))
    flat = {c for pair in codes for c in pair if c}
    missing = [c for c in flat if c not in text]
    assert not missing, f"error codes not documented: {missing}"
