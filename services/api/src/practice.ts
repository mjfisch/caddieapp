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

// Mission 7: 'short_game' and 'net' retired from creation (Practice Tab Spec v2
// §2/§7). The 7 legacy short_game rows stay readable and deletable — legacy is
// label-only, enforced nowhere but the client's TYPE_LABEL map. The DB CHECK
// (011_retire_net_type.sql) keeps 'short_game' valid for those rows; only this
// list decides what NEW sessions the API accepts.
const SESSION_TYPES = [
  "trackman",
  "grass_range",
  "around_green",
  "putting",
] as const;
export type PracticeSessionType = (typeof SESSION_TYPES)[number];

/**
 * One drill block in a putting session (Practice Tab Spec v2 §4d/§5e). Order is
 * the array index — `position` is assigned from it. `values` holds only the
 * metrics the user actually filled; an empty block (General note-only, or a drill
 * block with nothing entered) still records "I did this drill".
 */
export type CreateDrillBlockInput = {
  drillId: string;
  note?: string | null;
  values?: Array<{ metricDefId: string; value: number }>;
};

/** Primary shot shape (§4a/§4b/§5b) — one per club per session, optional. */
export const SHOT_SHAPES = ["straight", "draw", "pull", "hook", "fade", "push", "slice"] as const;
export type ShotShape = (typeof SHOT_SHAPES)[number];

/**
 * One tagged club in a range session (Mission 5, §4a/§4b/§5b). `club` matches
 * `club.name`. shotShape/note are both optional — a selected club with neither
 * still saves as a bare session_club row.
 */
export type SessionClubInput = {
  club: string;
  shotShape?: string | null;
  note?: string | null;
};

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
  /** Lie tags — around_green sessions only (§4c). Empty array is a valid "none tagged". */
  lie_types?: string[] | null;
  /** Shot tags — around_green sessions only (§4c). "bunker" here is the explosion shot, not the lie. */
  shot_types?: string[] | null;
  /** Ordered drill blocks — putting sessions only (§4d). */
  drillBlocks?: CreateDrillBlockInput[];
  /** Clubs Used — Trackman + Grass Range + Around the Green sessions (§4a/§4b/§4c). */
  clubs?: SessionClubInput[];
};

