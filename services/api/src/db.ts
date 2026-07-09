import "server-only";
import pg from "pg";
import { MIGRATIONS } from "./migrations.generated";

// INVARIANT #3 boundary: this module is server-only. The DATABASE_URL (and the
// Anthropic key in anthropic.ts) live exclusively on the server. A client import
// of this file throws at build time via `server-only`.

let pool: pg.Pool | undefined;

/** Lazy singleton pool. D2 = Neon; the connection string carries sslmode for prod. */
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

// ── Migrations ────────────────────────────────────────────────────────────
// Migrations are authored as .sql files in ./migrations, but the runner reads
// them from migrations.generated.ts — a build-time manifest that embeds each
// file's content as a string, in filename order. No runtime filesystem reads:
// inside the Vercel serverless bundle the raw files sit at no predictable path,
// and the old readdirSync fallback silently no-oped on ENOENT (mission 2.6 /
// docs/diagnostic_migration_009.md). Each pending file runs once, in its own
// transaction, and is recorded in _migrations so re-running is a no-op.
// Any failure here THROWS — a migration system must never silently skip.

let migrationsPromise: Promise<void> | undefined;

/**
 * Apply any pending SQL migrations, exactly once per process. Memoized so
 * concurrent requests (e.g. the health route on a cold start) share one run;
 * a failure clears the memo so the next request can retry.
 */
export function runMigrations(): Promise<void> {
  if (!migrationsPromise) {
    migrationsPromise = applyMigrations().catch((err) => {
      migrationsPromise = undefined;
      throw err;
    });
  }
  return migrationsPromise;
}

// A fixed, arbitrary key for the migration advisory lock (see applyMigrations).
const MIGRATION_LOCK_KEY = 778_899;

async function applyMigrations(): Promise<void> {
  // An empty manifest can only mean build-time generation broke (or every
  // migration was deleted). Refuse to serve against a DB whose state we can't
  // establish — loud failure, never a silent no-op.
  if (MIGRATIONS.length === 0) {
    const msg =
      "[db] migration manifest is EMPTY — regenerate services/api/src/migrations.generated.ts " +
      "(node services/api/scripts/generate-migrations-manifest.mjs). Refusing to continue.";
    console.error(msg);
    throw new Error(msg);
  }

  // Each transaction (ledger bootstrap, then one per migration file) is guarded
  // by a TRANSACTION-scoped advisory lock. Why:
  //   - The lock serializes concurrent migrators (parallel test workers, concurrent
  //     serverless cold-starts). Without it, two processes racing to create the SAME
  //     brand-new table both run `CREATE TABLE IF NOT EXISTS`, and Postgres' system
  //     catalog is NOT safe under concurrent creation of one relation — the loser
  //     dies on a pg_type duplicate ("pg_type_typname_nsp_index"), which IF NOT
  //     EXISTS cannot prevent.
  //   - pg_advisory_xact_lock (not the session-level pg_advisory_lock) auto-releases
  //     at COMMIT/ROLLBACK *and* if the connection drops. A killed worker therefore
  //     can never leak the lock and wedge every later run — the failure mode a
  //     session lock has.
  //   - One transaction PER FILE (not one for the whole batch) means an already-
  //     committed migration stays applied and recorded even if a later one fails,
  //     and the ledger check runs inside each lock so racing instances can't
  //     double-apply a file.
  const pool = getPool();
  const client = await pool.connect();
  let current = "(pre-flight)";
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query("COMMIT");

    for (const { filename, sql } of MIGRATIONS) {
      current = filename;
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);

      // Exact-filename ledger check, inside the lock: applied iff a row exists.
      // This is what keeps manually-applied migrations (e.g. 009 via the Neon
      // SQL editor) from ever being re-run.
      const { rowCount } = await client.query(
        "SELECT 1 FROM _migrations WHERE filename = $1",
        [filename]
      );
      if (rowCount) {
        await client.query("COMMIT");
        continue;
      }

      await client.query(sql);
      // ON CONFLICT DO NOTHING: belt-and-suspenders alongside the lock above. Every
      // migration body is guarded (IF NOT EXISTS / NOT EXISTS), so a double-apply is
      // harmless — but a plain INSERT here would throw a duplicate-key on _migrations.
      await client.query(
        "INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
        [filename],
      );
      await client.query("COMMIT");
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already broken — the xact lock drops with it */
    }
    console.error(`[db] migration ${current} FAILED:`, err);
    throw new Error(
      `migration ${current} failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    client.release();
  }
}
