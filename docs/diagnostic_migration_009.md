# Diagnostic — migration 009 not applied to production

*READ-ONLY code trace. No fix applied. Records the actual code paths behind "deployment 5kUuZixxt (commit 7d88be7) is live and serving 200s, but `_migrations` on production Neon tops out at 008 (applied 2026-06-06); 009 was never recorded."*

*Trace date: 2026-07-08. Every code fact below is quoted with file:line. Where a conclusion needs runtime/Vercel/DB access I don't have this session, it is labelled **[needs confirmation]** rather than asserted.*

---

## TL;DR

Nothing in the codebase *guarantees* a migration is applied on deploy. There is **no CI step, no build step, and no `postbuild`/`predeploy` hook that runs migrations** (root `package.json` `build` is just `next build`; there is no `.github/workflows/`). Migrations reach the DB by exactly two routes:

1. **Out-of-band from dev** — running the DB-backed test suite or a seed CLI locally with `DATABASE_URL` pointed at production Neon. This is the path `db.ts` itself calls the intended one ("migrated out-of-band against the shared Neon DB from local dev").
2. **Runtime self-migration (best-effort fallback)** — `runMigrations()` invoked inside a DB-backed route on a cold start. By design this path **skips silently and returns cleanly if it can't find the `.sql` files** — it never fails the request and logs at most a single `console.warn` per cold start.

The single most likely cause, consistent with **every** stated fact (200s, no error/warn observed, `_migrations` stuck at 008): **008 was applied by the out-of-band dev flow on 2026-06-06, and that same flow has simply not been re-run against production since 009 landed today. The runtime fallback is not picking up the slack** — either because it is hitting its silent file-discovery skip (§3/§5) or because no cold start has forced it during observation (§5). No code bug is required for this to be true; the design deliberately does not self-apply on deploy.

Secondary hypotheses that a code trace cannot rule out without runtime access are in §6.

---

## 1. `applyMigrations()` / `runMigrations()` — exact implementation (`services/api/src/db.ts`)

### Discovery — how it finds migration files
`db.ts:32`
```js
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");
```
The directory is computed **relative to the db module's own resolved location at runtime** (`import.meta.url`), + `"migrations"`. It is NOT an absolute repo path. This matters under bundling — see §3.

`db.ts:64-78`
```js
let files: string[];
try {
  files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filename order: 001_… before 002_…
} catch (err) {
  if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
    console.warn(
      `[db] migrations dir not found at ${MIGRATIONS_DIR}; assuming the DB is migrated out-of-band (bundled runtime). Skipping.`,
    );
    return;                       // <-- SILENT, CLEAN skip: no throw, no migration applied
  }
  throw err;
}
if (files.length === 0) return;
```
**Critical behavior:** if `readdirSync(MIGRATIONS_DIR)` throws `ENOENT` (directory not present at the resolved path), the function **logs one `console.warn` and returns normally** — applying nothing, throwing nothing. The caller sees a resolved promise, identical to a successful "everything already applied" run. This is exactly how the app can serve 200s while zero migrations run.

### "Already applied" decision — reads `_migrations`
`db.ts:98-110`
```js
await client.query(`
  CREATE TABLE IF NOT EXISTS _migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
`);

for (const filename of files) {
  const { rowCount } = await client.query(
    "SELECT 1 FROM _migrations WHERE filename = $1",
    [filename]
  );
  if (rowCount) continue;         // already applied — skip
  ...
```
The comparison is an **exact string match on the full filename** (e.g. `009_practice_redesign_schema.sql`) against `_migrations.filename` (PRIMARY KEY). A file is applied iff no row with that exact filename exists. After running a file it records it (`db.ts:118-121`) with `INSERT ... ON CONFLICT (filename) DO NOTHING`.

So for 009 to be recorded, the loop must (a) *see* the file in `files`, and (b) *reach and run* `client.query(sql)` for it without the transaction rolling back.

### try/catch — re-throws or swallows?
Two distinct catches, opposite behaviors:
- **File-discovery catch (`db.ts:69-77`)** — swallows `ENOENT` (returns cleanly); re-throws any other fs error.
- **Apply-transaction catch (`db.ts:125-133`)**:
```js
} catch (err) {
  try { await client.query("ROLLBACK"); } catch { /* ... */ }
  throw new Error(
    `migration ${current} failed: ${err instanceof Error ? err.message : String(err)}`
  );
}
```
If a migration *body* throws, the whole transaction **rolls back and the error re-throws**. `runMigrations()` (`db.ts:41-49`) then clears its memo and rejects, so the calling route's `catch` runs. **Implication:** had 009 been found and executed but failed, the route would have returned **500 and logged an error** — which is NOT what's observed (200, no error). This substantially rules out "009 ran and threw." It points instead at 009 **never being reached** (discovery skip / different applier), not 009 failing.

