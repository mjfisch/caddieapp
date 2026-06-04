import "server-only";
import { getPool } from "./db";
import { SG_ENGINE_VERSION } from "@gai/sg-engine";

export interface HealthResult {
  message: string;
  dbTime: string;
  sgEngineVersion: string;
  source: "database";
}

/**
 * Phase 0 round-trip: client -> server (this fn, in a Vercel function) -> Postgres -> back.
 * Idempotently ensures a tiny table, writes one ping, reads the latest back. A genuine
 * write+read proves the DB hop, not just connectivity.
 */
export async function checkHealth(): Promise<HealthResult> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS health_check (
      id BIGSERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query("INSERT INTO health_check (message) VALUES ($1)", ["hello"]);
  const { rows } = await pool.query<{ message: string; created_at: Date }>(
    "SELECT message, created_at FROM health_check ORDER BY id DESC LIMIT 1"
  );
  const row = rows[0];
  if (!row) throw new Error("health_check insert/read returned no row");
  return {
    message: row.message,
    dbTime: new Date(row.created_at).toISOString(),
    sgEngineVersion: SG_ENGINE_VERSION,
    source: "database",
  };
}
