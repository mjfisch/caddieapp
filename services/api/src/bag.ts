import "server-only";
import type pg from "pg";
import type { ConfidenceFlag } from "@gai/shared";
import { getPool } from "./db";
import { BAG_CLUBS } from "./practice";

// =============================================================
// Mission 3a — Bag tab data access (DISPLAY ONLY).
//
// One read against the canonical `club_dispersion` table (the SINGLE source of
// truth the SG engine consumes) joined to each club's most-recent shot date.
// No SG/EV compute, no LLM, no profile data — the page just narrates what the
// dataset already records (invariant #1: the math lives in sg-engine, not here).
//
// Invariant #2 rides along untouched: every row carries its `confidence` flag,
// its real measured `lateral_sd_yards`, and its `shot_count` so the UI can keep
// the carry's certainty and the dispersion's certainty honest and INDEPENDENT.
// =============================================================

/** One bag club as the Bag tab renders it. Canonical numbers, no derived score. */
export type BagClub = {
  /** Canonical club id (driver / 3h / 7i / PW / GW50 …). */
  club: string;
  /** Mean carry in yards, rounded for display. */
  carryYards: number;
  /** Measured lateral dispersion (1-SD) in yards — the real spread, not a score. */
  lateralSdYards: number;
  /** How many real shots back this row (drives whether the dispersion is trustworthy). */
  shotCount: number;
  /** Invariant #2 flag for the row: measured | partial | seeded. */
  confidence: ConfidenceFlag;
  /** Most recent shot date for this club ('YYYY-MM-DD'), or null if never measured. */
  lastSession: string | null;
};

/**
 * Read the bag from `club_dispersion`, ordered by carry descending (driver →
 * 64° LW), each row joined to its latest shot date. Filtered to the fixed bag
 * (BAG_CLUBS) so stray fixture clubs can never leak into the list and the order
 * is deterministic. Pure read — no writes, safe against the shared DB.
 */
export async function getBagClubs(pool: pg.Pool = getPool()): Promise<BagClub[]> {
  const { rows } = await pool.query<{
    club: string;
    carry_mean_yards: string;
    lateral_sd_yards: string;
    shot_count: number;
    confidence: ConfidenceFlag;
    last_session: string | null;
  }>(
    `SELECT cd.club,
            cd.carry_mean_yards,
            cd.lateral_sd_yards,
            cd.shot_count,
            cd.confidence,
            to_char(s.last_session, 'YYYY-MM-DD') AS last_session
       FROM club_dispersion cd
       LEFT JOIN (
            SELECT club, max(session_date) AS last_session
              FROM shot
             GROUP BY club
       ) s ON s.club = cd.club
      WHERE cd.club = ANY($1)
      ORDER BY cd.carry_mean_yards DESC`,
    [BAG_CLUBS as readonly string[]],
  );

  return rows.map((r) => ({
    club: r.club,
    carryYards: Math.round(Number(r.carry_mean_yards)),
    lateralSdYards: Math.round(Number(r.lateral_sd_yards)),
    shotCount: r.shot_count,
    confidence: r.confidence,
    lastSession: r.last_session,
  }));
}

/**
 * Mission 3b — Card 1 (shot-count progress). The LIVE count of measured shots
 * per bag club, straight from the `shot` log. Deliberately NOT the denormalized
 * `club_dispersion.shot_count`: that column is a recompute snapshot that lags
 * behind (it stays 0 for clubs below the measured bar — see importer.ts), so a
 * "shots logged so far" card must count the raw rows. Pure read, no writes.
 *
 * Returns club → count for clubs that have any shots; a club with none is simply
 * absent (callers treat a missing key as 0). Filtered to BAG_CLUBS so stray
 * fixture clubs can't inflate the tally.
 */
export async function getClubShotCounts(
  pool: pg.Pool = getPool(),
): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ club: string; n: string }>(
    `SELECT club, count(*)::int AS n
       FROM shot
      WHERE club = ANY($1)
      GROUP BY club`,
    [BAG_CLUBS as readonly string[]],
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.club] = Number(r.n);
  return counts;
}
