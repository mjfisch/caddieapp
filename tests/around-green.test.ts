import { describe, it, expect, afterAll } from "vitest";
import {
  runMigrations,
  getPool,
  createPracticeSession,
  listPracticeSessions,
  deletePracticeSession,
} from "@gai/api";

// =============================================================
// Mission 6 — Around the Green session type (§4c).
//
// DB-gated (same self-skip pattern as session-club.test.ts): runs against the
// live Neon DB and self-cleans in afterAll. Exercises the lie_types/shot_types
// write path, the note-only session_club rows (shot_shape stays NULL for
// around_green even if a raw caller sends one), the listPracticeSessions
// rollup (lieTypes/shotTypes + clubs in bag order), and the ON DELETE CASCADE
// from practice_session.
// =============================================================

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Mission 6 — Around the Green round-trip", () => {
  const fixtureSessionIds: string[] = [];

  afterAll(async () => {
    const pool = getPool();
    if (fixtureSessionIds.length > 0) {
      await pool.query("DELETE FROM practice_session WHERE id = ANY($1::uuid[])", [fixtureSessionIds]);
    }
  });

  it("the definition-of-done session (LW64 + SW54, tight lie, chipping + flops, per-club notes) round-trips and cascades on delete", async () => {
    await runMigrations();
    const pool = getPool();

    const { id } = await createPracticeSession({
      date: "2026-07-10",
      type: "around_green",
      duration_min: 40,
      overall_rating: 4,
      recap_md: "Mission 6 fixture session",
      lie_types: ["tight"],
      shot_types: ["chipping", "flops"],
      clubs: [
        { club: "LW64", note: "Opened the face on the flops" },
        { club: "SW54", note: "Bumped low chips" },
      ],
    });
    fixtureSessionIds.push(id);

    // Tag arrays land on the session row itself.
    const { rows: sessRows } = await pool.query<{
      lie_types: string[] | null;
      shot_types: string[] | null;
    }>("SELECT lie_types, shot_types FROM practice_session WHERE id = $1", [id]);
    expect(sessRows[0]).toEqual({ lie_types: ["tight"], shot_types: ["chipping", "flops"] });

    // session_club rows carry the notes and NO shot shape (§4c: full-swing concept).
    const { rows: clubRows } = await pool.query<{
      club: string;
      shot_shape: string | null;
      note: string | null;
    }>("SELECT club, shot_shape, note FROM session_club WHERE practice_session_id = $1", [id]);
    const byClub = new Map(clubRows.map((r) => [r.club, r]));
    expect(byClub.get("LW64")).toEqual({ club: "LW64", shot_shape: null, note: "Opened the face on the flops" });
    expect(byClub.get("SW54")).toEqual({ club: "SW54", shot_shape: null, note: "Bumped low chips" });

    // Read back through the app's own list query — tags round-trip, clubs roll up
    // in bag order (SW54 before LW64 regardless of tag order).
    const sessions = await listPracticeSessions();
    const mine = sessions.find((s) => s.id === id)!;
    expect(mine.lieTypes).toEqual(["tight"]);
    expect(mine.shotTypes).toEqual(["chipping", "flops"]);
    expect(mine.clubs.map((c) => c.club)).toEqual(["SW54", "LW64"]);
    expect(mine.clubs[0]).toEqual({ club: "SW54", shotShape: null, note: "Bumped low chips" });
    expect(mine.clubs[1]).toEqual({ club: "LW64", shotShape: null, note: "Opened the face on the flops" });

    // Delete cascades session_club to zero (ON DELETE CASCADE on practice_session_id).
    const { deleted } = await deletePracticeSession(id);
    expect(deleted).toBe(true);
    fixtureSessionIds.splice(fixtureSessionIds.indexOf(id), 1);

    const after = await pool.query("SELECT 1 FROM session_club WHERE practice_session_id = $1", [id]);
    expect(after.rowCount).toBe(0);
  });

  it("a sneaked-in shot shape is stored as NULL for around_green (server-side guard)", async () => {
    await runMigrations();
    const pool = getPool();

    const { id } = await createPracticeSession({
      date: "2026-07-10",
      type: "around_green",
      lie_types: [],
      shot_types: [],
      clubs: [{ club: "SW54", shotShape: "draw", note: "raw API caller" }],
    });
    fixtureSessionIds.push(id);

    const { rows } = await pool.query<{ shot_shape: string | null; note: string | null }>(
      "SELECT shot_shape, note FROM session_club WHERE practice_session_id = $1",
      [id],
    );
    expect(rows).toEqual([{ shot_shape: null, note: "raw API caller" }]);

    const { deleted } = await deletePracticeSession(id);
    expect(deleted).toBe(true);
    fixtureSessionIds.splice(fixtureSessionIds.indexOf(id), 1);
  });

  it("empty tag arrays are stored as empty arrays; absent tags stay NULL and read back as []", async () => {
    await runMigrations();
    const pool = getPool();

    const { id: emptyId } = await createPracticeSession({
      date: "2026-07-10",
      type: "around_green",
      lie_types: [],
      shot_types: [],
    });
    fixtureSessionIds.push(emptyId);

    // Raw SQL: Mission 7 retired short_game from the create API, but a legacy
    // row (pre-009, so no tag arrays) is exactly what this case is about.
    const { rows: legacyRows } = await pool.query<{ id: string }>(
      "INSERT INTO practice_session (date, type) VALUES ('2026-07-10', 'short_game') RETURNING id",
    );
    const legacyId = legacyRows[0]!.id;
    fixtureSessionIds.push(legacyId);

    const { rows } = await pool.query<{ id: string; lie_types: string[] | null; shot_types: string[] | null }>(
      "SELECT id, lie_types, shot_types FROM practice_session WHERE id = ANY($1::uuid[])",
      [[emptyId, legacyId]],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(emptyId)!.lie_types).toEqual([]);
    expect(byId.get(emptyId)!.shot_types).toEqual([]);
    expect(byId.get(legacyId)!.lie_types).toBeNull();
    expect(byId.get(legacyId)!.shot_types).toBeNull();

    // Both read back as [] through the app's list query — legacy rows unaffected.
    const sessions = await listPracticeSessions();
    for (const sid of [emptyId, legacyId]) {
      const mine = sessions.find((s) => s.id === sid)!;
      expect(mine.lieTypes).toEqual([]);
      expect(mine.shotTypes).toEqual([]);
    }
  });
});

describe.skipIf(hasDb)("Mission 6 (skipped — no DATABASE_URL)", () => {
  it("is skipped without DATABASE_URL", () => {
    expect(hasDb).toBe(false);
  });
});
