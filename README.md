# Capt. 69 OS

Personal golf practice and stats app — practice logging, drill blocks, the bag, rounds. Built for the next 69.

*Capt. 69 is Michael's nickname (he shot 69). The Captain 69 persona predates the brand and is unchanged — Rain Man remains the default coach voice. Formerly GAI Caddie; see D17 in `docs/DECISIONS.md`.*

Next.js on Vercel, Postgres on Neon. No native app, no PostGIS, no live GPS, no polygons (see `CLAUDE.md`).

## The app today

Bottom nav is **Plan · Stats · Practice · Bag** (D20; defined in `apps/web/src/app/_nav/tabs.ts`). Home (`/`) is not a tab.

- **Home** (`/`) — the handicap index (WHS over stored differentials, D29; "HCP —" under 3 rounds) and cards into Stats and Practice.
- **Plan** (`/courses`) — course list → per-hole pages with the strategy panel (SG engine picks, the model narrates). The D19 pivot to a coaching surface is decided but not built yet.
- **Stats** (`/stats`) — read-only record behind a ROUNDS · PRACTICE toggle (D25, D28). No narrative or coaching copy.
- **Practice** (`/practice`) — log sessions (drill blocks with metrics, clubs used), browse the log, and get a streamed coach plan whose drill links come from the curated drill library.
- **Bag** (`/bag`) — every club with carry, dispersion and its `measured | partial | seeded` flag, plus Club Confidence (D26). Display only.
- **Unlock** (`/unlock`) — enter the write key once per device (see Write lock).

## Layout

The repo folder is `caddieapp`; the root package and the `@gai/*` workspaces keep their GAI Caddie names on purpose (D17).

```
caddieapp/
├── apps/web/                  # @gai/web — Next.js UI + API routes (thin wrappers = Vercel functions)
│   └── src/middleware.ts      #   the write lock
├── services/api/              # @gai/api — server-only: DB, migrations, round sync, Anthropic, practice, stats
│   ├── src/migrations/        #   NNN_name.sql
│   └── scripts/               #   manifest generators (migrations, rounds)
├── packages/
│   ├── sg-engine/             # @gai/sg-engine — deterministic SG/dispersion/EV + handicap math; no I/O
│   ├── caddie-context/        # @gai/caddie-context — the 5-layer assembler, tone library, personas
│   └── shared/                # @gai/shared — ConfidenceFlag, the locked layer order
├── data/rounds/               # one JSON payload per round (D22)
├── courses/                   # hand-authored hole data (numbers, not polygons)
├── docs/                      # DECISIONS.md + design specs
└── tests/                     # Vitest: unit, invariant guards, DB-gated round-trips
```

## How data gets in

There are no in-app import flows (D21).

- **Rounds — data-as-code (D22).** Each round is a file in `data/rounds/` (`YYYY-MM-DD_slug.json`), produced outside the app and landed by PR. At build, `services/api/scripts/generate-rounds-manifest.mjs` embeds them into `services/api/src/rounds.generated.ts`; on the first DB request the idempotent sync imports new rounds (keyed on `external_key`) and fails loudly on a malformed payload. Differentials are stored, never computed in-app (D23). Rounds are never deleted (D24).
- **Practice** — logged in the Practice tab (needs the write key).
- **The bag is hand-loaded.** Shot and dispersion data was loaded by running one-off server-side scripts by hand against the database: the Trackman CSV importer (`services/api/src/importer.ts`) and the seed/promote script (`services/api/src/seedDispersion.ts`, reading `handicap_dispersion_seed.md`). Nothing in the app writes bag data.

## Migrations

SQL lives in `services/api/src/migrations/` (`001_…` through `015_…`; **next free number: `016`**). The app applies pending migrations itself on the first DB-backed request (`runMigrations()` in `services/api/src/db.ts`, run before the round sync), each once, in its own transaction, recorded in `_migrations`.

The runner reads the generated manifest `services/api/src/migrations.generated.ts`, not the filesystem. It is checked in and regenerated automatically by the `apps/web` prebuild step; after adding a migration, regenerate it yourself:

```bash
node services/api/scripts/generate-migrations-manifest.mjs
node services/api/scripts/generate-rounds-manifest.mjs   # same, after adding a round
```

`tests/migration-manifest.test.ts` and `tests/rounds-manifest.test.ts` fail if either manifest is stale.

## Write lock

Reads are public. Every non-GET call to `/api/*` (except `/api/unlock` and `/api/health`) needs the server-side env var `CAPT69_WRITE_KEY`, sent as the `x-capt69-key` header or via the httpOnly cookie that `/unlock` (`POST /api/unlock`) sets for a year. If `CAPT69_WRITE_KEY` is unset, all writes are refused (fails closed).

## Quick start (local)

```bash
npm install

# The env file lives in apps/web (Next.js loads it):
cp apps/web/.env.example apps/web/.env.local
# then set DATABASE_URL (any Postgres). ANTHROPIC_API_KEY is needed for the
# coach and strategy panel; CAPT69_WRITE_KEY for any write. All server-side only.

npm run dev          # http://localhost:3000
npm run build        # regenerates both manifests (prebuild), then next build
```

## Tests

```bash
npm test                 # vitest run — everything
npm run test:invariants  # the invariant guards
npm run test:roundtrip   # client → server → Postgres → back
```

Pure tests (engine, stats compute, manifests, nav, write lock, invariants) always run. Tests that touch Postgres use `skipIf(!DATABASE_URL)` and report as skipped without one. `tests/setup.env.ts` loads `apps/web/.env.local` into the test process, so setting `DATABASE_URL` there (or in the shell, which wins) enables them. Point it at a disposable database, never production: the DB tests run migrations and write rows.

## Deploy

1. **Provision Neon** (D2): create a project + database, copy the pooled connection string (`...neon.tech/...?sslmode=require`).
2. **Vercel:** import the repo, set root to the monorepo, add env vars `DATABASE_URL`, `ANTHROPIC_API_KEY` and `CAPT69_WRITE_KEY` as **server-side** (no `NEXT_PUBLIC_`), deploy.
3. Open `/api/health` on the deployment → `{ "ok": true, … }` means migrations, the round sync and the Postgres round-trip all worked.

### Preview database

Preview deployments use the persistent Neon branch `preview`, never production (D30); the app runs pending migrations on first request, so a migration PR's preview applies them only to `preview`. To refresh it from production:

```bash
npx neonctl branches reset preview --parent --project-id holy-salad-20902185
```

This resets `preview` to production's current state and discards everything on it, including preview-only migrations. Re-open the preview to re-apply them.

## Decisions and invariants

- `docs/DECISIONS.md` — the decision log, numbered in order (new entries go at the end; take the next number after the last entry). Anything that changes a locked choice needs an entry there.
- `CLAUDE.md` (root + per-package) — the invariants. The short version: math in code (never the LLM); confidence flags propagate; the API key is server-side only; the LLM never invents URLs; the five layers compose in order with accuracy winning; the personas are locked. `npm test` guards them.