### Logging — and whether it reaches Vercel
- Success path: **logs nothing.** No `console.log` on a successful apply or on "all already applied."
- ENOENT skip: one `console.warn` (`db.ts:71`) — Vercel *does* capture `console.warn` (stderr) in runtime logs, **but only when the code path executes**, i.e. at most once per cold start (see §5).
- Failure path: no log in `db.ts` itself (it throws a plain `Error`); the *route* logs via `console.error` (`route.ts:21`/`:46`).

---

## 2. `runMigrations()` is called in the practice route — exact call sites

`apps/web/src/app/api/practice/sessions/route.ts`
- GET, `route.ts:16-18`:
```js
try {
  await runMigrations();
  const sessions = await listPracticeSessions();
```
- POST, `route.ts:38-40`:
```js
try {
  await runMigrations();
  const { id } = await createPracticeSession(body as CreatePracticeSessionInput);
```
Both handlers `await runMigrations()` before touching the DB, inside a try that `console.error`s and returns 500 on any throw (`route.ts:20-23`, `:42-48`). Route is `export const runtime = "nodejs"` + `force-dynamic` (`route.ts:11-12`). Confirmed: the route DOES call the migrator. (As the diagnostic brief notes, `listPracticeSessions` only reads `practice_session` + `practice_focus` — both created by 005 — so its 200 says nothing about whether 009 ran.)

---

## 3. 009's filename / location vs 005–008 — any discovery-skip difference?

**No difference that would cause a skip.** Directory listing:
```
005_phase45_practice.sql   006_drill_seed.sql   007_phase5_rounds.sql
008_round_is_test.sql      009_practice_redesign_schema.sql
```
All in `services/api/src/migrations/`, all `NNN_description.sql`, all `.sql`. The filter `f.endsWith(".sql")` (`db.ts:67`) accepts 009; the lexicographic `.sort()` (`db.ts:68`) orders `009_…` correctly after `008_…`. 009's file mtime is later (20:06 vs 19:24) only because it was authored later this session — mtime plays no role in discovery or ordering. **If the migrations directory is readable at runtime, 009 is discovered like any other.**

The real discovery risk is not the filename — it's **whether `MIGRATIONS_DIR` resolves to a directory that actually contains the `.sql` files in the deployed function**, which is a bundling concern:

`apps/web/next.config.mjs:1-15`
```js
const nextConfig = {
  transpilePackages: ["@gai/api", "@gai/sg-engine", "@gai/caddie-context", "@gai/shared"],
  outputFileTracingIncludes: {
    "/api/**": ["../../services/api/src/migrations/**"],
    "/play/**": ["../../services/api/src/migrations/**"],
  },
};
```
- `transpilePackages` inlines `@gai/api` (including `db.ts`) into Next's server output. At runtime, `import.meta.url` for the transpiled `db` module therefore resolves to its **bundled location under `.next/server/…`**, so `MIGRATIONS_DIR` = `<that bundled dir>/migrations`.
- `outputFileTracingIncludes` copies the `.sql` files into the `/api/**` and `/play/**` function bundles, but preserves their **monorepo-relative path** (`services/api/src/migrations/*.sql` under the function root).
- **The hazard [needs confirmation]:** these two locations are not obviously the same path. If `<bundled db dir>/migrations` ≠ `<function root>/services/api/src/migrations`, then `readdirSync(MIGRATIONS_DIR)` throws `ENOENT` → the silent skip at `db.ts:70-74` fires → nothing is applied, request still 200s. This is the exact mechanism by which a deploy that *contains* 009 nonetheless never applies it. It applies equally to 005–008, which is consistent with those having been applied out-of-band rather than by the runtime.

This cannot be proven from source alone — it depends on Next 15.1.3's actual bundle layout. It is confirmable read-only by (a) checking the deployed function's file tree for where the `.sql` files landed vs. what `MIGRATIONS_DIR` resolves to, or (b) looking for the `db.ts:71` warn line in cold-start logs (§5). The config *intent* (per the comment at `next.config.mjs:5-9`) is precisely to defend against this, but intent ≠ verified-resolved-path.

---

## 4. Environment-specific `DATABASE_URL` branching — is the runtime hitting a different DB?

**No branching exists in code.** `getPool()` is the only pool factory and reads the connection string unconditionally:

