import "server-only";
import type pg from "pg";
import {
  predictHole,
  PERSONAS,
  type ClubDispersion,
  type HoleFeature,
  type HoleInput,
} from "@gai/sg-engine";
import { assemblePrompt } from "@gai/caddie-context";
import { getPool } from "./db";
import { getAnthropic } from "./anthropic";

// =============================================================
// Strategy orchestration (Phase 3B). This is where the caddie first speaks.
//
// The Next.js route at apps/web is a THIN wrapper around runStrategyStream — all
// of the data access, the engine call, the prompt assembly, and the Anthropic
// hop live here, server-side, so the secrets never approach the client bundle
// (invariant #3) and the logic is testable without spinning up Next.
//
// Invariant #1 boundary: predictHole (in @gai/sg-engine) computes the club and
// carry target; the LLM only NARRATES the assembled prompt. The model never sees
// the raw dispersion rows and never does arithmetic.
//
// Invariant #5 leak guard: the assembled prompt and the engine's reasoning[] are
// INTERNAL. The stream emits only the client-safe EngineView + the caddie prose.
// =============================================================

/** Model + budget are pinned by the brief: concise caddie, fixed Sonnet build. */
export const STRATEGY_MODEL = "claude-sonnet-4-20250514";
export const STRATEGY_MAX_TOKENS = 300;

export type StrategyConditions = {
  windMph?: number;
  windDir?: string;
  pinPosition?: "front" | "middle" | "back";
  lie?: string;
  notes?: string;
};

export type StrategyRequest = {
  courseId: string;
  holeNumber: number;
  persona: string;
  conditions?: StrategyConditions;
};

/**
 * The client-safe projection of the engine's StrategyResult. Deliberately omits
 * `reasoning` (internal facts for the prompt) and never carries the prompt string.
 * These five numbers are what the UI renders above the caddie text.
 */
export type EngineView = {
  club: string;
  carryTarget: number;
  dangerSide: "left" | "right" | "center" | null;
  layupRecommended: boolean;
  confidenceFlag: "measured" | "partial" | "seeded";
};

/** Carries an HTTP status so the route can map fetch failures cleanly. */
export class StrategyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StrategyError";
    this.status = status;
  }
}

/** Injectable seams — defaults hit the real pool and the real Anthropic API. */
export type StrategyDeps = {
  pool?: pg.Pool;
  /** Yields the caddie's prose in chunks. Overridden in tests with a fixed string. */
  streamText?: (prompt: string) => AsyncIterable<string>;
};

interface HoleRow {
  id: string;
  number: number;
  par: number;
  stroke_index: number | null;
  yardage_blue: number | null;
  course_name: string;
}

interface FeatureRow {
  kind: HoleFeature["kind"];
  side: HoleFeature["side"] | null;
  distance_from_tee: number | null;
  carry_to_clear: number | null;
}

interface DispersionRow {
  club: string;
  carry_mean_yards: string | number;
  carry_sd_yards: string | number;
  lateral_sd_yards: string | number;
  confidence: ClubDispersion["confidence"];
}

async function loadHole(
  pool: pg.Pool,
  courseId: string,
  holeNumber: number,
): Promise<{ hole: HoleInput; courseName: string }> {
  // Tee-column note: the Fox Bend seed (002_fox_bend_seed.sql) shifted the tee
  // labels by one DB column — the *White* tee yardage lives in `yardage_blue`
  // (the `yardage_white` column actually holds the Black/back tee). teeSet 'White'
  // therefore reads yardage_blue, matching the committed Phase 2B/3A fixtures
  // (Hole 3 White = 150). Do not "fix" this without re-seeding the table.
  const { rows } = await pool.query<HoleRow>(
    `SELECT h.id, h.number, h.par, h.stroke_index, h.yardage_blue, c.name AS course_name
       FROM hole h
       JOIN course c ON c.id = h.course_id
      WHERE h.course_id = $1 AND h.number = $2`,
    [courseId, holeNumber],
  );
  const row = rows[0];
  if (!row) throw new StrategyError(404, "hole not found");
  if (row.yardage_blue == null) {
    throw new StrategyError(422, `hole ${holeNumber} has no White-tee yardage`);
  }

  const { rows: feats } = await pool.query<FeatureRow>(
    `SELECT kind, side, distance_from_tee, carry_to_clear
       FROM hole_feature
      WHERE hole_id = $1`,
    [row.id],
  );

  const features: HoleFeature[] = feats.map((f) => ({
    kind: f.kind,
    side: f.side ?? "center",
    distanceFromTee: f.distance_from_tee == null ? null : Number(f.distance_from_tee),
    carryToClear: f.carry_to_clear == null ? null : Number(f.carry_to_clear),
  }));

  const hole: HoleInput = {
    number: row.number,
    par: row.par,
    strokeIndex: row.stroke_index ?? 0,
    yardageWhite: Number(row.yardage_blue),
    features,
  };
  return { hole, courseName: row.course_name };
}

