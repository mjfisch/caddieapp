import "server-only";
import {
  DIFFERENTIAL_SOURCES,
  FAIRWAY_RESULTS,
  type DifferentialSource,
  type FairwayResult,
} from "./rounds";

// =============================================================
// Mission S4 — the §3 round-payload validator (design doc
// MJF_Golf_Stats_Tab_Design_Decisions_v1.md §3; D22/D23).
//
// This module is the ENFORCEMENT HOME for the full §3 rule set — including the
// two rules the DB cannot hold (see 012_stats_foundation.sql + DECISIONS.md
// D23): the par-3 NULL rule for fairway_result (no round_hole→hole FK, so no
// CHECK can reach hole.par) and the required tee_box (round.tee_box_id is
// nullable for legacy rows; every SYNCED round must carry one).
//
// Layer 2 of the three-layer validation contract (payload schema / THIS
// validator / DB CHECK). The domain lists are IMPORTED from the S3 server
// mirrors in rounds.ts — one source of truth per constant (the three-list
// lesson); never redefine them here.
//
// Pure: no I/O, no DB. Runs before any insert. On violation it THROWS a
// RoundPayloadError naming the file and the exact rule — fail loudly, never a
// silent no-op (D22).
// =============================================================

export type RoundHolePayload = {
  hole: number;
  par: number;
  strokes: number;
  putts: number;
  /** NULL exactly on par 3s (§3 rule 4 / rule d) — validated here, not in the DB. */
  fairway_result: FairwayResult | null;
  gir: boolean;
};

export type RoundPayload = {
  external_key: string;
  date: string;
  course: { name: string; slug: string };
  tee_box: { name: string; rating: number; slope: number; yardage?: number | null };
  score: { gross: number; differential: number; differential_source: DifferentialSource };
  holes: RoundHolePayload[];
  reflection?: string | null;
};

/** The §3 rule letters this mission enforces (a–g), plus "shape" for structural breakage. */
export type RoundPayloadRule = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "shape";

export class RoundPayloadError extends Error {
  readonly filename: string;
  readonly rule: RoundPayloadRule;
  constructor(filename: string, rule: RoundPayloadRule, detail: string) {
    super(
      rule === "shape"
        ? `round payload ${filename} is malformed: ${detail}`
        : `round payload ${filename} violates §3 rule (${rule}): ${detail}`,
    );
    this.name = "RoundPayloadError";
    this.filename = filename;
    this.rule = rule;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate one parsed round payload against the full §3 rule set:
 *   (a) exactly 18 holes, numbers 1–18 unique
 *   (b) sum(strokes) === score.gross
 *   (c) putts <= strokes on every hole
 *   (d) fairway_result is null IFF hole par === 3 (values from FAIRWAY_RESULTS)
 *   (e) differential + differential_source present; source in DIFFERENTIAL_SOURCES
 *   (f) external_key === date + '_' + course.slug; filename === external_key + '.json'
 *   (g) tee_box present with name + rating + slope (so tee_box_id can resolve)
 * Throws RoundPayloadError naming `filename` and the rule; returns the typed
 * payload on success so the sync writes exactly what was validated.
 */
export function validateRoundPayload(filename: string, raw: unknown): RoundPayload {
  const fail = (rule: RoundPayloadRule, detail: string): never => {
    throw new RoundPayloadError(filename, rule, detail);
  };

  if (!isRecord(raw)) fail("shape", "payload is not a JSON object");
  const p = raw as Record<string, unknown>;

  // ── structural fields the lettered rules stand on ─────────────────────────
  if (typeof p.external_key !== "string" || p.external_key.trim() === "") {
    fail("f", "external_key is missing or empty");
  }
  if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date as string)) {
    fail("f", `date must be a YYYY-MM-DD string, got ${JSON.stringify(p.date)}`);
  }
  if (!isRecord(p.course)) fail("f", "course is missing");
  const course = p.course as Record<string, unknown>;
  if (typeof course.name !== "string" || course.name.trim() === "") {
    fail("shape", "course.name is missing or empty");
  }
  if (typeof course.slug !== "string" || course.slug.trim() === "") {
    fail("f", "course.slug is missing or empty");
  }
  if (p.reflection != null && typeof p.reflection !== "string") {
    fail("shape", "reflection must be a string or null");
  }

  // ── (g) tee_box present with rating + slope — the required-tee_box rule ───
  if (!isRecord(p.tee_box)) fail("g", "tee_box is missing (required: tee_box_id must resolve)");
  const teeBox = p.tee_box as Record<string, unknown>;
  if (typeof teeBox.name !== "string" || teeBox.name.trim() === "") {
    fail("g", "tee_box.name is missing or empty");
  }
  if (typeof teeBox.rating !== "number" || !Number.isFinite(teeBox.rating)) {
    fail("g", `tee_box.rating must be a finite number, got ${JSON.stringify(teeBox.rating)}`);
  }
  if (typeof teeBox.slope !== "number" || !Number.isInteger(teeBox.slope)) {
    fail("g", `tee_box.slope must be an integer, got ${JSON.stringify(teeBox.slope)}`);
  }
  if (teeBox.yardage != null && !Number.isInteger(teeBox.yardage)) {
    fail("g", `tee_box.yardage must be an integer when present, got ${JSON.stringify(teeBox.yardage)}`);
  }

