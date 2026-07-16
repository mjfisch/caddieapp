import "server-only";
import type pg from "pg";
import { getPool } from "./db";
import type { FairwayResult } from "./rounds";

// =============================================================
// Mission S6 — the Stats tab's read path. READ-ONLY consumption of
// round/round_hole/course (D25): one query loads every non-test round with
// its holes, and the pure derivation module (apps/web .../stats/computeStats)
// does all the math. Nothing here aggregates — windows and stat groups are
// derived in one place, client and tests alike.
// =============================================================

export type StatsRoundHoleRow = {
  par: number | null;
  strokes: number;
  putts: number | null;
  fairwayResult: FairwayResult | null;
  gir: boolean | null;
};

export type StatsRoundRow = {
  id: string;
  playedDate: string;
  differential: number;
  isTest: boolean;
  holes: StatsRoundHoleRow[];
};

export type StatsDeps = { pool?: pg.Pool };

/**
 * Every non-test round, newest first (played_date, then created_at), each with
 * its holes in hole order. Par comes from the positional course-hole join
 * (round_hole has no hole FK) and stays null when the course row is missing —
 * the derivation module excludes such holes rather than guessing. The three
 * §4 windows are query windows over this full list (D24 — nothing is ever
 * deleted), applied by the pure selectWindow(), not by SQL.
 */
export async function listStatsRounds(deps: StatsDeps = {}): Promise<StatsRoundRow[]> {
  const pool = deps.pool ?? getPool();
  const { rows } = await pool.query<{
    id: string;
    played_date: string;
    differential: string;
    is_test: boolean;
    par: number | null;
    strokes: number;
    putts: number | null;
    fairway_result: FairwayResult | null;
    gir: boolean | null;
  }>(
    `SELECT r.id,
            to_char(r.played_date, 'YYYY-MM-DD') AS played_date,
            r.differential,
            r.is_test,
            h.par,
            rh.strokes, rh.putts, rh.fairway_result, rh.gir
       FROM round r
       JOIN round_hole rh ON rh.round_id = r.id
       LEFT JOIN hole h ON h.course_id = r.course_id AND h.number = rh.hole_number
      WHERE r.is_test = false
      ORDER BY r.played_date DESC, r.created_at DESC, r.id, rh.hole_number`,
  );

  const out: StatsRoundRow[] = [];
  let current: StatsRoundRow | undefined;
  for (const row of rows) {
    if (!current || current.id !== row.id) {
      current = {
        id: row.id,
        playedDate: row.played_date,
        // numeric comes back from pg as a string; the payload validator
        // guaranteed it finite on the way in.
        differential: Number(row.differential),
        isTest: row.is_test === true,
        holes: [],
      };
      out.push(current);
    }
    current.holes.push({
      par: row.par,
      strokes: row.strokes,
      putts: row.putts,
      fairwayResult: row.fairway_result,
      gir: row.gir,
    });
  }
  return out;
}
