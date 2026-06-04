import "server-only";
import pg from "pg";

// INVARIANT #3 boundary: this module is server-only. The DATABASE_URL (and the
// Anthropic key in anthropic.ts) live exclusively on the server. A client import
// of this file throws at build time via `server-only`.

let pool: pg.Pool | undefined;

/** Lazy singleton pool. D2 = Neon; the connection string carries sslmode for prod. */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set (see .env.example).");
    }
    pool = new pg.Pool({ connectionString, max: 3 });
  }
  return pool;
}
