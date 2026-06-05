import "server-only";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Pool } from "pg";
import { normalizeClub, type ConfidenceFlag } from "@gai/shared";
import { getPool } from "./db";
import { recomputeDispersion } from "./importer";

// =============================================================
// Phase 2A — Seed `club_dispersion` from handicap_dispersion_seed.md.
//
// "Markdown all the way down" (root CLAUDE.md): the seed lives as a hand-edited
// design doc whose machine-readable payload is a single ```json block. We read
// that block and derive each club's seeded dispersion from the tier model:
//
//   lateral_SD_yards  = carry_yards * lateral_pct[tier]
//   distance_SD_yards = carry_yards * distance_pct[tier]   (the carry SD)
//
// Carries come from the player's measured bag; a club with no measured carry
// (driver: null) falls back to the tier's default carry, still flagged seeded.
//
// CONFIDENCE — invariant #2, and a deliberate departure from the original Phase
// 2A prompt: the prompt said "driver = partial", but this file flags the WHOLE
// bag's dispersion as seeded ("seeded_pending_raw_trackman_side_data") and the
// driver specifically as seeded/PENDING with a null carry. `partial` means a
// small REAL sample (<20 shots); driver has zero shots, so seeded is the only
// honest flag. Every seeded row therefore lands at confidence='seeded'. The
// importer's recompute is what later ratchets a club up to 'measured'.
//
// A row already at 'measured' is NEVER overwritten — confidence only ratchets up.
// =============================================================

/** Repo root: this module is services/api/src/, so up three levels. */
const DEFAULT_SEED_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..",
  "handicap_dispersion_seed.md"
);

export interface SeedRow {
  club: string;
  carry_mean_yards: number;
  carry_sd_yards: number;
  lateral_sd_yards: number;
  confidence: ConfidenceFlag;
}

/** Shape of the relevant slice of the ```json seed block. */
interface SeedJson {
  model?: {
    tiers?: Record<string, { lateral_pct: number; distance_pct: number }>;
  };
  default_carries_yards?: Record<string, Record<string, number>>;
  player_michael_measured_carries_yards?: Record<string, number | null>;
  player_michael_tier?: string;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Pull and parse the single fenced ```json block out of the markdown. */
function extractJsonBlock(md: string): SeedJson {
  const m = /```json\s*([\s\S]*?)```/.exec(md);
  if (!m || !m[1]) throw new Error("handicap seed: no ```json block found");
  try {
    return JSON.parse(m[1]) as SeedJson;
  } catch (e) {
    throw new Error(`handicap seed: json block failed to parse: ${(e as Error).message}`);
  }
}

/**
 * Parse the seed markdown into SeedRow[]. Derives each club in the player's
 * measured bag from the tier dispersion model; driver (null carry) falls back
 * to the tier default carry. Every row is `seeded` (see header note). Throws on
 * a malformed/empty seed rather than seeding garbage.
 */
export function parseHandicapSeed(md: string): SeedRow[] {
  const seed = extractJsonBlock(md);

  const tier = seed.player_michael_tier;
  if (!tier) throw new Error("handicap seed: player_michael_tier missing");

  const tierConst = seed.model?.tiers?.[tier];
  if (!tierConst) throw new Error(`handicap seed: no tier constants for "${tier}"`);
  const lateralPct = Number(tierConst.lateral_pct);
  const distancePct = Number(tierConst.distance_pct);
  if (!Number.isFinite(lateralPct) || !Number.isFinite(distancePct)) {
    throw new Error(`handicap seed: tier "${tier}" has non-numeric pct constants`);
  }

  const measured = seed.player_michael_measured_carries_yards ?? {};
  const defaults = seed.default_carries_yards?.[tier] ?? {};

  const rows: SeedRow[] = [];
  for (const club of Object.keys(measured)) {
    const measuredCarry = measured[club];
    const carryRaw = measuredCarry == null ? defaults[club] : measuredCarry;
    if (carryRaw == null) continue; // no carry anywhere -> can't draw an ellipse
    const carry = Number(carryRaw);
    if (!Number.isFinite(carry)) continue;

    rows.push({
      club: normalizeClub(club), // canonical key so measured imports later collide on this row
      carry_mean_yards: round1(carry),
      carry_sd_yards: round1(carry * distancePct),
      lateral_sd_yards: round1(carry * lateralPct),
      confidence: "seeded",
    });
  }

  if (rows.length === 0) throw new Error("handicap seed: no clubs produced");
  return rows;
}

export interface SeedSummary {
  seeded: { club: string; confidence: ConfidenceFlag }[];
  /** Clubs left as-is because their dispersion is already `measured`. */
  skippedMeasured: string[];
}

/**
 * Seed `club_dispersion` from the handicap markdown. Inserts each club, and on
 * conflict updates ONLY when the existing row is not yet `measured`, so real
 * measured data is never downgraded back to a seeded estimate.
 */
