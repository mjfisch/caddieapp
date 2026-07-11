import "server-only";
import type pg from "pg";
import { getPool, runMigrations } from "./db";
import { ROUND_FILES, type RoundFile } from "./rounds.generated";
import { validateRoundPayload, type RoundPayload } from "./roundPayload";

// =============================================================
// Mission S4 — the D22 data-as-code round sync.
//
// The runtime half of the manifest pattern: rounds live in the repo as
// data/rounds/*.json, embedded at build time into rounds.generated.ts (the
// exact mirror of migrations.generated.ts), and imported into the database on
// the same first-request path as migrations. syncRounds() is what routes call
// instead of runMigrations() — it awaits runMigrations() first (the schema
// must exist before the sync writes to it), then applies any new rounds.
//
// Discipline (D22, cloned from applyMigrations in db.ts):
//   - Idempotency is keyed on round.external_key (UNIQUE since 012): an
//     already-imported round is skipped SILENTLY — never updated in place,
//     never duplicated. The round table itself is the ledger; no extra state.
//   - Every payload passes the full §3 validator (roundPayload.ts) BEFORE any
//     insert; one malformed file fails the whole pass loudly.
//   - Each new round lands in ONE transaction (course match/seed, tee_box
//     upsert, round, 18 round_hole rows) under the same advisory-xact-lock
//     pattern as migrations — partial failure rolls back the whole round.
//   - An empty manifest throws (build-time generation broke), mirroring the
//     empty-migrations guard.
// =============================================================

let syncPromise: Promise<void> | undefined;

/**
 * Run migrations, then import any new manifested rounds — exactly once per
 * process. Memoized like runMigrations(); a failure clears the memo so the
 * next request retries. This is the DB-readiness entry point for every
 * DB-touching route and server page.
 */
export function syncRounds(): Promise<void> {
  if (!syncPromise) {
    syncPromise = runMigrations()
      .then(() => applyRoundSync())
      .catch((err) => {
        syncPromise = undefined;
        throw err;
      });
  }
  return syncPromise;
}

// Distinct from MIGRATION_LOCK_KEY (778_899) in db.ts — the two runners must
// not contend on the same advisory lock.
const ROUND_SYNC_LOCK_KEY = 778_900;

export type RoundSyncDeps = {
  pool?: pg.Pool;
  /** Override the manifest (tests only); defaults to the build-time ROUND_FILES. */
  rounds?: readonly RoundFile[];
};

/**
 * One unmemoized sync pass over the manifest. Exported for tests (idempotency
 * and rollback proofs need a real second pass); production code goes through
 * syncRounds().
 */
