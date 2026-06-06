import "server-only";
import type pg from "pg";
import { rankPracticeSignals, type PracticeSignal } from "@gai/sg-engine";
import { assemblePracticePrompt, type CoachDrill } from "@gai/caddie-context";
import { PERSONA_VOICES } from "@gai/caddie-context";
import { getPool } from "./db";
import { getAnthropic } from "./anthropic";
import { computeScoringWeaknesses } from "./rounds";

// =============================================================
// Phase 4.5 — Practice tab server logic (D12–D15). The input side of the loop.
//
// The Next.js routes under apps/web/src/app/api/practice are THIN wrappers around
// these functions — all DB access, the deterministic ranker call, the Layer-5
// prompt assembly, and the Anthropic hop live here, server-side, so the secrets
// never approach the client bundle (invariant #3).
//
// Invariant #1 boundary: rankPracticeSignals (in @gai/sg-engine) decides WHAT to
// work on; the LLM only narrates + selects a drill. Invariant #4: the only drills
// and URLs the model sees come from the `drill` table, passed in explicitly.
// =============================================================

/** Reuse the strategy build's pinned Sonnet model; the coach just needs more room. */
export const PRACTICE_COACH_MODEL = "claude-sonnet-4-20250514";
export const PRACTICE_COACH_MAX_TOKENS = 900;

/** Michael's 13-club bag, in bag order (matches the seeded club_dispersion + the engine fixture). */
export const BAG_CLUBS = [
  "driver",
  "3h",
  "5h",
  "4i",
  "6i",
  "7i",
  "8i",
  "9i",
  "PW",
  "GW50",
  "SW54",
  "LW60",
  "LW64",
] as const;

/**
 * Michael's documented scoring weaknesses, from the 28-round dataset / player
 * profile (the detonator chain). Hardcoded here as real, sourced figures until a
 * `round_hole` stat table lands — the ranker stays pure and just consumes them.
 * These are facts, not fabrications: 3-putt% and doubles/round are the two leaks
 * the spec and the player profile both call out.
 */
export const SCORING_WEAKNESSES = [
  { area: "three_putt_pct", value: 10.2, benchmark: 6.0 },
  { area: "doubles_per_round", value: 1.8, benchmark: 1.0 },
] as const;

/** Carries an HTTP status so a route can map a failure cleanly (mirrors StrategyError). */
export class PracticeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PracticeError";
    this.status = status;
  }
}

export type PracticeDeps = {
  pool?: pg.Pool;
  /** Yields the coach's prose in chunks. Overridden in tests with a fixed string. */
  streamText?: (prompt: string) => AsyncIterable<string>;
};

const SESSION_TYPES = ["trackman", "grass_range", "short_game", "net"] as const;
export type PracticeSessionType = (typeof SESSION_TYPES)[number];

export type CreatePracticeSessionInput = {
  date: string;
  type: PracticeSessionType;
  location?: string | null;
  surface?: string | null;
  ball?: string | null;
  duration_min?: number | null;
  overall_rating?: number | null;
  recap_md?: string | null;
  linked_shot_session?: string | null;
  focusAreas?: string[];
  metrics?: Array<{ kind: string; value: number }>;
};

// ── Sessions ──────────────────────────────────────────────────────────────────

/**
 * Insert a practice_session plus its focus tags and metrics in ONE transaction.
 * Returns the new session id. Validates the enum + date here so a bad payload
 * fails before any write (invariant: never seed garbage).
 */