export async function seedDispersion(
  pool: Pool = getPool(),
  seedPath: string = DEFAULT_SEED_PATH
): Promise<SeedSummary> {
  const md = readFileSync(seedPath, "utf8");
  const rows = parseHandicapSeed(md);

  const seeded: SeedSummary["seeded"] = [];
  const skippedMeasured: string[] = [];

  for (const r of rows) {
    const { rows: written } = await pool.query<{ club: string; confidence: ConfidenceFlag }>(
      `INSERT INTO club_dispersion
         (club, carry_mean_yards, carry_sd_yards, lateral_sd_yards, shot_count, confidence, updated_at)
       VALUES ($1, $2, $3, $4, 0, $5, now())
       ON CONFLICT (club) DO UPDATE SET
         carry_mean_yards = EXCLUDED.carry_mean_yards,
         carry_sd_yards   = EXCLUDED.carry_sd_yards,
         lateral_sd_yards = EXCLUDED.lateral_sd_yards,
         confidence       = EXCLUDED.confidence,
         updated_at       = now()
       WHERE club_dispersion.confidence <> 'measured'
       RETURNING club, confidence`,
      [r.club, r.carry_mean_yards, r.carry_sd_yards, r.lateral_sd_yards, r.confidence]
    );

    const w = written[0];
    if (w) seeded.push({ club: w.club, confidence: w.confidence });
    else skippedMeasured.push(r.club); // ON CONFLICT WHERE matched nothing => already measured
  }

  return { seeded, skippedMeasured };
}

// =============================================================
// Phase 2B — promote clubs to `measured` at a lower shot threshold.
//
// The importer's recompute only flips a club to `measured` at MEASURED_MIN_SHOTS
// (10) real shots, and it never touches the shot_count column for clubs below
// that bar — so the seeded rows still read shot_count = 0 even though the `shot`
// table holds 5-9 real swings for each of them. A literal `UPDATE ... WHERE
// shot_count >= 5` on club_dispersion would therefore flip nothing.
//
// Per Phase 2B (decision D-2B-1, docs/DECISIONS.md) the measured bar drops to 5
// for this bag. We honor invariant #2 by RECOMPUTING from the real shots at that
// threshold — so a club that flips to `measured` carries real carry mean / SD /
// lateral SD, not a relabeled seeded estimate. Confidence only ever ratchets up.
// =============================================================

/** Phase 2B measured threshold — see decision D-2B-1. */
export const PROMOTE_MIN_SHOTS = 5;

export interface PromoteSummary {
  /** Clubs that were not `measured` before and are `measured` now. */
  flipped: { club: string; shot_count: number; from: ConfidenceFlag }[];
  /** Clubs already `measured` before this run (left as-is, possibly restatted). */
  alreadyMeasured: string[];
}

/**
 * Ratchet every club with >= `minShots` real shots up to `confidence = 'measured'`,
 * recomputing its dispersion from the `shot` table so the flag tracks real data.
 * Returns which clubs flipped (for the operator log) and which were already
 * measured. Pure ratchet: a measured club is never downgraded.
 */
export async function promoteMeasuredByShotCount(
  pool: Pool = getPool(),
  minShots: number = PROMOTE_MIN_SHOTS
): Promise<PromoteSummary> {
  // Snapshot confidence before, so we can report exactly which clubs flipped.
  const { rows: before } = await pool.query<{ club: string; confidence: ConfidenceFlag }>(
    "SELECT club, confidence FROM club_dispersion"
  );
  const wasMeasured = new Set(before.filter((r) => r.confidence === "measured").map((r) => r.club));
  const priorConfidence = new Map(before.map((r) => [r.club, r.confidence] as const));

  // Recompute (and flip to measured) every club that now clears the lower bar.
  const recomputed = await recomputeDispersion(pool, undefined, minShots);

  const flipped: PromoteSummary["flipped"] = [];
  const alreadyMeasured: string[] = [];
  for (const r of recomputed) {
    if (wasMeasured.has(r.club)) {
      alreadyMeasured.push(r.club);
    } else {
      flipped.push({
        club: r.club,
        shot_count: r.shot_count,
        from: priorConfidence.get(r.club) ?? "seeded",
      });
    }
  }
  flipped.sort((a, b) => a.club.localeCompare(b.club));
  alreadyMeasured.sort();
  return { flipped, alreadyMeasured };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Seed:    tsx services/api/src/seedDispersion.ts [path-to-handicap_dispersion_seed.md]
// Promote: tsx services/api/src/seedDispersion.ts promote [minShots]
async function main(): Promise<void> {
  const mode = process.argv[2];

  if (mode === "promote") {
    const minShots = process.argv[3] ? Number(process.argv[3]) : PROMOTE_MIN_SHOTS;
    const { flipped, alreadyMeasured } = await promoteMeasuredByShotCount(getPool(), minShots);
    console.log(`Promote (>=${minShots} real shots): ${flipped.length} club(s) flipped to measured.`);
    for (const f of flipped) {
      console.log(`  ${f.from.padEnd(8)} -> measured  ${f.club.padEnd(6)} (${f.shot_count} shots)`);
    }
    if (alreadyMeasured.length) {
      console.log(`  already measured (restatted): ${alreadyMeasured.sort().join(", ")}`);
    }
    await getPool().end();
    return;
  }

  const seedPath = mode ?? DEFAULT_SEED_PATH;
  const summary = await seedDispersion(getPool(), seedPath);
  console.log(`Seeded ${summary.seeded.length} clubs from ${seedPath}.`);
  for (const s of summary.seeded) console.log(`  ${s.confidence.padEnd(8)} ${s.club}`);
  if (summary.skippedMeasured.length) {
    console.log(`  left as measured (not overwritten): ${summary.skippedMeasured.join(", ")}`);
  }
  await getPool().end();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