export async function applyRoundSync(deps: RoundSyncDeps = {}): Promise<void> {
  const rounds = deps.rounds ?? ROUND_FILES;

  // An empty manifest can only mean build-time generation broke (or every
  // round was deleted — D24 says they never are). Mirror the migrations guard:
  // loud failure, never a silent no-op.
  if (rounds.length === 0) {
    const msg =
      "[round-sync] rounds manifest is EMPTY — regenerate services/api/src/rounds.generated.ts " +
      "(node services/api/scripts/generate-rounds-manifest.mjs). Refusing to continue.";
    console.error(msg);
    throw new Error(msg);
  }

  // Parse + validate EVERY payload before touching the database: a malformed
  // file in the batch imports nothing (fail loudly, §3). The validator throws
  // RoundPayloadError naming the file and the exact rule.
  const payloads: { filename: string; payload: RoundPayload }[] = rounds.map(
    ({ filename, json }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch (err) {
        throw new Error(
          `round payload ${filename} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return { filename, payload: validateRoundPayload(filename, parsed) };
    },
  );

  const pool = deps.pool ?? getPool();
  const client = await pool.connect();
  try {
    for (const { filename, payload } of payloads) {
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [ROUND_SYNC_LOCK_KEY]);

        // Idempotency check INSIDE the lock (the _migrations-ledger pattern):
        // racing cold-starts serialize here, so a round can never import twice.
        const { rowCount } = await client.query(
          "SELECT 1 FROM round WHERE external_key = $1",
          [payload.external_key],
        );
        if (rowCount) {
          await client.query("COMMIT");
          continue; // already imported — skip SILENTLY (D22)
        }

        await importRound(client, payload);
        await client.query("COMMIT");
        console.log(`[round-sync] imported ${payload.external_key} (18 holes)`);
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* connection already broken — the xact lock drops with it */
        }
        console.error(`[round-sync] ${filename} FAILED:`, err);
        throw new Error(
          `round sync ${filename} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    client.release();
  }
}

/**
 * Write one validated round inside the caller's open transaction:
 * course (match on slug; seed course + 18 holes if absent), tee_box upsert by
 * (course_id, name), then the round row + 18 round_hole rows. RESTRICT
 * direction from S3: the tee_box reference row exists before round.tee_box_id
 * is written, all inside the one transaction.
 *
 * Writes fairway_result ONLY — the deprecated fairway_hit boolean is never
 * read or written here (012).
 */
async function importRound(client: pg.PoolClient, payload: RoundPayload): Promise<void> {
  // ── course: match on slug, else adopt a slug-less name match, else seed ────
  let courseId: string;
  const bySlug = await client.query<{ id: string }>(
    "SELECT id FROM course WHERE slug = $1",
    [payload.course.slug],
  );
  if (bySlug.rows[0]) {
    courseId = bySlug.rows[0].id;
  } else {
    // A pre-sync course may exist by name without a slug (012 backfilled Fox
    // Bend, but be safe for future courses): match, don't duplicate — and set
    // the slug so the next payload matches directly.
    const byName = await client.query<{ id: string }>(
      "SELECT id FROM course WHERE name = $1 AND slug IS NULL",
      [payload.course.name],
    );
    if (byName.rows[0]) {
      courseId = byName.rows[0].id;
      await client.query("UPDATE course SET slug = $2 WHERE id = $1", [
        courseId,
        payload.course.slug,
      ]);
    } else {
      // New course: the payload carries par-per-hole, so seed the course model.
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO course (name, slug) VALUES ($1, $2) RETURNING id",
        [payload.course.name, payload.course.slug],
      );
      courseId = inserted.rows[0]!.id;
      for (const h of payload.holes) {
        await client.query(
          "INSERT INTO hole (course_id, number, par) VALUES ($1, $2, $3)",
          [courseId, h.hole, h.par],
        );
      }
    }
  }

  // ── tee_box: upsert by (course_id, name) — the RESTRICT-direction reference
  // row must exist before the round FK is written.
  let teeBoxId: string;
  const existingTee = await client.query<{ id: string }>(
    "SELECT id FROM tee_box WHERE course_id = $1 AND name = $2",
    [courseId, payload.tee_box.name],
  );
  if (existingTee.rows[0]) {
    teeBoxId = existingTee.rows[0].id;
  } else {
    const insertedTee = await client.query<{ id: string }>(
      `INSERT INTO tee_box (course_id, name, rating, slope, yardage)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        courseId,
        payload.tee_box.name,
        payload.tee_box.rating,
        payload.tee_box.slope,
        payload.tee_box.yardage ?? null,
      ],
    );
    teeBoxId = insertedTee.rows[0]!.id;
  }

  // ── the round + its 18 holes, all in this same transaction ────────────────
  const roundRes = await client.query<{ id: string }>(
    `INSERT INTO round
       (course_id, played_date, tee_set, tee_box_id,
        differential, differential_source, external_key, reflection)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      courseId,
      payload.date,
      payload.tee_box.name.toLowerCase(), // legacy free-text column, kept in step
      teeBoxId,
      payload.score.differential,
      payload.score.differential_source,
      payload.external_key,
      payload.reflection,
    ],
  );
  const roundId = roundRes.rows[0]!.id;

  for (const h of payload.holes) {
    await client.query(
      `INSERT INTO round_hole (round_id, hole_number, strokes, putts, fairway_result, gir)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [roundId, h.hole, h.strokes, h.putts, h.fairway_result, h.gir],
    );
  }
}
