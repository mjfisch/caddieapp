import "server-only";
import type pg from "pg";
import { getPool } from "./db";

// =============================================================
// Mission S8 — the Stats tab's PRACTICE read path (D28). READ-ONLY consumption
// of practice_session / session_drill_block / session_drill_value / drill /
// drill_metric_def / session_club. Nothing here aggregates: the pure derivation
// module (apps/web/.../stats/computePracticeStats) does all the math, so the
// windows and the stat groups are derived in one place, client and tests alike.
//
// Deliberately NOT selected (mission scope: dead fields): location, surface,
// ball, shot_shape. Notes and recaps stay in the Practice log, not in Stats;
// overall_rating is not displayed in v1. practice_session has no is_test
// column, so there is no test-row predicate here (and none is invented).
// =============================================================

export type PracticeStatsDrillValueRow = {
  label: string;
  value: number;
};

export type PracticeStatsBlockRow = {
  drillTitle: string;
  position: number;
  values: PracticeStatsDrillValueRow[];
};

export type PracticeStatsSessionRow = {
  id: string;
  date: string;
  type: string;
  durationMin: number | null;
  lieTypes: string[];
  shotTypes: string[];
  clubs: string[];
  blocks: PracticeStatsBlockRow[];
};

export type PracticeStatsMetricDefRow = {
  drillTitle: string;
  label: string;
  valueType: string;
  unit: string | null;
  better: "lower" | "higher" | null;
  sortOrder: number | null;
};

export type PracticeStatsPayload = {
  sessions: PracticeStatsSessionRow[];
  metricDefs: PracticeStatsMetricDefRow[];
};

export type PracticeStatsDeps = { pool?: pg.Pool };

/**
 * Every practice session, newest first, each with its around-green tag arrays,
 * its club tags, and (for putting sessions) its ordered drill blocks and the
 * metric values actually filled. Returned alongside the full drill_metric_def
 * table, which is what lets the view shape a drill card it has never seen
 * before — drills are discovered from the data, never hardcoded (D28).
 *
 * The three windows (4W / 12W / YTD) are query windows over this full list,
 * applied by the pure selectPracticeWindow(), not by SQL.
 */
export async function listPracticeStats(
  deps: PracticeStatsDeps = {},
): Promise<PracticeStatsPayload> {
  const pool = deps.pool ?? getPool();

  const { rows: sessionRows } = await pool.query<{
    id: string;
    date: string;
    type: string;
    duration_min: number | null;
    lie_types: string[] | null;
    shot_types: string[] | null;
  }>(
    `SELECT s.id, to_char(s.date, 'YYYY-MM-DD') AS date, s.type, s.duration_min,
            s.lie_types, s.shot_types
       FROM practice_session s
      ORDER BY s.date DESC, s.created_at DESC`,
  );

  if (sessionRows.length === 0) return { sessions: [], metricDefs: [] };
  const ids = sessionRows.map((r) => r.id);

  // Drill blocks + the metrics actually filled, in block position order. Blocks
  // are joined by drill TITLE (the same key the metric defs carry) so the pure
  // module never needs a uuid to line a value up with its definition.
  const { rows: blockRows } = await pool.query<{
    practice_session_id: string;
    drill_title: string;
    position: number;
    values: Array<{ label: string; value: string | number }> | null;
  }>(
    `SELECT b.practice_session_id, d.title AS drill_title, b.position,
            COALESCE(
              json_agg(
                json_build_object('label', dmd.label, 'value', v.value)
                ORDER BY dmd.sort_order
              ) FILTER (WHERE v.id IS NOT NULL),
              '[]'
            ) AS values
       FROM session_drill_block b
       JOIN drill d ON d.id = b.drill_id
       LEFT JOIN session_drill_value v ON v.block_id = b.id
       LEFT JOIN drill_metric_def dmd ON dmd.id = v.metric_def_id
      WHERE b.practice_session_id = ANY($1::uuid[])
      GROUP BY b.id, d.title, b.position
      ORDER BY b.practice_session_id, b.position`,
    [ids],
  );
  const blocksBySession = new Map<string, PracticeStatsBlockRow[]>();
  for (const br of blockRows) {
    const list = blocksBySession.get(br.practice_session_id) ?? [];
    list.push({
      drillTitle: br.drill_title,
      position: br.position,
      // numeric comes back from pg as a string.
      values: (br.values ?? []).map((v) => ({ label: v.label, value: Number(v.value) })),
    });
    blocksBySession.set(br.practice_session_id, list);
  }

  // Club tags, in bag order (sort_order), so the chip row reads like the bag.
  const { rows: clubRows } = await pool.query<{ practice_session_id: string; club: string }>(
    `SELECT sc.practice_session_id, sc.club
       FROM session_club sc
       LEFT JOIN club c ON c.name = sc.club
      WHERE sc.practice_session_id = ANY($1::uuid[])
      ORDER BY sc.practice_session_id, c.sort_order NULLS LAST, sc.club`,
    [ids],
  );
  const clubsBySession = new Map<string, string[]>();
  for (const cr of clubRows) {
    const list = clubsBySession.get(cr.practice_session_id) ?? [];
    list.push(cr.club);
    clubsBySession.set(cr.practice_session_id, list);
  }

  // The whole metric-def table: value_type / unit / better are what shape a
  // drill card, including one seeded after this code shipped.
  const { rows: defRows } = await pool.query<{
    drill_title: string;
    label: string;
    value_type: string;
    unit: string | null;
    better: "lower" | "higher" | null;
    sort_order: number | null;
  }>(
    `SELECT d.title AS drill_title, dmd.label, dmd.value_type, dmd.unit, dmd.better, dmd.sort_order
       FROM drill_metric_def dmd
       JOIN drill d ON d.id = dmd.drill_id
      ORDER BY d.title, dmd.sort_order NULLS LAST, dmd.label`,
  );

  return {
    sessions: sessionRows.map((r) => ({
      id: r.id,
      date: r.date,
      type: r.type,
      durationMin: r.duration_min,
      lieTypes: r.lie_types ?? [],
      shotTypes: r.shot_types ?? [],
      clubs: clubsBySession.get(r.id) ?? [],
      blocks: blocksBySession.get(r.id) ?? [],
    })),
    metricDefs: defRows.map((d) => ({
      drillTitle: d.drill_title,
      label: d.label,
      valueType: d.value_type,
      unit: d.unit,
      better: d.better,
      sortOrder: d.sort_order,
    })),
  };
}