`db.ts:14-22`
```js
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set (see apps/web/.env.example).");
    }
    pool = new pg.Pool({ connectionString, max: 3 });
  }
  return pool;
}
```
- A repo-wide grep found **no** preview-vs-prod switch, no alternate `POSTGRES_URL`/`PGHOST`, no second pool, no `@neondatabase/serverless` branch logic. Every DB-backed test reads the same `process.env.DATABASE_URL` (e.g. `tests/practice-redesign.test.ts:20`).
- Therefore the runtime connects to **whatever `DATABASE_URL` Vercel injects for that environment**. The code cannot itself send production traffic to a different DB.
- **[needs confirmation — config, not code]:** Neon's Vercel integration commonly provisions a **separate branch database for Preview deployments**. If the *Production* environment's `DATABASE_URL` were misconfigured to point at a Neon branch other than the one queried in the SQL editor, the runtime could have applied 009 to that other branch while the queried DB stayed at 008. This is a Vercel/Neon env-var question I can't inspect read-only. It is a real possibility only if the runtime self-migration path is actually working (contra §3); under the leading hypothesis (runtime skips) it's moot.

Decision context worth noting: `docs/DECISIONS.md` D2 mentions Neon "DB branching that maps onto per-phase schema experiments and the prep-vs-read split" — so branch DBs are an intended part of this setup, which is why the "different DB" possibility is worth explicitly confirming rather than dismissing.

---

## 5. Caching / memoization — could a stale "already checked" state skip 009?

Two module-level singletons, both **per-process (per cold start), not global**:

`db.ts:34, 41-49`
```js
let migrationsPromise: Promise<void> | undefined;

export function runMigrations(): Promise<void> {
  if (!migrationsPromise) {
    migrationsPromise = applyMigrations().catch((err) => {
      migrationsPromise = undefined;   // clear on failure so a retry can run
      throw err;
    });
  }
  return migrationsPromise;
}
```
`db.ts:11` — the `pool` singleton is likewise module-level.

Behavior:
- **Within one warm instance:** `applyMigrations()` runs at most once. After it resolves (including the ENOENT *skip*, which resolves successfully), every later `runMigrations()` returns the cached resolved promise and **executes no code and logs nothing.**
- **On failure** the memo is cleared so the next request retries.
- **Across instances:** each Vercel cold start is a fresh module load → `migrationsPromise` is `undefined` again → `applyMigrations()` runs again.

Implications for the observations:
- Memoization **cannot** cause 009 to be permanently skipped: a new cold start always re-attempts. So the memo is not itself the root cause of persistent non-application.
- It **fully explains "zero logged messages" on the observed 200s**: if those requests were served by an already-warmed instance, `runMigrations()` short-circuited silently — the ENOENT `console.warn` (if it fires at all) appears only on the **cold start**, at most once per instance, and could easily be outside the observed log window or already scrolled off. Absence of a warn in a warm-request window is therefore *not* evidence the skip isn't happening.

---

## 6. Ranked causes (all consistent with the stated facts)

| # | Hypothesis | Fits all facts? | Proven from code? | How to confirm (read-only) |
|---|---|---|---|---|
| A | Runtime never applies migrations by design; 001–008 applied out-of-band from dev; the out-of-band step just hasn't been run for 009 yet | Yes | The *absence* of any deploy/CI/build migrate step IS proven (§TL;DR); the "008 came from a dev run" part is inference from `applied_at` 2026-06-06 + `db.ts` comments | Check whether the person who applied 008 has re-run the test/seed suite against prod since 009 landed |
| B | `MIGRATIONS_DIR` (from bundled `import.meta.url`) ≠ traced `.sql` location → `readdirSync` ENOENT → silent skip every cold start | Yes | Mechanism proven (§1, §3); the actual resolved-path mismatch is **[needs confirmation]** | Grep cold-start logs for `[db] migrations dir not found at …`; or inspect the deployed function's file tree |
| C | Production runtime `DATABASE_URL` points at a different Neon branch than the queried DB (009 applied elsewhere) | Only if runtime self-migration actually works (contra B) | Code has no branching (§4, proven); the env-var target is **[needs confirmation]** | Compare the `DATABASE_URL` host in Vercel's Production env against the SQL-editor connection; check the other branch's `_migrations` |
| — | 009 ran on the runtime and threw | **No** — would have produced a 500 + `console.error` (§1 apply-catch, §2 route-catch); observed 200 + no error contradicts it | Ruled out from code | — |

**Most probable:** A (optionally *because of* B — i.e. the runtime fallback is silently skipping, so out-of-band is the only real applier and it hasn't been run for 009). Both require no schema/code change to 009 itself; the migration file is well-formed and would apply on any path that actually reaches `client.query(sql)`.

---

## 7. What this diagnostic did NOT do
- Did not connect to any database (no `DATABASE_URL` this session).
- Did not read Vercel build logs, the deployed function's file tree, or the Production env vars (no access this session) — every item depending on those is marked **[needs confirmation]**.
- Did not modify `db.ts`, `next.config.mjs`, the migration, or anything else. No fix applied — the fix is a joint decision once the cause among A/B/C is confirmed by the read-only checks in §6.
