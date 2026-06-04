import "server-only";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { normalizeClub, type ConfidenceFlag } from "@gai/shared";
import { getPool } from "./db";

// =============================================================
// Phase 2A — Trackman CSV importer + per-club dispersion recompute.
//
// Flow: parse a Trackman export -> insert one `shot` row per swing ->
// recompute `club_dispersion` for any club that now has enough real shots,
// flipping its invariant #2 confidence flag to `measured`. No Anthropic
// calls, no geometry — just arithmetic over numbers (invariant #1 lives in
// sg-engine; this is plain ingestion, not SG math).
// =============================================================

/** A club needs at least this many real shots before its dispersion is `measured`. */
export const MEASURED_MIN_SHOTS = 10;

/** One parsed launch-monitor row, already mapped to the `shot` schema. */
export interface ShotRow {
  club: string;
  carry_yards: number;
  total_yards: number | null;
  ball_speed_mph: number | null;
  launch_angle_deg: number | null;
  launch_dir_deg: number | null;
  carry_side_yards: number | null;
  session_date: string | null; // ISO date (YYYY-MM-DD) or null
}

/** Per-club outcome of a recompute pass. */
export interface DispersionResult {
  club: string;
  shot_count: number;
  carry_mean_yards: number;
  carry_sd_yards: number;
  lateral_sd_yards: number;
  confidence: ConfidenceFlag;
}

export interface ImportSummary {
  shotsInserted: number;
  /** Clubs whose dispersion flipped to (or stayed) `measured` this run. */
  measured: string[];
  /** Clubs still carrying a non-measured flag (too few shots, or only seeded). */
  notMeasured: { club: string; confidence: ConfidenceFlag; shot_count: number }[];
}

// ── CSV parsing ─────────────────────────────────────────────────────────────
// Trackman exports are comma-separated with a header row. Headers vary across
// app versions and locales ("Carry", "Carry (yds)", "Carry [yds]"), so we
// normalize each header to a bare lowercase token and match against aliases.

/** Map a normalized header token to a ShotRow field. */
const HEADER_ALIASES: Record<string, keyof ShotRow> = {
  club: "club",
  carry: "carry_yards",
  carryyards: "carry_yards",
  carryyds: "carry_yards",
  total: "total_yards",
  totalyards: "total_yards",
  totalyds: "total_yards",
  ballspeed: "ball_speed_mph",
  ballspeedmph: "ball_speed_mph",
  launchangle: "launch_angle_deg",
  launchangledeg: "launch_angle_deg",
  launchdeg: "launch_angle_deg",
  launchdirection: "launch_dir_deg",
  launchdir: "launch_dir_deg",
  carryside: "carry_side_yards",
  side: "carry_side_yards",
  sideyds: "carry_side_yards",
  sideyards: "carry_side_yards",
  sideft: "carry_side_yards",
  sidefeet: "carry_side_yards",
  date: "session_date",
  sessiondate: "session_date",
};

/** Side-column headers carrying values in FEET — converted to yards (÷3) on import.
 *  The schema stores carry_side in yards; a column literally labeled feet must be
 *  converted or lateral dispersion comes out ~3× too wide. */
const SIDE_FEET_HEADERS = new Set(["sideft", "sidefeet"]);
const FEET_PER_YARD = 3;

/** Header tokens whose truthy value (Y/yes/true/1) gates whether a row imports. */
const INCLUDE_HEADERS = new Set(["include", "use", "included"]);
const INCLUDE_TRUE = new Set(["y", "yes", "true", "1", "t"]);

/** Strip units/punctuation: "Carry Side (yds)" -> "carryside". */
function normalizeHeader(h: string): string {
  return h
    .replace(/\(.*?\)|\[.*?\]/g, "") // drop "(yds)", "[mph]"
    .replace(/[^a-zA-Z]/g, "")
    .toLowerCase();
}

/** Minimal RFC-4180-ish splitter: handles quoted fields and embedded commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parse a numeric cell. Tolerates stray units ("230.5 yds") and a trailing
 * L/R side convention ("4.2R" -> +4.2, "3.1L" -> -3.1). Empty -> null.
 */
function parseNumeric(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s) return null;
  const side = /([LR])\s*$/i.exec(s)?.[1]?.toUpperCase();
  const cleaned = s.replace(/[^0-9.+-]/g, "");
  if (!cleaned || cleaned === "+" || cleaned === "-") return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return side === "L" ? -Math.abs(n) : n;
}

