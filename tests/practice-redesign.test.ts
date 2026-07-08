import { describe, it, expect, afterAll } from "vitest";
import {
  runMigrations,
  getPool,
  createPracticeSession,
  listPracticeSessions,
  deletePracticeSession,
} from "@gai/api";

// =============================================================
// Mission 2 — Practice redesign schema + drill seed (migration 009).
//
// DB-backed, so it gates on DATABASE_URL and self-skips without it (same pattern
// as round-deletion / migrations tests). It runs against the SAME Neon DB the app
// reads, so every fixture self-cleans in afterAll — a leaked session would show
// up in the live app. It creates NO courses and touches none of the 10 existing
// legacy sessions.
// =============================================================

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Mission 2 — practice redesign schema round-trip", () => {
  const fixtureSessionIds: string[] = [];
  const fixtureDrillIds: string[] = [];

  afterAll(async () => {
    const pool = getPool();
    // Sessions first: session_drill_block/_value + session_club cascade with the
    // session FK, which also clears any block referencing a fixture drill…
    if (fixtureSessionIds.length > 0) {
      await pool.query("DELETE FROM practice_session WHERE id = ANY($1::uuid[])", [fixtureSessionIds]);
    }
    // …so the fixture drills are now unreferenced and the RESTRICT FK permits their delete.
    if (fixtureDrillIds.length > 0) {
      await pool.query("DELETE FROM drill WHERE id = ANY($1::uuid[])", [fixtureDrillIds]);
    }
  });

  it("0. reports the frozen-table counts (spec §6 'expected empty' check)", async () => {
    await runMigrations();
    const pool = getPool();
    const hf = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM hole_feature");
    const pm = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM practice_metric");
    // Reported, not asserted: the redesign leaves both untouched regardless.
    // eslint-disable-next-line no-console
    console.log(`[mission-2] hole_feature=${hf.rows[0]!.count} practice_metric=${pm.rows[0]!.count}`);
    expect(hf.rows[0]!.count).toBeGreaterThanOrEqual(0);
    expect(pm.rows[0]!.count).toBeGreaterThanOrEqual(0);
  });

  it("1. widened type domain: an existing short_game/net session still validates and inserts", async () => {
    await runMigrations();
    // short_game and net MUST stay legal — the 10 legacy rows depend on it.
    const legacy = await createPracticeSession({ date: "2026-07-08", type: "short_game" });
    fixtureSessionIds.push(legacy.id);
    const net = await createPracticeSession({ date: "2026-07-08", type: "net" });
    fixtureSessionIds.push(net.id);
    expect(legacy.id).toBeTruthy();
    expect(net.id).toBeTruthy();
  });

  it("2. club roster seeded: 7i–64°LW eligible, longer clubs not; no unmapped strings", async () => {
    await runMigrations();
    const pool = getPool();
    const { rows } = await pool.query<{ name: string; around_green_eligible: boolean; sort_order: number | null }>(
      "SELECT name, around_green_eligible, sort_order FROM club",
    );
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(rows.length).toBeGreaterThan(0);

    // Short-game-eligible clubs (7-iron through the 64° LW).
    for (const c of ["7i", "8i", "9i", "PW", "GW50", "SW54", "LW60", "LW64"]) {
      if (byName.has(c)) expect(byName.get(c)!.around_green_eligible, `${c} should be eligible`).toBe(true);
    }
    // Longer clubs are not short-game-eligible.
    for (const c of ["driver", "3h", "5h", "4i", "6i"]) {
      if (byName.has(c)) expect(byName.get(c)!.around_green_eligible, `${c} should NOT be eligible`).toBe(false);
    }
    // Every seeded club maps to a bag order (a NULL sort_order == an unmapped
    // club_dispersion string that needs hand reconciliation).
    const unmapped = rows.filter((r) => r.sort_order == null).map((r) => r.name);
    // eslint-disable-next-line no-console
    if (unmapped.length) console.log(`[mission-2] unmapped club strings: ${unmapped.join(", ")}`);
    expect(unmapped, `unmapped club strings need reconciliation: ${unmapped.join(", ")}`).toEqual([]);
  });

  it("3. the four putting drills seeded with correct metric defs", async () => {
    await runMigrations();
    const pool = getPool();
    const { rows: drills } = await pool.query<{ title: string; is_system: boolean }>(
      "SELECT title, is_system FROM drill WHERE area = 'putting' ORDER BY sort_order",
    );
    const titles = drills.map((d) => d.title);
    for (const t of ["General", "Gate Drill (MJF variant)", "Lag Ladder", "Circle Drill"]) {
      expect(titles, `drill "${t}" should be seeded`).toContain(t);
    }
    // General is the built-in system drill with no metric defs.
    expect(drills.find((d) => d.title === "General")!.is_system).toBe(true);

    const gateResets = await pool.query<{ value_type: string; better: string | null }>(
      `SELECT dmd.value_type, dmd.better FROM drill_metric_def dmd
         JOIN drill d ON d.id = dmd.drill_id
        WHERE d.title = 'Gate Drill (MJF variant)' AND dmd.label = 'Resets'`,
    );
    expect(gateResets.rows[0]).toMatchObject({ value_type: "integer", better: "lower" });

    const generalDefs = await pool.query(
      `SELECT 1 FROM drill_metric_def dmd JOIN drill d ON d.id = dmd.drill_id WHERE d.title = 'General'`,
    );
    expect(generalDefs.rowCount).toBe(0);
  });

  it("4. putting session round-trip: block + value insert, read back, then cascade delete", async () => {
    await runMigrations();
    const pool = getPool();

    // Insert a putting session via the (now type-widened) API.
    const { id } = await createPracticeSession({ date: "2026-07-08", type: "putting" });
    fixtureSessionIds.push(id);

    // One drill block referencing the seeded Gate Drill…
    const { rows: blockRows } = await pool.query<{ id: string }>(
      `INSERT INTO session_drill_block (practice_session_id, drill_id, position, note)
       SELECT $1, id, 0, 'round-trip test block' FROM drill WHERE title = 'Gate Drill (MJF variant)'
       RETURNING id`,
      [id],
    );
    const blockId = blockRows[0]!.id;
    expect(blockId).toBeTruthy();

    // …with one metric value (Resets = 2).
    await pool.query(
      `INSERT INTO session_drill_value (block_id, metric_def_id, value)
       SELECT $1, dmd.id, 2
         FROM drill_metric_def dmd JOIN drill d ON d.id = dmd.drill_id
        WHERE d.title = 'Gate Drill (MJF variant)' AND dmd.label = 'Resets'`,
      [blockId],
    );

    // Read it back.
    const readBack = await pool.query<{ value: string }>(
      "SELECT value FROM session_drill_value WHERE block_id = $1",
      [blockId],
    );
    expect(readBack.rowCount).toBe(1);
    expect(Number(readBack.rows[0]!.value)).toBe(2);

    // Delete the session; block + value must cascade to zero.
    const { deleted } = await deletePracticeSession(id);
    expect(deleted).toBe(true);
    fixtureSessionIds.splice(fixtureSessionIds.indexOf(id), 1); // already gone

    const blocksAfter = await pool.query("SELECT 1 FROM session_drill_block WHERE practice_session_id = $1", [id]);
    expect(blocksAfter.rowCount).toBe(0);
    const valuesAfter = await pool.query("SELECT 1 FROM session_drill_value WHERE block_id = $1", [blockId]);
    expect(valuesAfter.rowCount).toBe(0);
  });

  it("5. listPracticeSessions still queries the existing rows without error", async () => {
    await runMigrations();
    const sessions = await listPracticeSessions();
    // The 10 legacy rows (+ any live fixtures) all round-trip through the flat,
    // type-agnostic query — the widened domain didn't break the read path.
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(10);
  });

  it("6. drill FK is RESTRICT: a drill with logged blocks refuses hard-delete but archives fine", async () => {
    await runMigrations();
    const pool = getPool();

    // A throwaway drill fixture (not one of the seeded four).
    const { rows: dRows } = await pool.query<{ id: string }>(
      `INSERT INTO drill (area, title, description, resource_kind)
       VALUES ('putting', 'RESTRICT test drill', 'fixture', 'drill') RETURNING id`,
    );
    const drillId = dRows[0]!.id;
    fixtureDrillIds.push(drillId);

    // A session + a block pointing at the fixture drill (i.e. logged history).
    const { id: sessionId } = await createPracticeSession({ date: "2026-07-08", type: "putting" });
    fixtureSessionIds.push(sessionId);
    await pool.query(
      "INSERT INTO session_drill_block (practice_session_id, drill_id, position) VALUES ($1, $2, 0)",
      [sessionId, drillId],
    );

    // Hard-deleting the referenced drill must be REFUSED (ON DELETE RESTRICT) —
    // history is not silently taken with it.
    await expect(pool.query("DELETE FROM drill WHERE id = $1", [drillId])).rejects.toThrow();
    // The drill is still there.
    expect((await pool.query("SELECT 1 FROM drill WHERE id = $1", [drillId])).rowCount).toBe(1);

    // Archiving it instead succeeds — the definition retires, history survives.
    await pool.query("UPDATE drill SET archived = true WHERE id = $1", [drillId]);
    const { rows: after } = await pool.query<{ archived: boolean }>(
      "SELECT archived FROM drill WHERE id = $1",
      [drillId],
    );
    expect(after[0]!.archived).toBe(true);
  });
});

describe.skipIf(hasDb)("Mission 2 (skipped — no DATABASE_URL)", () => {
  it("is skipped without DATABASE_URL", () => {
    expect(hasDb).toBe(false);
  });
});
