# GAI Caddie

AI-authored, web-based golf yardage book. The strokes-gained engine, in your pocket.

**Phase 0 — skeleton & rails.** A monorepo that boots locally, deploys to Vercel, talks to Postgres, keeps the Anthropic key server-side only, and completes one trivial end-to-end round-trip.

## Layout

```
gai-caddie/
├── apps/web/                # Next.js — on-course reader + prep UI (+ the API routes = Vercel functions)
├── services/api/            # server-side brains: DB client, Anthropic (server-only), the assembler later
├── packages/
│   ├── sg-engine/           # deterministic SG/dispersion/EV math — no I/O, no network
│   ├── caddie-context/      # the 5-layer assembler, tone library, personas
│   └── shared/              # shared types: ConfidenceFlag, the locked layer order
├── courses/                 # hand-authored hole data (numbers, not polygons)
├── docs/                    # decision log mirror
└── tests/                   # the round-trip test + the invariant guards
```

## Quick start (local)

```bash
npm install

# Point at a Postgres. The env file lives in apps/web (Next.js loads it):
cp apps/web/.env.example apps/web/.env.local
# then set DATABASE_URL, e.g.:
#   DATABASE_URL=postgresql://USER@127.0.0.1:5432/gai_caddie
# ANTHROPIC_API_KEY is not needed for the Phase 0 round-trip.

npm run dev          # http://localhost:3000 — click "Ping the backend"
npm test             # round-trip (needs DATABASE_URL) + invariant guards
```

## Deploy (closes the Phase 0 "done when")

1. **Provision Neon** (D2): create a project + database, copy the pooled connection string (`...neon.tech/...?sslmode=require`).
2. **Vercel:** import the repo, set root to the monorepo, add env vars `DATABASE_URL` (and later `ANTHROPIC_API_KEY`) as **server-side** (no `NEXT_PUBLIC_`), deploy.
3. Open the deployment, click **Ping the backend** → a `hello` round-trips through the Vercel function and Postgres. Done.

## The invariants

See `CLAUDE.md`. The short version: math in code (never the LLM); confidence flags propagate; the API key is server-side only; the LLM never invents URLs; the five layers compose in order with accuracy winning; the personas are locked. `npm test` guards them.