  // ── (e) differential + differential_source present, source in the CHECK list ──
  if (!isRecord(p.score)) fail("e", "score is missing");
  const score = p.score as Record<string, unknown>;
  if (typeof score.gross !== "number" || !Number.isInteger(score.gross)) {
    fail("b", `score.gross must be an integer, got ${JSON.stringify(score.gross)}`);
  }
  if (typeof score.differential !== "number" || !Number.isFinite(score.differential)) {
    fail("e", "differential is missing or not a finite number");
  }
  if (!DIFFERENTIAL_SOURCES.includes(score.differential_source as DifferentialSource)) {
    fail(
      "e",
      `differential_source ${JSON.stringify(score.differential_source)} is not one of: ${DIFFERENTIAL_SOURCES.join(", ")}`,
    );
  }

  // ── (a) exactly 18 holes, numbers 1–18 unique ──────────────────────────────
  if (!Array.isArray(p.holes)) fail("a", "holes is missing or not an array");
  const rawHoles = p.holes as unknown[];
  if (rawHoles.length !== 18) {
    fail("a", `expected exactly 18 holes, got ${rawHoles.length}`);
  }
  const seen = new Set<number>();
  const holes: RoundHolePayload[] = rawHoles.map((entry, i) => {
    if (!isRecord(entry)) fail("shape", `holes[${i}] is not an object`);
    const h = entry as Record<string, unknown>;
    if (!Number.isInteger(h.hole) || (h.hole as number) < 1 || (h.hole as number) > 18) {
      fail("a", `holes[${i}].hole must be an integer 1–18, got ${JSON.stringify(h.hole)}`);
    }
    const holeNumber = h.hole as number;
    if (seen.has(holeNumber)) fail("a", `hole number ${holeNumber} appears more than once`);
    seen.add(holeNumber);
    if (!Number.isInteger(h.par) || (h.par as number) < 3) {
      fail("shape", `hole ${holeNumber}: par must be an integer >= 3, got ${JSON.stringify(h.par)}`);
    }
    if (!Number.isInteger(h.strokes) || (h.strokes as number) < 1) {
      fail("shape", `hole ${holeNumber}: strokes must be a positive integer, got ${JSON.stringify(h.strokes)}`);
    }
    if (!Number.isInteger(h.putts) || (h.putts as number) < 0) {
      fail("shape", `hole ${holeNumber}: putts must be a non-negative integer, got ${JSON.stringify(h.putts)}`);
    }
    if (typeof h.gir !== "boolean") {
      fail("shape", `hole ${holeNumber}: gir must be a boolean, got ${JSON.stringify(h.gir)}`);
    }
    // (d) — value domain first (shared FAIRWAY_RESULTS list), then the IFF rule.
    const fw = h.fairway_result;
    if (fw !== null && !FAIRWAY_RESULTS.includes(fw as FairwayResult)) {
      fail(
        "d",
        `hole ${holeNumber}: fairway_result ${JSON.stringify(fw)} is not null or one of: ${FAIRWAY_RESULTS.join(", ")}`,
      );
    }
    if (h.par === 3 && fw !== null) {
      fail("d", `hole ${holeNumber} is a par 3 but fairway_result is ${JSON.stringify(fw)} (must be null)`);
    }
    if (h.par !== 3 && fw === null) {
      fail("d", `hole ${holeNumber} is a par ${h.par} but fairway_result is null (null is par-3-only)`);
    }
    return {
      hole: holeNumber,
      par: h.par as number,
      strokes: h.strokes as number,
      putts: h.putts as number,
      fairway_result: fw as FairwayResult | null,
      gir: h.gir as boolean,
    };
  });

  // ── (b) sum(strokes) === score.gross ───────────────────────────────────────
  const strokeSum = holes.reduce((s, h) => s + h.strokes, 0);
  if (strokeSum !== score.gross) {
    fail("b", `sum(strokes) = ${strokeSum} but score.gross = ${score.gross}`);
  }

  // ── (c) putts <= strokes on every hole ─────────────────────────────────────
  for (const h of holes) {
    if (h.putts > h.strokes) {
      fail("c", `hole ${h.hole}: putts (${h.putts}) > strokes (${h.strokes})`);
    }
  }

  // ── (f) external_key === date + '_' + course.slug; filename matches ────────
  const expectedKey = `${p.date}_${course.slug}`;
  if (p.external_key !== expectedKey) {
    fail(
      "f",
      `external_key ${JSON.stringify(p.external_key)} !== date + '_' + course.slug (${JSON.stringify(expectedKey)})`,
    );
  }
  if (filename !== `${p.external_key}.json`) {
    fail(
      "f",
      `filename ${JSON.stringify(filename)} !== external_key + '.json' (${JSON.stringify(`${p.external_key}.json`)})`,
    );
  }

  return {
    external_key: p.external_key as string,
    date: p.date as string,
    course: { name: course.name as string, slug: course.slug as string },
    tee_box: {
      name: teeBox.name as string,
      rating: teeBox.rating as number,
      slope: teeBox.slope as number,
      yardage: (teeBox.yardage as number | undefined) ?? null,
    },
    score: {
      gross: score.gross as number,
      differential: score.differential as number,
      differential_source: score.differential_source as DifferentialSource,
    },
    holes: [...holes].sort((x, y) => x.hole - y.hole),
    reflection: (p.reflection as string | undefined) ?? null,
  };
}
