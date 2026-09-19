# FINEXA frontend

React + TypeScript + Vite, Tailwind CSS v4, Radix-based shadcn-style components, Lucide icons, Recharts, TanStack Query, React Router.

```bash
cd frontend
npm install
cp .env.example .env        # optional; Windows: copy .env.example .env
npm run dev                 # http://localhost:5173
npm run typecheck           # tsc
npm test                    # vitest
npm run build && npm run preview   # production build on http://localhost:4173
```

`VITE_API_BASE_URL` is the backend **origin** (default `http://localhost:8000`, no `/api/v1`). The backend must list the frontend's origin in `FINEXA_CORS_ORIGINS` (defaults include the Vite dev server `http://localhost:5173` and preview `http://localhost:4173`). Use the same hostname for both (`localhost` with `localhost`) so the session cookie is sent.

## Structure

```
src/api/         typed client (credentials, CSRF, error mapping), endpoint functions, types mirroring docs/openapi.json
src/auth/        AuthProvider (session restore via /auth/me), route guards
src/hooks/       TanStack Query hooks, replay stream hook (cursor polling), debounce
src/lib/         formatting, safe redirect validation, stream merge logic, password rules
src/components/  ui/ (Radix-based primitives), layout/ (app shell), shared/ (badges, states, charts)
src/features/    Analyze drawer, Policy rehearsal
src/pages/       Home, Login, Signup, Overview, Monitor, Investigation, Transaction detail, Patterns, Not found
src/test/        interaction tests (auth flows, stream hook, policy rehearsal, case saving)
```

## Visual system

- **`components/ui/prism-hero.tsx` + `prism-scene.tsx`**: dark cinematic hero. The crystal is a real Three.js / React Three Fiber scene (icosahedron with `MeshTransmissionMaterial`, chromatic aberration, procedural `Lightformer` lighting with no HDR download, drifting motes). The three.js code is a separate lazy chunk that only the homepage loads.
  - *Adaptive quality:* `detectQuality()` picks `high | medium | low` from viewport width, CPU cores, device memory and pointer type; each tier changes DPR, transmission buffer size, samples and mote count.
  - *Rendering budget:* the render loop is `never` while the hero is off-screen or the tab is hidden, and `demand` (one still frame) under `prefers-reduced-motion`.
  - *Failure handling:* no WebGL, or a scene error, falls back to a static SVG crystal via an error boundary. The crystal lives in its own block (below the copy on phones), so it can't cover text or buttons.
- **`components/ui/constellation-grid.tsx`**: canvas node grid with spring physics, pointer repulsion, click shockwaves, periodic radar rings, and coordinate labels near the cursor. Decorative (`aria-hidden`, `pointer-events: none`, listens on `window`). Pauses off-screen and on hidden tabs, caps DPR, paints one still frame under reduced motion, and removes all listeners and frames on unmount. Used on the homepage hero/technology/CTA sections, the auth panel, and the idle Live Monitor empty state. It is deliberately **not** used behind working data screens.
- **Motion** (`motion/react`): page fade, sidebar active indicator, scroll reveals, accordion. `<MotionConfig reducedMotion="user">` wraps the app. CSS covers hover/press states, and a global `prefers-reduced-motion` rule removes decorative movement.
- React is pinned to `~19.2` because `@react-three/fiber` 9.x declares `react <19.3`.

## Design rules that are enforced in code

- Data comes only from API responses. Failures render an error state with retry; nothing is substituted.
- Scores are shown on their native 0-1 scale and labelled "Model risk score" (never "confidence" or a percentage). Missing values render as `n/a`, never `0`.
- Amounts are plain numbers (the dataset has no currency). `Time` is shown as elapsed dataset time (`T+HH:MM:SS`); real processing timestamps are labelled separately.
- Held-out labels are hidden by default and revealed only through explicit, labelled retrospective actions.
- The session cookie is HttpOnly (never readable by JS). The CSRF token is held in memory only. Nothing sensitive is written to localStorage (only the sidebar-collapsed preference).
- Production hosting must rewrite unknown paths to `index.html` (Vite dev/preview already do), otherwise a refresh on `/investigation/TXN-000123` would 404.