/** Parse Trackman CSV text into ShotRow[]. Rows missing club or carry are skipped. */
export function parseTrackmanCsv(text: string): ShotRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!).map(normalizeHeader);
  const fieldFor = headers.map((h) => HEADER_ALIASES[h]);
  // Optional include/use flag column: when present, only Y/yes/true/1 rows import.
  const includeIdx = headers.findIndex((h) => INCLUDE_HEADERS.has(h));
  // Is the side column in feet? If so, convert to yards when building each row.
  const sideIdx = fieldFor.findIndex((f) => f === "carry_side_yards");
  const sideInFeet = sideIdx >= 0 && SIDE_FEET_HEADERS.has(headers[sideIdx]!);

  const rows: ShotRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);

    if (includeIdx >= 0) {
      const flag = (cells[includeIdx] ?? "").trim().toLowerCase();
      if (!INCLUDE_TRUE.has(flag)) continue; // explicitly not-included -> skip
    }

    const rec: Partial<Record<keyof ShotRow, string>> = {};
    fieldFor.forEach((field, idx) => {
      if (field) rec[field] = cells[idx];
    });

    const club = rec.club?.trim();
    const carry = parseNumeric(rec.carry_yards);
    if (!club || carry == null) continue; // club + carry are the minimum viable row

    let side = parseNumeric(rec.carry_side_yards);
    if (side != null && sideInFeet) side = Math.round((side / FEET_PER_YARD) * 100) / 100;

    rows.push({
      club: normalizeClub(club), // canonical key so shots merge with the seed (invariant #2)
      carry_yards: carry,
      total_yards: parseNumeric(rec.total_yards),
      ball_speed_mph: parseNumeric(rec.ball_speed_mph),
      launch_angle_deg: parseNumeric(rec.launch_angle_deg),
      launch_dir_deg: parseNumeric(rec.launch_dir_deg),
      carry_side_yards: side,
      session_date: rec.session_date?.trim() || null,
    });
  }
  return rows;
}

// ── Inserts + recompute ──────────────────────────────────────────────────────

