import { describe, it, expect, afterAll } from "vitest";
import {
  runMigrations,
  getPool,
  createRound,
  upsertRoundHole,
  getRound,
  deleteRound,
  markRoundTest,
  computeScoringWeaknesses,
  createPracticeSession,
  listPracticeSessions,
  deletePracticeSession,
} from "@gai/api";
import {
  reconcileDeletedRound,
  ROUND_ID_KEY,
  SCORES_KEY,
  PUTTS_KEY,
  type StorageLike,
} from "../apps/web/src/app/play/roundStorage";

// =============================================================
// Mission 2 — delete rounds & practice sessions + is_test (D-5-1).
//
// DB-backed tests gate on DATABASE_URL and run against the SAME Neon DB production
// reads (per repo memory), so every fixture self-cleans before+after — a leaked
// round/session/course would show up in the live app. The pure-helper test for the
// localStorage reconciliation runs everywhere (no DB).
// =============================================================

const hasDb = Boolean(process.env.DATABASE_URL);

// ── Pure helper: localStorage reconciliation (Step 3) — no DB, always runs ───────
describe("reconcileDeletedRound: purges only the active round's localStorage footprint", () => {
  /** A fake Web Storage backed by a plain object. */
  function fakeStore(seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
    const data = { ...seed };
    return {
      data,
      getItem: (k) => (k in data ? data[k]! : null),
      setItem: (k, v) => {
        data[k] = v;
      },
    };
  }

  it("clears the round-id pointer + this course's scores/putts when the deleted round IS active", () => {
    const store = fakeStore({
      [ROUND_ID_KEY]: JSON.stringify({ courseA: { date: "2026-06-06", roundId: "r1" } }),
      [SCORES_KEY]: JSON.stringify({ "courseA-1": 4, "courseA-2": 5, "courseB-1": 3 }),
      [PUTTS_KEY]: JSON.stringify({ "courseA-1": 2, "courseB-1": 1 }),
    });

    const cleared = reconcileDeletedRound(store, "courseA", "r1");
    expect(cleared).toBe(true);

    expect(JSON.parse(store.data[ROUND_ID_KEY]!)).toEqual({});
    // courseA holes gone; courseB (a different course) untouched.
    expect(JSON.parse(store.data[SCORES_KEY]!)).toEqual({ "courseB-1": 3 });
    expect(JSON.parse(store.data[PUTTS_KEY]!)).toEqual({ "courseB-1": 1 });
  });

  it("leaves localStorage intact when deleting a round that is NOT the active one", () => {
    const seed = {
      [ROUND_ID_KEY]: JSON.stringify({ courseA: { date: "2026-06-06", roundId: "active" } }),
      [SCORES_KEY]: JSON.stringify({ "courseA-1": 4 }),
      [PUTTS_KEY]: JSON.stringify({ "courseA-1": 2 }),
    };
    const store = fakeStore(seed);

    const cleared = reconcileDeletedRound(store, "courseA", "some-old-round");
    expect(cleared).toBe(false);

    // Nothing changed — the active round's local data survives.
    expect(JSON.parse(store.data[ROUND_ID_KEY]!)).toEqual({ courseA: { date: "2026-06-06", roundId: "active" } });
    expect(JSON.parse(store.data[SCORES_KEY]!)).toEqual({ "courseA-1": 4 });
  });
});