export async function createPracticeSession(
  input: CreatePracticeSessionInput,
  deps: PracticeDeps = {},
): Promise<{ id: string }> {
  if (!input || typeof input.date !== "string" || input.date.trim() === "") {
    throw new PracticeError(400, "date is required");
  }
  if (!SESSION_TYPES.includes(input.type)) {
    throw new PracticeError(
      400,
      `type must be one of: ${SESSION_TYPES.join(", ")}`,
    );
  }
  if (
    input.overall_rating != null &&
    (!Number.isInteger(input.overall_rating) ||
      input.overall_rating < 1 ||
      input.overall_rating > 5)
  ) {
    throw new PracticeError(400, "overall_rating must be an integer 1–5");
  }

  const pool = deps.pool ?? getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO practice_session
         (date, type, location, surface, ball, duration_min, overall_rating, recap_md, linked_shot_session)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        input.date,
        input.type,
        input.location ?? null,
        input.surface ?? null,
        input.ball ?? null,
        input.duration_min ?? null,
        input.overall_rating ?? null,
        input.recap_md ?? null,
        input.linked_shot_session ?? null,
      ],
    );
    const id = rows[0]!.id;

    for (const area of input.focusAreas ?? []) {
      if (typeof area === "string" && area.trim() !== "") {
        await client.query(
          "INSERT INTO practice_focus (practice_session_id, area) VALUES ($1, $2)",
          [id, area],
        );
      }
    }

    for (const m of input.metrics ?? []) {
      if (m && typeof m.kind === "string" && Number.isFinite(m.value)) {
        await client.query(
          "INSERT INTO practice_metric (practice_session_id, kind, value) VALUES ($1, $2, $3)",
          [id, m.kind, m.value],
        );
      }
    }

    await client.query("COMMIT");
    return { id };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof PracticeError) throw err;
    throw new PracticeError(
      500,
      `could not create practice session: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    client.release();
  }
}

export type PracticeSessionRow = {
  id: string;
  date: string;
  type: string;
  location: string | null;
  surface: string | null;
  ball: string | null;
  duration_min: number | null;
  overall_rating: number | null;
  recap_md: string | null;
  linked_shot_session: string | null;
  focusAreas: string[];
};

/** All sessions, newest first, each with its focus-area tags rolled up. */
export async function listPracticeSessions(
  deps: PracticeDeps = {},
): Promise<PracticeSessionRow[]> {
  const pool = deps.pool ?? getPool();
  const { rows } = await pool.query<{
    id: string;
    date: string;
    type: string;
    location: string | null;
    surface: string | null;
    ball: string | null;
    duration_min: number | null;
    overall_rating: number | null;
    recap_md: string | null;
    linked_shot_session: string | null;
    focus_areas: string[] | null;
  }>(
    `SELECT s.id, to_char(s.date, 'YYYY-MM-DD') AS date, s.type, s.location, s.surface,
            s.ball, s.duration_min, s.overall_rating, s.recap_md, s.linked_shot_session,
            COALESCE(array_remove(array_agg(f.area ORDER BY f.area), NULL), '{}') AS focus_areas
       FROM practice_session s
       LEFT JOIN practice_focus f ON f.practice_session_id = s.id
      GROUP BY s.id
      ORDER BY s.date DESC, s.created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    type: r.type,
    location: r.location,
    surface: r.surface,
    ball: r.ball,
    duration_min: r.duration_min,
    overall_rating: r.overall_rating,
    recap_md: r.recap_md,
    linked_shot_session: r.linked_shot_session,
    focusAreas: r.focus_areas ?? [],
  }));
}

/** A uuid the DB will accept; anything else is treated as "not found" (idempotent). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Delete a practice session and (via ON DELETE CASCADE on practice_focus and
 * practice_metric) all its child rows. Idempotent: a missing — or malformed — id
 * is a no-op that succeeds. Returns whether a row was actually removed.
 */
