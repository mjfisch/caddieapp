import "server-only";
import type pg from "pg";
import { assembleRoundRecapPrompt, PERSONA_VOICES } from "@gai/caddie-context";
import { getPool } from "./db";
import { getAnthropic } from "./anthropic";

// =============================================================
// Phase 5 — Round persistence + post-round recap. The OUTPUT side of the loop.
//
// The Next.js routes under apps/web/src/app/api/rounds are THIN wrappers around
// these functions — all DB access, the scoring-weakness aggregation, the Layer-5
// recap prompt assembly, and the Anthropic hop live here, server-side, so the
// secrets never approach the client bundle (invariant #3).
//
// Invariant #1 boundary: every figure the recap LLM sees is computed HERE, in code
// (summarizeRound / computeScoringWeaknesses). The model only narrates them — it
// never recomputes a stat or invents a number. localStorage remains the source of
// truth for the active round UI; this is the persistence + read-back layer.
// =============================================================

/** Reuse the strategy build's pinned Sonnet model; the recap is short and tight. */
export const ROUND_RECAP_MODEL = "claude-sonnet-4-20250514";
export const ROUND_RECAP_MAX_TOKENS = 400;

/**
 * The four scoring benchmarks the recap + ranker measure against. `dir` records
 * whether higher is worse ('bad': three-putts, doubles) or better ('good':
 * scrambling, fairways). A metric only surfaces as a weakness when it is
 * MEANINGFULLY outside its benchmark — 1.3× past it for a bad metric, below 0.7×
 * for a good one (matches the engine ranker's SCORING_GAP_MULTIPLIER).
 */
export const SCORING_BENCHMARKS = {
  three_putt_pct: { benchmark: 6.0, dir: "bad" },
  doubles_per_round: { benchmark: 1.0, dir: "bad" },
  scrambling_pct: { benchmark: 40.0, dir: "good" },
  fairway_pct: { benchmark: 50.0, dir: "good" },
} as const;

const BAD_MULTIPLIER = 1.3;
const GOOD_MULTIPLIER = 0.7;

export type ScoringWeakness = { area: string; value: number; benchmark: number };

/** Carries an HTTP status so a route can map a failure cleanly (mirrors PracticeError). */
export class RoundError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RoundError";
    this.status = status;
  }
}

export type RoundDeps = {
  pool?: pg.Pool;
  /** Yields the recap prose in chunks. Overridden in tests with a fixed string. */
  streamText?: (prompt: string) => AsyncIterable<string>;
};

// ── Create / upsert ─────────────────────────────────────────────────────────

// Server-side mirrors of the 012 DB CHECK lists (Mission S3). These are layer 2
// of the three-layer validation coupling recorded in DECISIONS.md D23 — the
// Claude-side payload schema, this server layer, and the DB CHECKs move
// together. Widen one, widen all.
export const DIFFERENTIAL_SOURCES = ["cdga_posted", "computed_adjusted"] as const;
export type DifferentialSource = (typeof DIFFERENTIAL_SOURCES)[number];

export const FAIRWAY_RESULTS = ["hit", "miss_left", "miss_right"] as const;
export type FairwayResult = (typeof FAIRWAY_RESULTS)[number];

export type CreateRoundInput = {
  courseId: string;
  playedDate: string;
  teeSet?: string | null;
  /** Nullable pending S4: legacy rounds predate tee boxes; the sync requires it. */
  teeBoxId?: string | null;
  /** D23: stored, never computed in-app — arrives on the payload, NOT NULL in the DB. */
  differential: number;
  differentialSource: DifferentialSource;
  /** The D22 sync idempotency key (YYYY-MM-DD_course-slug), UNIQUE NOT NULL. */
  externalKey: string;
  reflection?: string | null;
};