async function loadDispersion(pool: pg.Pool): Promise<ClubDispersion[]> {
  // All 13 bag clubs — the engine picks among them; we never pre-filter.
  const { rows } = await pool.query<DispersionRow>(
    `SELECT club, carry_mean_yards, carry_sd_yards, lateral_sd_yards, confidence
       FROM club_dispersion`,
  );
  if (rows.length === 0) {
    throw new StrategyError(422, "no club dispersion data — seed the bag first");
  }
  return rows.map((r) => ({
    club: r.club,
    carryMean: Number(r.carry_mean_yards),
    carrySD: Number(r.carry_sd_yards),
    lateralSD: Number(r.lateral_sd_yards),
    confidence: r.confidence,
  }));
}

/** Default text source: stream the assembled prompt through Anthropic (Sonnet). */
async function* anthropicStream(prompt: string): AsyncIterable<string> {
  const client = getAnthropic();
  const stream = client.messages.stream({
    model: STRATEGY_MODEL,
    max_tokens: STRATEGY_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

const encoder = new TextEncoder();

/** One Server-Sent Event frame: `event: <name>\ndata: <json>\n\n`. */
function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function buildSseStream(
  engine: EngineView,
  textSource: () => AsyncIterable<string>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Engine numbers first (the UI renders them above the prose immediately).
        controller.enqueue(sse("engine", engine));
        for await (const chunk of textSource()) {
          if (chunk) controller.enqueue(sse("delta", { text: chunk }));
        }
        controller.enqueue(sse("done", {}));
      } catch (err) {
        // A mid-stream failure (e.g. an Anthropic auth/rate error) is logged
        // server-side but surfaced to the client as a GENERIC message — never the
        // raw upstream error, which could echo a request id or internal detail.
        console.error("[strategy] caddie stream failed:", err);
        controller.enqueue(sse("error", { error: "The caddie is unavailable right now." }));
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * The full strategy pipeline. Resolves the hole + dispersion, runs the engine,
 * assembles the five-layer prompt, and returns an SSE byte stream that emits the
 * engine numbers followed by the streamed caddie prose.
 *
 * All the fallible DB/engine/assembly work happens eagerly (awaited) BEFORE the
 * stream is returned, so a bad request (unknown persona, missing hole) throws a
 * StrategyError the route can map to a clean status — rather than failing mid-
 * stream after the response has already committed to 200/text-event-stream.
 */
export async function runStrategyStream(
  req: StrategyRequest,
  deps: StrategyDeps = {},
): Promise<ReadableStream<Uint8Array>> {
  const persona = PERSONAS[req.persona];
  if (!persona) {
    throw new StrategyError(
      400,
      `unknown persona "${req.persona}" — expected one of: ${Object.keys(PERSONAS).join(", ")}`,
    );
  }
  if (!Number.isInteger(req.holeNumber)) {
    throw new StrategyError(400, "holeNumber must be an integer");
  }

  const pool = deps.pool ?? getPool();
  const { hole, courseName } = await loadHole(pool, req.courseId, req.holeNumber);
  const dispersion = await loadDispersion(pool);

  // Invariant #1: the engine computes the club + carry target.
  const result = predictHole(hole, dispersion, persona);

  // Invariant #5: assemble the prompt the LLM narrates. teeSet 'White' (see loadHole).
  const prompt = assemblePrompt(hole, result, req.persona, courseName, "White", req.conditions ?? {});

  // The only engine fields that cross to the client. `reasoning` and `prompt` stay here.
  const engine: EngineView = {
    club: result.recommendedClub,
    carryTarget: result.carryTarget,
    dangerSide: result.dangerSide,
    layupRecommended: result.layupRecommended,
    confidenceFlag: result.confidenceFlag,
  };

  const streamText = deps.streamText ?? anthropicStream;
  return buildSseStream(engine, () => streamText(prompt));
}