// ── DB-backed: server delete + cascade + is_test exclusion ───────────────────────
describe.skipIf(!hasDb)("Mission 2 — server delete, cascade, and is_test exclusion", () => {
  const fixtureCourseIds: string[] = [];
  const fixtureSessionIds: string[] = [];

  async function makeCourse(name: string): Promise<string> {
    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO course (name) VALUES ($1) RETURNING id",
      [name],
    );
    const id = rows[0]!.id;
    fixtureCourseIds.push(id);
    return id;
  }

  afterAll(async () => {
    const pool = getPool();
    if (fixtureCourseIds.length > 0) {
      // round (+ round_hole via cascade) goes with the course FK.
      await pool.query("DELETE FROM course WHERE id = ANY($1::uuid[])", [fixtureCourseIds]);
    }
    if (fixtureSessionIds.length > 0) {
      await pool.query("DELETE FROM practice_session WHERE id = ANY($1::uuid[])", [fixtureSessionIds]);
    }
    await pool.query("DELETE FROM course WHERE name LIKE 'Mission2 %'");
  });

  it("1. deleteRound removes the round AND its round_hole children (cascade); it no longer reads back", async () => {
    await runMigrations();
    const pool = getPool();
    const courseId = await makeCourse("Mission2 Delete Course");
    const { roundId } = await createRound({ courseId, playedDate: "2026-06-06" });
    for (let h = 1; h <= 3; h++) {
      await upsertRoundHole(roundId, { holeNumber: h, strokes: 4, putts: 2 });
    }

    // Child rows exist before the delete.
    const before = await pool.query("SELECT 1 FROM round_hole WHERE round_id = $1", [roundId]);
    expect(before.rowCount).toBe(3);

    const { deleted } = await deleteRound(roundId);
    expect(deleted).toBe(true);

    // Round gone…
    expect(await getRound(roundId)).toBeNull();
    // …and the children cascaded.
    const after = await pool.query("SELECT 1 FROM round_hole WHERE round_id = $1", [roundId]);
    expect(after.rowCount).toBe(0);
  });

  it("2. deleteRound is idempotent: a missing (or malformed) id is a no-op success", async () => {
    await runMigrations();
    // A well-formed uuid that doesn't exist.
    expect(await deleteRound("00000000-0000-0000-0000-000000000000")).toEqual({ deleted: false });
    // A malformed id never throws — treated as not-found.
    expect(await deleteRound("not-a-uuid")).toEqual({ deleted: false });
  });

  it("3. deletePracticeSession removes the session AND its focus + metric children (cascade)", async () => {
    await runMigrations();
    const pool = getPool();
    // grass_range here since Mission 7 retired short_game from creation; the
    // server still accepts focusAreas/metrics input for any type, and this test
    // only cares that the child rows cascade with the session.
    const { id } = await createPracticeSession({
      date: "2026-06-06",
      type: "grass_range",
      focusAreas: ["lag_putting", "chipping"],
      metrics: [{ kind: "lag_in_3ft", value: 70 }],
    });
    fixtureSessionIds.push(id);

    // Children exist before.
    expect((await pool.query("SELECT 1 FROM practice_focus WHERE practice_session_id = $1", [id])).rowCount).toBe(2);
    expect((await pool.query("SELECT 1 FROM practice_metric WHERE practice_session_id = $1", [id])).rowCount).toBe(1);

    const { deleted } = await deletePracticeSession(id);
    expect(deleted).toBe(true);

    // Session no longer listed, and children cascaded away.
    const sessions = await listPracticeSessions();
    expect(sessions.find((s) => s.id === id)).toBeUndefined();
    expect((await pool.query("SELECT 1 FROM practice_focus WHERE practice_session_id = $1", [id])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM practice_metric WHERE practice_session_id = $1", [id])).rowCount).toBe(0);
  });

  it("4. is_test excludes a round from the scoring-weakness query; un-marking includes it again (D-5-1)", async () => {
    await runMigrations();
    const courseId = await makeCourse("Mission2 IsTest Course");
    const { roundId } = await createRound({ courseId, playedDate: "2026-06-06" });
    // 18 holes, 4 three-putts → 4/18 = 22.2%, well past the 7.8% weakness threshold.
    for (let h = 1; h <= 18; h++) {
      await upsertRoundHole(roundId, { holeNumber: h, strokes: 4, putts: h <= 4 ? 3 : 2 });
    }

    const find = async () => {
      const ws = await computeScoringWeaknesses({}, { courseId });
      return ws.find((w) => w.area === "three_putt_pct");
    };

    // Un-marked: the weakness surfaces.
    expect((await find()), "three_putt_pct should surface for a normal round").toBeDefined();

    // Marked as test: excluded → no rounds left in scope → no weaknesses.
    await markRoundTest(roundId, true);
    expect(await find(), "a test round must be excluded from the weakness signal").toBeUndefined();

    // Un-marked again: back in the signal.
    await markRoundTest(roundId, false);
    expect(await find(), "un-marking restores the round to the signal").toBeDefined();
  });
});