/**
 * Insert a new round row. Returns its id. Validates the FKs + date up front.
 * Moves in lockstep with migration 012 (Mission S3): differential,
 * differential_source, and external_key are NOT NULL, so every writer must
 * supply them — there is no legacy three-field insert path anymore.
 */
export async function createRound(
  input: CreateRoundInput,
  deps: RoundDeps = {},
): Promise<{ roundId: string }> {
  if (!input || typeof input.courseId !== "string" || input.courseId.trim() === "") {
    throw new RoundError(400, "courseId is required");
  }
  if (typeof input.playedDate !== "string" || input.playedDate.trim() === "") {
    throw new RoundError(400, "playedDate is required");
  }
  if (typeof input.differential !== "number" || !Number.isFinite(input.differential)) {
    throw new RoundError(400, "differential must be a finite number");
  }
  if (!DIFFERENTIAL_SOURCES.includes(input.differentialSource)) {
    throw new RoundError(
      400,
      `differentialSource must be one of: ${DIFFERENTIAL_SOURCES.join(", ")}`,
    );
  }
  if (typeof input.externalKey !== "string" || input.externalKey.trim() === "") {
    throw new RoundError(400, "externalKey is required");
  }

  const pool = deps.pool ?? getPool();
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO round
         (course_id, played_date, tee_set, tee_box_id,
          differential, differential_source, external_key, reflection)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.courseId,
        input.playedDate,
        input.teeSet?.trim() || "white",
        input.teeBoxId?.trim() || null,
        input.differential,
        input.differentialSource,
        input.externalKey.trim(),
        input.reflection ?? null,
      ],
    );
    return { roundId: rows[0]!.id };
  } catch (err) {
    // A duplicate external_key is a conflict, not a bad reference — check it
    // before the FK match ("duplicate key … violates unique constraint" would
    // otherwise hit the /violates/ branch below).
    if (err instanceof Error && /duplicate key/i.test(err.message)) {
      throw new RoundError(409, "a round with this externalKey already exists");
    }
    // A bad courseId/teeBoxId trips an FK — surface it as a 400, not a 500.
    if (err instanceof Error && /foreign key|violates/i.test(err.message)) {
      throw new RoundError(400, "unknown courseId or teeBoxId");
    }
    throw new RoundError(
      500,
      `could not create round: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export type UpsertRoundHoleInput = {
  holeNumber: number;
  strokes: number;
  putts?: number | null;
  fairwayHit?: boolean | null;
  gir?: boolean | null;
  penaltyStrokes?: number | null;
  notes?: string | null;
};

/**
 * Upsert one hole's score on (round_id, hole_number). A re-tap UPDATES rather than
 * duplicates (test 2). strokes is required (NOT NULL); the rest are optional.
 */
export async function upsertRoundHole(
  roundId: string,
  input: UpsertRoundHoleInput,
  deps: RoundDeps = {},
): Promise<void> {
  if (typeof roundId !== "string" || roundId.trim() === "") {
    throw new RoundError(400, "roundId is required");
  }
  if (!Number.isInteger(input?.holeNumber)) {
    throw new RoundError(400, "holeNumber must be an integer");
  }
  if (!Number.isInteger(input?.strokes) || input.strokes < 1) {
    throw new RoundError(400, "strokes must be a positive integer");
  }

  const pool = deps.pool ?? getPool();
  try {
    await pool.query(
      `INSERT INTO round_hole
         (round_id, hole_number, strokes, putts, fairway_hit, gir, penalty_strokes, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (round_id, hole_number) DO UPDATE SET
         strokes         = EXCLUDED.strokes,
         putts           = EXCLUDED.putts,
         fairway_hit     = EXCLUDED.fairway_hit,
         gir             = EXCLUDED.gir,
         penalty_strokes = EXCLUDED.penalty_strokes,
         notes           = EXCLUDED.notes`,
      [
        roundId,
        input.holeNumber,
        input.strokes,
        input.putts ?? null,
        input.fairwayHit ?? null,
        input.gir ?? null,
        input.penaltyStrokes ?? 0,
        input.notes ?? null,
      ],
    );
  } catch (err) {
    if (err instanceof Error && /foreign key|violates/i.test(err.message)) {
      throw new RoundError(400, "unknown roundId");
    }
    throw new RoundError(
      500,
      `could not save hole: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export type RoundHoleView = {
  holeNumber: number;
  par: number | null;
  yardageWhite: number | null;
  strokes: number;
  putts: number | null;
  fairwayHit: boolean | null;
  gir: boolean | null;
  penaltyStrokes: number | null;
  notes: string | null;
};

export type RoundDetail = {
  id: string;
  courseId: string;
  courseName: string;
  playedDate: string;
  teeSet: string;
  createdAt: string;
  holes: RoundHoleView[];
};

/**
 * The full round with every saved hole, joined to the course `hole` table so each
 * row carries its par + White yardage (for the scorecard). Holes come back ordered.
 */
export async function getRound(
  roundId: string,
  deps: RoundDeps = {},
): Promise<RoundDetail | null> {
  const pool = deps.pool ?? getPool();

  const { rows: roundRows } = await pool.query<{
    id: string;
    course_id: string;
    course_name: string;
    played_date: string;
    tee_set: string;
    created_at: string;
  }>(
    `SELECT r.id, r.course_id, c.name AS course_name,
            to_char(r.played_date, 'YYYY-MM-DD') AS played_date,
            r.tee_set, r.created_at
       FROM round r
       JOIN course c ON c.id = r.course_id
      WHERE r.id = $1`,
    [roundId],
  );
  const r = roundRows[0];
  if (!r) return null;

  const { rows: holeRows } = await pool.query<{
    hole_number: number;
    par: number | null;
    yardage_white: number | null;
    strokes: number;
    putts: number | null;
    fairway_hit: boolean | null;
    gir: boolean | null;
    penalty_strokes: number | null;
    notes: string | null;
  }>(
    `SELECT rh.hole_number, h.par, h.yardage_white, rh.strokes, rh.putts,
            rh.fairway_hit, rh.gir, rh.penalty_strokes, rh.notes
       FROM round_hole rh
       LEFT JOIN hole h ON h.course_id = $2 AND h.number = rh.hole_number
      WHERE rh.round_id = $1
      ORDER BY rh.hole_number`,
    [roundId, r.course_id],
  );

  return {
    id: r.id,
    courseId: r.course_id,
    courseName: r.course_name,
    playedDate: r.played_date,
    teeSet: r.tee_set,
    createdAt: r.created_at,
    holes: holeRows.map((h) => ({
      holeNumber: h.hole_number,
      par: h.par,
      yardageWhite: h.yardage_white,
      strokes: h.strokes,
      putts: h.putts,
      fairwayHit: h.fairway_hit,
      gir: h.gir,
      penaltyStrokes: h.penalty_strokes,
      notes: h.notes,
    })),
  };
}

export type RoundSummary = {
  id: string;
  playedDate: string;
  totalStrokes: number;
  totalPar: number;
  vsPar: number;
  holesPlayed: number;
  /** Mission 2: a test round is kept in the list but muted from the weakness signal. */
  isTest: boolean;
};

/** All rounds for a course, newest first, each with its total + score vs par. */
export async function listRounds(
  courseId: string,
  deps: RoundDeps = {},
): Promise<RoundSummary[]> {
  if (typeof courseId !== "string" || courseId.trim() === "") {
    throw new RoundError(400, "courseId is required");
  }
  const pool = deps.pool ?? getPool();
  const { rows } = await pool.query<{
    id: string;
    played_date: string;
    total_strokes: string | null;
    total_par: string | null;
    holes_played: string | null;
    is_test: boolean;
  }>(
    `SELECT r.id,
            to_char(r.played_date, 'YYYY-MM-DD') AS played_date,
            SUM(rh.strokes)::int                  AS total_strokes,
            SUM(h.par)::int                        AS total_par,
            COUNT(rh.id)::int                      AS holes_played,
            r.is_test
       FROM round r
       LEFT JOIN round_hole rh ON rh.round_id = r.id
       LEFT JOIN hole h ON h.course_id = r.course_id AND h.number = rh.hole_number
      WHERE r.course_id = $1
      GROUP BY r.id, r.played_date, r.created_at, r.is_test
      ORDER BY r.played_date DESC, r.created_at DESC`,
    [courseId],
  );
  return rows.map((r) => {
    const totalStrokes = Number(r.total_strokes ?? 0);
    const totalPar = Number(r.total_par ?? 0);
    return {
      id: r.id,
      playedDate: r.played_date,
      totalStrokes,
      totalPar,
      vsPar: totalStrokes - totalPar,
      holesPlayed: Number(r.holes_played ?? 0),
      isTest: r.is_test === true,
    };
  });
}

// ── Delete + mark-as-test (Mission 2) ───────────────────────────────────────────

/** A uuid the DB will accept; anything else is treated as "not found" (idempotent). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Delete a round and (via ON DELETE CASCADE on round_hole.round_id) all its holes.
 * Idempotent: deleting a missing — or malformed — id is a no-op that succeeds.
 * Returns whether a row was actually removed so the caller can report it.
 */
export async function deleteRound(
  roundId: string,
  deps: RoundDeps = {},
): Promise<{ deleted: boolean }> {
  if (typeof roundId !== "string" || roundId.trim() === "") {
    throw new RoundError(400, "roundId is required");
  }
  // A non-uuid can never match a row; report no-op rather than letting Postgres
  // throw `invalid input syntax for type uuid`. Keeps delete idempotent.
  if (!UUID_RE.test(roundId.trim())) return { deleted: false };

  const pool = deps.pool ?? getPool();
  try {
    const { rowCount } = await pool.query("DELETE FROM round WHERE id = $1", [roundId.trim()]);
    return { deleted: (rowCount ?? 0) > 0 };
  } catch (err) {
    throw new RoundError(
      500,
      `could not delete round: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Flag (or un-flag) a round as a test round. A test round stays in the list and
 * recap but is excluded from computeScoringWeaknesses (D-5-1). Idempotent; a
 * missing/malformed id is a no-op success.
 */
export async function markRoundTest(
  roundId: string,
  isTest: boolean,
  deps: RoundDeps = {},
): Promise<{ updated: boolean }> {
  if (typeof roundId !== "string" || roundId.trim() === "") {
    throw new RoundError(400, "roundId is required");
  }
  if (typeof isTest !== "boolean") {
    throw new RoundError(400, "isTest must be a boolean");
  }
  if (!UUID_RE.test(roundId.trim())) return { updated: false };

  const pool = deps.pool ?? getPool();
  try {
    const { rowCount } = await pool.query(
      "UPDATE round SET is_test = $2 WHERE id = $1",
      [roundId.trim(), isTest],
    );
    return { updated: (rowCount ?? 0) > 0 };
  } catch (err) {
    throw new RoundError(
      500,
      `could not update round: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Stats + weaknesses (invariant #1: every number is computed here, in code) ───

export type RoundStats = {
  courseName: string;
  playedDate: string;
  holesPlayed: number;
  totalStrokes: number;
  totalPar: number;
  vsPar: number;
  totalPutts: number | null;
  fairwaysHit: number;
  fairwaysPossible: number;
  fairwayPct: number | null;
  gir: number;
  girPct: number | null;
  scramblingPct: number | null;
  puttsPerRound: number | null;
};

/**
 * Aggregate a single round's detail into the recap stat tiles. Pure given the
 * detail — no I/O, no clock. Nulls where a stat wasn't tracked (e.g. no putts
 * entered → totalPutts null), so the UI/recap can omit it rather than show a fake 0.
 */
export function summarizeRound(detail: RoundDetail): RoundStats {
  const holes = detail.holes;
  const totalStrokes = holes.reduce((s, h) => s + h.strokes, 0);
  const totalPar = holes.reduce((s, h) => s + (h.par ?? 0), 0);

  const puttHoles = holes.filter((h) => h.putts != null);
  const totalPutts = puttHoles.length ? puttHoles.reduce((s, h) => s + (h.putts ?? 0), 0) : null;

  const fairwayHoles = holes.filter((h) => h.fairwayHit != null);
  const fairwaysHit = fairwayHoles.filter((h) => h.fairwayHit === true).length;
  const fairwaysPossible = fairwayHoles.length;

  const gir = holes.filter((h) => h.gir === true).length;

  const girMissed = holes.filter((h) => h.gir === false);
  const scramblesMade = girMissed.filter((h) => h.par != null && h.strokes <= (h.par ?? 0)).length;

  return {
    courseName: detail.courseName,
    playedDate: detail.playedDate,
    holesPlayed: holes.length,
    totalStrokes,
    totalPar,
    vsPar: totalStrokes - totalPar,
    totalPutts,
    fairwaysHit,
    fairwaysPossible,
    fairwayPct: fairwaysPossible ? round1((fairwaysHit / fairwaysPossible) * 100) : null,
    gir,
    girPct: holes.length ? round1((gir / holes.length) * 100) : null,
    scramblingPct: girMissed.length ? round1((scramblesMade / girMissed.length) * 100) : null,
    puttsPerRound: totalPutts,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Aggregate scoring weaknesses across rounds. Global by default (the practice
 * ranker wants Michael's whole game); pass `{ courseId }` to scope it (the test
 * uses this for a deterministic, isolated fixture). Returns ONLY metrics that are
 * meaningfully outside their benchmark — the shape `rankPracticeSignals` consumes.
 *
 * Every figure is computed in SQL/code here; nothing is fabricated (invariant #1).
 */
export async function computeScoringWeaknesses(
  deps: RoundDeps = {},
  opts: { courseId?: string } = {},
): Promise<ScoringWeakness[]> {
  const pool = deps.pool ?? getPool();
  const params: unknown[] = [];
  // D-5-1: test rounds are real data we keep, but they must never pollute the
  // scoring-weakness signal. Always exclude them; layer the optional course scope
  // on top (the test uses courseId for a deterministic, isolated fixture).
  const conditions = ["r.is_test = false"];
  if (opts.courseId) {
    params.push(opts.courseId);
    conditions.push(`r.course_id = $${params.length}`);
  }
  const courseFilter = `WHERE ${conditions.join(" AND ")}`;

  const { rows } = await pool.query<{
    total_holes: string;
    total_rounds: string;
    three_putts: string;
    doubles: string;
    gir_missed: string;
    scrambles_made: string;
    fairway_attempts: string;
    fairways_hit: string;
  }>(
    `WITH rh AS (
       SELECT r.id AS round_id, rh.strokes, rh.putts, rh.fairway_hit, rh.gir, h.par
         FROM round r
         JOIN round_hole rh ON rh.round_id = r.id
         LEFT JOIN hole h ON h.course_id = r.course_id AND h.number = rh.hole_number
         ${courseFilter}
     )
     SELECT
       COUNT(*)::int                                                                       AS total_holes,
       COUNT(DISTINCT round_id)::int                                                       AS total_rounds,
       COUNT(*) FILTER (WHERE putts >= 3)::int                                             AS three_putts,
       COUNT(*) FILTER (WHERE par IS NOT NULL AND strokes >= par + 2)::int                 AS doubles,
       COUNT(*) FILTER (WHERE gir = false)::int                                            AS gir_missed,
       COUNT(*) FILTER (WHERE gir = false AND par IS NOT NULL AND strokes <= par)::int     AS scrambles_made,
       COUNT(*) FILTER (WHERE fairway_hit IS NOT NULL)::int                                AS fairway_attempts,
       COUNT(*) FILTER (WHERE fairway_hit = true)::int                                     AS fairways_hit
     FROM rh`,
    params,
  );

  const r = rows[0];
  const totalHoles = Number(r?.total_holes ?? 0);
  const totalRounds = Number(r?.total_rounds ?? 0);
  if (!totalHoles || !totalRounds) return [];

  const threePutts = Number(r!.three_putts);
  const doubles = Number(r!.doubles);
  const girMissed = Number(r!.gir_missed);
  const scramblesMade = Number(r!.scrambles_made);
  const fairwayAttempts = Number(r!.fairway_attempts);
  const fairwaysHit = Number(r!.fairways_hit);

  const values: Record<keyof typeof SCORING_BENCHMARKS, number | null> = {
    three_putt_pct: round1((threePutts / totalHoles) * 100),
    doubles_per_round: round1(doubles / totalRounds),
    scrambling_pct: girMissed ? round1((scramblesMade / girMissed) * 100) : null,
    fairway_pct: fairwayAttempts ? round1((fairwaysHit / fairwayAttempts) * 100) : null,
  };

  const out: ScoringWeakness[] = [];
  for (const area of Object.keys(SCORING_BENCHMARKS) as (keyof typeof SCORING_BENCHMARKS)[]) {
    const value = values[area];
    if (value == null) continue;
    const { benchmark, dir } = SCORING_BENCHMARKS[area];
    const isWeak =
      dir === "bad" ? value > benchmark * BAD_MULTIPLIER : value < benchmark * GOOD_MULTIPLIER;
    if (isWeak) out.push({ area, value, benchmark });
  }
  return out;
}

// ── The caddie round recap (Layer-5 swap) ──────────────────────────────────────

/** Default text source: stream the assembled recap prompt through Anthropic. */
async function* anthropicStream(prompt: string): AsyncIterable<string> {
  const client = getAnthropic();
  const stream = client.messages.stream({
    model: ROUND_RECAP_MODEL,
    max_tokens: ROUND_RECAP_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

const encoder = new TextEncoder();
function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * The round-recap pipeline. Loads the round, computes its stats + weaknesses (all
 * in code), assembles the Layer-5-swapped recap prompt, and returns an SSE byte
 * stream of the persona-voiced recap (`delta`* then `done`).
 *
 * Fallible work (persona check, DB read, assembly) happens BEFORE the stream is
 * returned, so a bad request throws a RoundError the route maps to a status.
 */
export async function runRoundRecapStream(
  roundId: string,
  req: { persona: string },
  deps: RoundDeps = {},
): Promise<ReadableStream<Uint8Array>> {
  if (typeof req.persona !== "string" || !PERSONA_VOICES[req.persona]) {
    throw new RoundError(
      400,
      `unknown persona "${req.persona}" — expected one of: ${Object.keys(PERSONA_VOICES).join(", ")}`,
    );
  }

  const pool = deps.pool ?? getPool();
  const detail = await getRound(roundId, { pool });
  if (!detail) throw new RoundError(404, "round not found");

  const stats = summarizeRound(detail);
  const weaknesses = await computeScoringWeaknesses({ pool });
  const prompt = assembleRoundRecapPrompt(stats, weaknesses, req.persona);

  const streamText = deps.streamText ?? anthropicStream;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamText(prompt)) {
          if (chunk) controller.enqueue(sse("delta", { text: chunk }));
        }
        controller.enqueue(sse("done", {}));
      } catch (err) {
        console.error("[rounds] recap stream failed:", err);
        controller.enqueue(sse("error", { error: "The caddie recap is unavailable right now." }));
      } finally {
        controller.close();
      }
    },
  });
}