export async function deletePracticeSession(
  id: string,
  deps: PracticeDeps = {},
): Promise<{ deleted: boolean }> {
  if (typeof id !== "string" || id.trim() === "") {
    throw new PracticeError(400, "id is required");
  }
  if (!UUID_RE.test(id.trim())) return { deleted: false };

  const pool = deps.pool ?? getPool();
  try {
    const { rowCount } = await pool.query("DELETE FROM practice_session WHERE id = $1", [id.trim()]);
    return { deleted: (rowCount ?? 0) > 0 };
  } catch (err) {
    throw new PracticeError(
      500,
      `could not delete practice session: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Dual confidence ─────────────────────────────────────────────────────────

export type ClubConfidenceView = {
  club: string;
  /** Objective data confidence from club_dispersion (null if the club isn't seeded yet). */
  dataConfidence: "measured" | "partial" | "seeded" | null;
  /** Subjective feel-trust 1–4 the player set (null if never set). */
  feelLevel: number | null;
  note: string | null;
};

/**
 * The dual-confidence view: every bag club with BOTH its data confidence
 * (objective, from shot count) and its feel confidence (subjective, set by the
 * player). Built from the fixed bag so a club always appears even before it has
 * either row.
 */
export async function getClubConfidence(
  deps: PracticeDeps = {},
): Promise<ClubConfidenceView[]> {
  const pool = deps.pool ?? getPool();

  const { rows: disp } = await pool.query<{ club: string; confidence: ClubConfidenceView["dataConfidence"] }>(
    "SELECT club, confidence FROM club_dispersion",
  );
  const dataByClub = new Map(disp.map((d) => [d.club, d.confidence]));

  const { rows: feel } = await pool.query<{ club: string; feel_level: number; note: string | null }>(
    "SELECT club, feel_level, note FROM club_confidence",
  );
  const feelByClub = new Map(feel.map((f) => [f.club, f]));

  return BAG_CLUBS.map((club) => {
    const f = feelByClub.get(club);
    return {
      club,
      dataConfidence: dataByClub.get(club) ?? null,
      feelLevel: f ? f.feel_level : null,
      note: f ? f.note : null,
    };
  });
}

/** Upsert one club's feel-trust (1–4). Feel is the player's to set; it overwrites. */
export async function upsertClubConfidence(
  input: { club: string; feel_level: number; note?: string | null },
  deps: PracticeDeps = {},
): Promise<ClubConfidenceView> {
  if (!input || typeof input.club !== "string" || input.club.trim() === "") {
    throw new PracticeError(400, "club is required");
  }
  if (!Number.isInteger(input.feel_level) || input.feel_level < 1 || input.feel_level > 4) {
    throw new PracticeError(400, "feel_level must be an integer 1–4");
  }

  const pool = deps.pool ?? getPool();
  await pool.query(
    `INSERT INTO club_confidence (club, feel_level, note, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (club) DO UPDATE SET
       feel_level = EXCLUDED.feel_level,
       note       = EXCLUDED.note,
       updated_at = now()`,
    [input.club, input.feel_level, input.note ?? null],
  );

  const { rows } = await pool.query<{ confidence: ClubConfidenceView["dataConfidence"] }>(
    "SELECT confidence FROM club_dispersion WHERE club = $1",
    [input.club],
  );
  return {
    club: input.club,
    dataConfidence: rows[0]?.confidence ?? null,
    feelLevel: input.feel_level,
    note: input.note ?? null,
  };
}

// ── The AI coach (Layer-5 swap) ───────────────────────────────────────────────

async function loadCoachInputs(pool: pg.Pool): Promise<{
  signals: PracticeSignal[];
  drills: CoachDrill[];
}> {
  const { rows: disp } = await pool.query<{
    club: string;
    confidence: string;
    lateral_sd_yards: string | number;
    carry_sd_yards: string | number;
  }>("SELECT club, confidence, lateral_sd_yards, carry_sd_yards FROM club_dispersion");

  const { rows: feel } = await pool.query<{ club: string; feel_level: number }>(
    "SELECT club, feel_level FROM club_confidence",
  );

  // Phase 5: real scoring weaknesses, computed from the persisted round_hole data
  // (Play → Recap → Practice loop). Falls back to the documented placeholder
  // figures only until a round has been logged, so the coach is never empty-handed.
  const computed = await computeScoringWeaknesses({ pool });
  const scoringWeaknesses = computed.length ? computed : SCORING_WEAKNESSES.map((w) => ({ ...w }));

  // Invariant #1: the engine ranks; the LLM never decides what to work on.
  const signals = rankPracticeSignals({
    clubDispersion: disp.map((d) => ({
      club: d.club,
      confidence: d.confidence,
      lateralSD: Number(d.lateral_sd_yards),
      carrySD: Number(d.carry_sd_yards),
    })),
    clubConfidence: feel.map((f) => ({ club: f.club, feelLevel: f.feel_level })),
    scoringWeaknesses,
  });

  // Invariant #4: the ONLY drills (and URLs) the model may cite come from here.
  const { rows: drillRows } = await pool.query<CoachDrill>(
    `SELECT area, title, description, resource_url, resource_kind
       FROM drill
      ORDER BY area, title`,
  );

  return { signals, drills: drillRows };
}

/** Default text source: stream the assembled coach prompt through Anthropic. */
async function* anthropicStream(prompt: string): AsyncIterable<string> {
  const client = getAnthropic();
  const stream = client.messages.stream({
    model: PRACTICE_COACH_MODEL,
    max_tokens: PRACTICE_COACH_MAX_TOKENS,
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
 * The coach pipeline. Loads state, runs the deterministic ranker, assembles the
 * Layer-5-swapped prompt, and returns an SSE byte stream that emits:
 *   `signals` (the ranked signals, for the cards' badges/areas/source)
 *   `drills`  (the curated drill list — the client's link lookup table, so the
 *              cited drill title resolves to a real URL; the model never makes one up)
 *   `delta`*  (the streamed coach prose, in [REC] blocks)
 *   `done`
 *
 * Fallible work (persona check, DB reads, assembly) happens BEFORE the stream is
 * returned, so a bad request throws a PracticeError the route maps to a status.
 */
export async function runPracticeCoachStream(
  req: { persona: string },
  deps: PracticeDeps = {},
): Promise<ReadableStream<Uint8Array>> {
  if (typeof req.persona !== "string" || !PERSONA_VOICES[req.persona]) {
    throw new PracticeError(
      400,
      `unknown persona "${req.persona}" — expected one of: ${Object.keys(PERSONA_VOICES).join(", ")}`,
    );
  }

  const pool = deps.pool ?? getPool();
  const { signals, drills } = await loadCoachInputs(pool);
  const prompt = assemblePracticePrompt(signals, req.persona, drills);

  const streamText = deps.streamText ?? anthropicStream;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(sse("signals", signals));
        // Only the client-safe drill fields cross the wire (it needs them to resolve links).
        controller.enqueue(
          sse(
            "drills",
            drills.map((d) => ({
              area: d.area,
              title: d.title,
              description: d.description,
              resource_url: d.resource_url,
              resource_kind: d.resource_kind,
            })),
          ),
        );
        for await (const chunk of streamText(prompt)) {
          if (chunk) controller.enqueue(sse("delta", { text: chunk }));
        }
        controller.enqueue(sse("done", {}));
      } catch (err) {
        console.error("[practice] coach stream failed:", err);
        controller.enqueue(sse("error", { error: "The coach is unavailable right now." }));
      } finally {
        controller.close();
      }
    },
  });
}
