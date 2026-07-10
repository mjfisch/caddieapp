import { describe, it, expect, afterAll } from "vitest";
import {
  runMigrations,
  getPool,
  createPracticeSession,
  listPracticeSessions,
  deletePracticeSession,
  listActiveClubs,
} from "@gai/api";

// =============================================================
// Mission 5 — Clubs Used + per-club shot shape on the range forms.
//
// DB-gated (same self-skip pattern as practice-redesign.test.ts): runs against
// the live Neon DB and self-cleans in afterAll. Exercises the session_club
// write path (createPracticeSession), the read path (listPracticeSessions'
// clubs rollup, in bag order), the GET /api/practice/clubs roster read
// (listActiveClubs), and the ON DELETE CASCADE from practice_session.
// =============================================================

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Mission 5 — Clubs Used round-trip", () => {
  const fixtureSessionIds: string[] = [];

  afterAll(async () => {
    const pool = getPool();
    if (fixtureSessionIds.length > 0) {
      await pool.query("DELETE FROM practice_session WHERE id = ANY($1::uuid[])", [fixtureSessionIds]);
    }
  });

  it("active clubs roster is non-empty and ordered by bag order (sort_order)", async () => {
    await runMigrations();
    const clubs = await listActiveClubs();
    expect(clubs.length).toBeGreaterThan(0);
    const orders = clubs.map((c) => c.sortOrder).filter((n): n is number => n != null);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("a trackman session with two tagged clubs (shape+note, and a bare club) round-trips and cascades on delete", async () => {
    await runMigrations();
    const pool = getPool();

    const { id } = await createPracticeSession({
      date: "2026-07-09",
      type: "trackman",
      location: "Oak Brook GC",
      duration_min: 45,
      overall_rating: 4,
      recap_md: "Mission 5 fixture session",
      clubs: [
        { club: "driver", shotShape: "fade", note: "Started it at the left bunker" },
        { club: "7i", shotShape: "draw", note: null },
        { club: "PW", shotShape: null, note: null },
      ],
    });
    fixtureSessionIds.push(id);

    // Read back directly (unordered — collation of `club` text isn't pinned, so
    // compare by building a map rather than relying on SQL row order).
    const { rows } = await pool.query<{
      club: string;
      shot_shape: string | null;
      note: string | null;
    }>("SELECT club, shot_shape, note FROM session_club WHERE practice_session_id = $1", [id]);
    const byClub = new Map(rows.map((r) => [r.club, r]));
    expect(byClub.get("driver")).toEqual({ club: "driver", shot_shape: "fade", note: "Started it at the left bunker" });
    expect(byClub.get("7i")).toEqual({ club: "7i", shot_shape: "draw", note: null });
    expect(byClub.get("PW")).toEqual({ club: "PW", shot_shape: null, note: null });

    // Read back through the app's own list query — clubs roll up in bag order.
    const sessions = await listPracticeSessions();
    const mine = sessions.find((s) => s.id === id)!;
    expect(mine.clubs.map((c) => c.club)).toEqual(["driver", "7i", "PW"]);
    expect(mine.clubs[0]).toEqual({ club: "driver", shotShape: "fade", note: "Started it at the left bunker" });
    expect(mine.clubs[1]).toEqual({ club: "7i", shotShape: "draw", note: null });
    expect(mine.clubs[2]).toEqual({ club: "PW", shotShape: null, note: null });

    // Delete cascades session_club to zero (ON DELETE CASCADE on practice_session_id).
    const { deleted } = await deletePracticeSession(id);
    expect(deleted).toBe(true);
    fixtureSessionIds.splice(fixtureSessionIds.indexOf(id), 1);

    const after = await pool.query("SELECT 1 FROM session_club WHERE practice_session_id = $1", [id]);
    expect(after.rowCount).toBe(0);
  });

  it("an invalid shot_shape is dropped rather than failing the whole session", async () => {
    await runMigrations();
    const pool = getPool();

    const { id } = await createPracticeSession({
      date: "2026-07-09",
      type: "grass_range",
      clubs: [{ club: "8i", shotShape: "not-a-real-shape", note: "still logs" }],
    });
    fixtureSessionIds.push(id);

    const { rows } = await pool.query<{ shot_shape: string | null; note: string | null }>(
      "SELECT shot_shape, note FROM session_club WHERE practice_session_id = $1",
      [id],
    );
    expect(rows).toEqual([{ shot_shape: null, note: "still logs" }]);

    const { deleted } = await deletePracticeSession(id);
    expect(deleted).toBe(true);
    fixtureSessionIds.splice(fixtureSessionIds.indexOf(id), 1);
  });

  it("a short_game session's clubs never surface in listPracticeSessions (Clubs Used is range-only)", async () => {
    await runMigrations();
    const { id } = await createPracticeSession({ date: "2026-07-09", type: "short_game" });
    fixtureSessionIds.push(id);
    const sessions = await listPracticeSessions();
    const mine = sessions.find((s) => s.id === id)!;
    expect(mine.clubs).toEqual([]);
  });
});

describe.skipIf(hasDb)("Mission 5 (skipped — no DATABASE_URL)", () => {
  it("is skipped without DATABASE_URL", () => {
    expect(hasDb).toBe(false);
  });
});
