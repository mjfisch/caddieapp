# services/api — CLAUDE.md

Server-side brains: the caddie assembler entry, SG-engine invocation, ingestion, and data access. Deploys as **Vercel functions** (the Next.js routes in `apps/web` are thin wrappers that call into here).

- **Secrets rule (invariant #3):** `ANTHROPIC_API_KEY` and `DATABASE_URL` are read here, server-side only. Every module imports `server-only`. Never a `NEXT_PUBLIC_` prefix.
- **No LLM math (invariant #1):** when the first real caddie call is wired, the model narrates numbers from `@gai/sg-engine`; it does not compute them.
- **No LLM-invented URLs (invariant #4):** resource links come from the curated library or a real server-side `web_search`.
- Postgres via `pg` (D2 = Neon; provider-agnostic connection string). No PostGIS.
