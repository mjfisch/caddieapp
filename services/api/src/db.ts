import "server-only";
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
// Plain .sql files in ./migrations, applied in filename order. Each runs once,
// inside a transaction, and is recorded in _migrations so re-running is a no-op.

// Resolved relative to this module's own location (services/api/src) rather
// than via `new URL(..., import.meta.url)`, which the bundler tries to resolve
// as a static asset and chokes on for a directory.
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

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

async function applyMigrations(): Promise<void> {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filename order: 001_… before 002_…

  for (const filename of files) {
    const { rowCount } = await pool.query(
      "SELECT 1 FROM _migrations WHERE filename = $1",
      [filename]
    );
    if (rowCount) continue; // already applied — skip

    const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(
        `migration ${filename} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      client.release();
    }
  }
}