/** Insert parsed shots in one transaction. Returns the count written. */
export async function insertShots(
  pool: Pool,
  rows: ShotRow[],
  source = "trackman"
): Promise<number> {
  if (rows.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      await client.query(
        `INSERT INTO shot
           (club, carry_yards, total_yards, ball_speed_mph,
            launch_angle_deg, launch_dir_deg, carry_side_yards, session_date, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          r.club,
          r.carry_yards,
          r.total_yards,
          r.ball_speed_mph,
          r.launch_angle_deg,
          r.launch_dir_deg,
          r.carry_side_yards,
          r.session_date,
          source,
        ]
      );
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Recompute `club_dispersion` from the `shot` table for the given clubs (or all
 * clubs present in `shot` when omitted). A club with >= MEASURED_MIN_SHOTS real
 * shots gets carry mean/SD and lateral SD (from carry_side_yards) and flips to
 * `confidence = 'measured'`; the row's updated_at is bumped. Clubs below the
 * threshold are left untouched (their seeded/partial row stands).
 *
 * SD uses the sample standard deviation (stddev_samp). lateral_sd is computed
 * only over non-null carry_side values; if a club has none, it keeps its prior
 * lateral_sd (or 0 for a brand-new row) so the NOT NULL column always holds.
 */
export async function recomputeDispersion(
  pool: Pool,
  clubs?: string[]
): Promise<DispersionResult[]> {
  const { rows } = await pool.query<{
    club: string;
    n: string;
    carry_mean: string;
    carry_sd: string | null;
    lateral_sd: string | null;
  }>(
    `SELECT club,
            count(*)                       AS n,
            avg(carry_yards)               AS carry_mean,
            stddev_samp(carry_yards)       AS carry_sd,
            stddev_samp(carry_side_yards)  AS lateral_sd
       FROM shot
      ${clubs && clubs.length ? "WHERE club = ANY($1)" : ""}
      GROUP BY club
     HAVING count(*) >= ${MEASURED_MIN_SHOTS}`,
    clubs && clubs.length ? [clubs] : []
  );

  const results: DispersionResult[] = [];
  for (const r of rows) {
    const carryMean = Number(r.carry_mean);
    const carrySd = r.carry_sd == null ? 0 : Number(r.carry_sd);
    const lateralSd = r.lateral_sd == null ? null : Number(r.lateral_sd);
    const shotCount = Number(r.n);

    const { rows: written } = await pool.query<{
      carry_mean_yards: string;
      carry_sd_yards: string;
      lateral_sd_yards: string;
      shot_count: number;
      confidence: ConfidenceFlag;
    }>(
      `INSERT INTO club_dispersion
         (club, carry_mean_yards, carry_sd_yards, lateral_sd_yards, shot_count, confidence, updated_at)
       VALUES ($1, $2, $3, COALESCE($4::numeric, 0), $5, 'measured', now())
       ON CONFLICT (club) DO UPDATE SET
         carry_mean_yards = EXCLUDED.carry_mean_yards,
         carry_sd_yards   = EXCLUDED.carry_sd_yards,
         -- keep the prior lateral SD when this batch had no side data
         lateral_sd_yards = COALESCE($4::numeric, club_dispersion.lateral_sd_yards),
         shot_count       = EXCLUDED.shot_count,
         confidence       = 'measured',
         updated_at       = now()
       RETURNING carry_mean_yards, carry_sd_yards, lateral_sd_yards, shot_count, confidence`,
      [r.club, carryMean, carrySd, lateralSd, shotCount]
    );

    const w = written[0];
    if (!w) continue; // upsert always returns a row; guard satisfies the type checker
    results.push({
      club: r.club,
      shot_count: w.shot_count,
      carry_mean_yards: Number(w.carry_mean_yards),
      carry_sd_yards: Number(w.carry_sd_yards),
      lateral_sd_yards: Number(w.lateral_sd_yards),
      confidence: w.confidence,
    });
  }
  return results;
}

/**
 * Full import: parse the CSV at `csvPath`, insert the shots, recompute the
 * affected clubs' dispersion, and return a summary of which clubs are now
 * `measured` vs. still seeded/partial.
 */
export async function importTrackmanCsv(
  csvPath: string,
  pool: Pool = getPool()
): Promise<ImportSummary> {
  const text = readFileSync(csvPath, "utf8");
  const rows = parseTrackmanCsv(text);
  const shotsInserted = await insertShots(pool, rows);

  const touchedClubs = [...new Set(rows.map((r) => r.club))];
  const measuredResults = await recomputeDispersion(pool, touchedClubs);
  const measured = measuredResults.map((r) => r.club);

  // Clubs we imported but that did NOT reach `measured` — report their standing flag.
  const stillBelow = touchedClubs.filter((c) => !measured.includes(c));
  const notMeasured: ImportSummary["notMeasured"] = [];
  if (stillBelow.length) {
    const { rows: standing } = await pool.query<{
      club: string;
      confidence: ConfidenceFlag;
      shot_count: number;
    }>(
      `SELECT cd.club,
              cd.confidence,
              (SELECT count(*)::int FROM shot s WHERE s.club = cd.club) AS shot_count
         FROM club_dispersion cd
        WHERE cd.club = ANY($1)`,
      [stillBelow]
    );
    const known = new Map(standing.map((s) => [s.club, s]));
    for (const club of stillBelow) {
      const s = known.get(club);
      notMeasured.push(
        s
          ? { club, confidence: s.confidence, shot_count: s.shot_count }
          : { club, confidence: "seeded", shot_count: 0 } // imported but no dispersion row yet
      );
    }
  }

  return { shotsInserted, measured: measured.sort(), notMeasured };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Run: tsx services/api/src/importer.ts <path-to-trackman.csv>
// DATABASE_URL must be set (from apps/web/.env.local — invariant #3, server-side).

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("usage: importer <path-to-trackman.csv>");
    process.exitCode = 1;
    return;
  }
  const summary = await importTrackmanCsv(csvPath);
  console.log(`Imported ${summary.shotsInserted} shots from ${csvPath}.`);
  if (summary.measured.length) {
    console.log(`  measured (>=${MEASURED_MIN_SHOTS} shots): ${summary.measured.join(", ")}`);
  }
  for (const n of summary.notMeasured) {
    console.log(`  ${n.confidence.padEnd(8)} ${n.club} (${n.shot_count} shots — below threshold)`);
  }
  await getPool().end();
}

// Only run as a script, not on import (e.g. from tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