/** Keep only real tag strings; a non-array (absent/null/garbage) stays NULL in the column. */
function sanitizeTagArray(raw: string[] | null | undefined): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim());
}

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
         (date, type, location, surface, ball, duration_min, overall_rating, recap_md, linked_shot_session, lie_types, shot_types)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        sanitizeTagArray(input.lie_types),
        sanitizeTagArray(input.shot_types),
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

    // Ordered drill blocks (§4d/§5e). position = list order; a block with no
    // values and no note still inserts (it records that the drill was done).
    // Skipped-empty positions stay contiguous via a running counter.
    let position = 0;
    for (const block of input.drillBlocks ?? []) {
      if (!block || typeof block.drillId !== "string" || block.drillId.trim() === "") continue;
      const { rows: blockRows } = await client.query<{ id: string }>(
        `INSERT INTO session_drill_block (practice_session_id, drill_id, position, note)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [id, block.drillId, position, block.note?.trim() ? block.note.trim() : null],
      );
      const blockId = blockRows[0]!.id;
      position += 1;
      for (const v of block.values ?? []) {
        if (v && typeof v.metricDefId === "string" && v.metricDefId.trim() !== "" && Number.isFinite(v.value)) {
          await client.query(
            "INSERT INTO session_drill_value (block_id, metric_def_id, value) VALUES ($1, $2, $3)",
            [blockId, v.metricDefId, v.value],
          );
        }
      }
    }

    // Clubs Used (§5b) — one row per tagged club; a selected club with no shape
    // or note still inserts a bare row (it records that the club was worked).
    // An invalid shot_shape is dropped rather than failing the whole session —
    // the DB CHECK would otherwise 500 the entire save over one bad enum value.
    // around_green never stores a shape (§4c: shape is a full-swing concept),
    // even if a raw API caller sends one.
    for (const c of input.clubs ?? []) {
      if (!c || typeof c.club !== "string" || c.club.trim() === "") continue;
      const shotShape =
        input.type !== "around_green" &&
        typeof c.shotShape === "string" &&
        (SHOT_SHAPES as readonly string[]).includes(c.shotShape)
          ? c.shotShape
          : null;
      await client.query(
        "INSERT INTO session_club (practice_session_id, club, shot_shape, note) VALUES ($1, $2, $3, $4)",
        [id, c.club.trim(), shotShape, c.note?.trim() ? c.note.trim() : null],
      );
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

/** One drill block rolled up for display (title + its filled metrics + note). */
export type SessionDrillBlockView = {
  drillTitle: string;
  note: string | null;
  /** Only the metrics that were filled, in the drill's metric sort order. */
  metrics: Array<{ label: string; unit: string | null; value: number }>;
};

/** One tagged club rolled up for display (Recent Sessions clubs line, Mission 5). */
export type SessionClubView = {
  club: string;
  shotShape: string | null;
  note: string | null;
};

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
  /** Lie tags (§4c) — populated for around_green sessions only (empty otherwise). */
  lieTypes: string[];
  /** Shot tags (§4c) — populated for around_green sessions only (empty otherwise). */
  shotTypes: string[];
  /** Ordered drill blocks — populated for putting sessions only (empty otherwise). */
  blocks: SessionDrillBlockView[];
  /** Clubs Used, in bag order — populated for trackman/grass_range/around_green only (empty otherwise). */
  clubs: SessionClubView[];
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
    lie_types: string[] | null;
    shot_types: string[] | null;
    focus_areas: string[] | null;
  }>(
    `SELECT s.id, to_char(s.date, 'YYYY-MM-DD') AS date, s.type, s.location, s.surface,
            s.ball, s.duration_min, s.overall_rating, s.recap_md, s.linked_shot_session,
            s.lie_types, s.shot_types,
            COALESCE(array_remove(array_agg(f.area ORDER BY f.area), NULL), '{}') AS focus_areas
       FROM practice_session s
       LEFT JOIN practice_focus f ON f.practice_session_id = s.id
      GROUP BY s.id
      ORDER BY s.date DESC, s.created_at DESC`,
  );

  // Second pass: pull the ordered drill blocks for the putting sessions only, so
  // the flat session query above stays type-agnostic (the read-path finding from
  // the Mission 1 code trace). Each block carries its title, note, and the metrics
  // that were actually filled, in the drill's metric sort order.
  const puttingIds = rows.filter((r) => r.type === "putting").map((r) => r.id);
  const blocksBySession = new Map<string, SessionDrillBlockView[]>();
  if (puttingIds.length > 0) {
    const { rows: blockRows } = await pool.query<{
      practice_session_id: string;
      drill_title: string;
      note: string | null;
      metrics: Array<{ label: string; unit: string | null; value: string | number }> | null;
    }>(
      `SELECT b.practice_session_id, d.title AS drill_title, b.note,
              COALESCE(
                json_agg(
                  json_build_object('label', dmd.label, 'unit', dmd.unit, 'value', v.value)
                  ORDER BY dmd.sort_order
                ) FILTER (WHERE v.id IS NOT NULL),
                '[]'
              ) AS metrics
         FROM session_drill_block b
         JOIN drill d ON d.id = b.drill_id
         LEFT JOIN session_drill_value v ON v.block_id = b.id
         LEFT JOIN drill_metric_def dmd ON dmd.id = v.metric_def_id
        WHERE b.practice_session_id = ANY($1::uuid[])
        GROUP BY b.id, d.title, b.note, b.position
        ORDER BY b.practice_session_id, b.position`,
      [puttingIds],
    );
    for (const br of blockRows) {
      const list = blocksBySession.get(br.practice_session_id) ?? [];
      list.push({
        drillTitle: br.drill_title,
        note: br.note,
        metrics: (br.metrics ?? []).map((m) => ({ label: m.label, unit: m.unit, value: Number(m.value) })),
      });
      blocksBySession.set(br.practice_session_id, list);
    }
  }

  // Third pass: Clubs Used (§5b) for trackman/grass_range/around_green sessions
  // only, ordered by the club roster's bag order (sort_order) so the Recent
  // Sessions clubs line always reads in bag order regardless of tag order.
  const rangeIds = rows
    .filter((r) => r.type === "trackman" || r.type === "grass_range" || r.type === "around_green")
    .map((r) => r.id);
  const clubsBySession = new Map<string, SessionClubView[]>();
  if (rangeIds.length > 0) {
    const { rows: clubRows } = await pool.query<{
      practice_session_id: string;
      club: string;
      shot_shape: string | null;
      note: string | null;
    }>(
      `SELECT sc.practice_session_id, sc.club, sc.shot_shape, sc.note
         FROM session_club sc
         LEFT JOIN club c ON c.name = sc.club
        WHERE sc.practice_session_id = ANY($1::uuid[])
        ORDER BY sc.practice_session_id, c.sort_order NULLS LAST, sc.club`,
      [rangeIds],
    );
    for (const cr of clubRows) {
      const list = clubsBySession.get(cr.practice_session_id) ?? [];
      list.push({ club: cr.club, shotShape: cr.shot_shape, note: cr.note });
      clubsBySession.set(cr.practice_session_id, list);
    }
  }

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
    lieTypes: r.lie_types ?? [],
    shotTypes: r.shot_types ?? [],
    blocks: blocksBySession.get(r.id) ?? [],
    clubs: clubsBySession.get(r.id) ?? [],
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

// ── Drills (putting block picker) ─────────────────────────────────────────────

export type DrillMetricDefView = {
  id: string;
  label: string;
  unit: string | null;
  valueType: string;
};

export type PuttingDrillView = {
  id: string;
  title: string;
  area: string;
  isSystem: boolean;
  sortOrder: number | null;
  metricDefs: DrillMetricDefView[];
};

/**
 * Active (non-archived) putting drills for the block picker (§4d), each with its
 * ordered metric definitions. Ordered General (the is_system block) first, then
 * the defined drills by sort_order — the exact order the "Add block" picker shows.
 */
export async function listPuttingDrills(deps: PracticeDeps = {}): Promise<PuttingDrillView[]> {
  const pool = deps.pool ?? getPool();
  const { rows } = await pool.query<{
    id: string;
    title: string;
    area: string;
    is_system: boolean;
    sort_order: number | null;
    metric_defs: Array<{ id: string; label: string; unit: string | null; valueType: string }> | null;
  }>(
    `SELECT d.id, d.title, d.area, d.is_system, d.sort_order,
            COALESCE(
              json_agg(
                json_build_object('id', dmd.id, 'label', dmd.label, 'unit', dmd.unit, 'valueType', dmd.value_type)
                ORDER BY dmd.sort_order
              ) FILTER (WHERE dmd.id IS NOT NULL),
              '[]'
            ) AS metric_defs
       FROM drill d
       LEFT JOIN drill_metric_def dmd ON dmd.drill_id = d.id
      WHERE d.area = 'putting' AND d.archived = false
      GROUP BY d.id
      ORDER BY d.is_system DESC, d.sort_order NULLS LAST, d.title`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    area: r.area,
    isSystem: r.is_system,
    sortOrder: r.sort_order,
    metricDefs: r.metric_defs ?? [],
  }));
}

// ── Club roster (Clubs Used chip row, §5a) ──────────────────────────────────

/** One active bag club as the Clubs Used chip row renders it. */
export type ClubRosterView = {
  name: string;
  sortOrder: number | null;
  aroundGreenEligible: boolean;
};

/**
 * Active (non-archived) clubs, in bag order (§5a). The full bag for the
 * Trackman/Grass Range "Clubs used" chip row (Mission 5).
 */
export async function listActiveClubs(deps: PracticeDeps = {}): Promise<ClubRosterView[]> {
  const pool = deps.pool ?? getPool();
  const { rows } = await pool.query<{
    name: string;
    sort_order: number | null;
    around_green_eligible: boolean;
  }>(
    `SELECT name, sort_order, around_green_eligible
       FROM club
      WHERE archived = false
      ORDER BY sort_order NULLS LAST, name`,
  );
  return rows.map((r) => ({
    name: r.name,
    sortOrder: r.sort_order,
    aroundGreenEligible: r.around_green_eligible,
  }));
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
