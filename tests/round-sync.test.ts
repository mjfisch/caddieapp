import { describe, it, expect, afterAll } from "vitest";
import {
  runMigrations,
  getPool,
  syncRounds,
  applyRoundSync,
  validateRoundPayload,
  RoundPayloadError,
} from "@gai/api";
import { ROUND_FILES } from "../services/api/src/rounds.generated";

// =============================================================
// Mission S4 — D22 round sync: §3 validator + manifest-fed runtime sync.
//
// Two tiers, same file (the stats-schema.test.ts pattern):
//   - The validator is pure (no I/O), so every §3 rule (a)–(g) is proven
//     WITHOUT credentials on every run, against corrupted copies of the real
//     checked-in June 22 payload.
//   - Sync tests gate on DATABASE_URL (throwaway Postgres or Neon). Self-skip
//     is NOT passing — a run without credentials proves nothing about the DB.
// =============================================================

const hasDb = Boolean(process.env.DATABASE_URL);

const SMOKE_FILENAME = "2026-06-22_fox-bend.json";
const SMOKE_KEY = "2026-06-22_fox-bend";
const smokeEntry = ROUND_FILES.find((r) => r.filename === SMOKE_FILENAME);

/** A deep, independent copy of the real manifested payload to corrupt per rule. */
function corruptibleCopy(): any {
  return JSON.parse(smokeEntry!.json);
}

// ── Tier 1: the §3 validator, no credentials needed ─────────────────────────

describe("§3 validator — the real June 22 payload is clean", () => {
  it("the checked-in smoke round passes every rule", () => {
    const payload = validateRoundPayload(SMOKE_FILENAME, corruptibleCopy());
    expect(payload.external_key).toBe(SMOKE_KEY);
    expect(payload.holes).toHaveLength(18);
    expect(payload.score.gross).toBe(81);
    expect(payload.score.differential).toBe(8.7);
    expect(payload.score.differential_source).toBe("cdga_posted");
    expect(payload.tee_box).toEqual({ name: "White", rating: 71.2, slope: 128, yardage: 6525 });
  });
});

describe("§3 validator — each rule fails loudly, naming the file and the rule", () => {
  it("(a) 17 holes throws", () => {
    const p = corruptibleCopy();
    p.holes.pop();
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /2026-06-22_fox-bend\.json violates §3 rule \(a\).*17/,
    );
  });

  it("(a) duplicate hole number throws", () => {
    const p = corruptibleCopy();
    p.holes[1].hole = 1; // two hole-1 entries, still 18 rows
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(a\).*hole number 1 appears more than once/,
    );
  });

  it("(b) sum(strokes) !== score.gross throws", () => {
    const p = corruptibleCopy();
    p.score.gross = 82;
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(b\).*sum\(strokes\) = 81 but score\.gross = 82/,
    );
  });

  it("(c) putts > strokes throws", () => {
    const p = corruptibleCopy();
    p.holes[6].putts = p.holes[6].strokes + 1; // hole 7: 4 putts on a 3
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(c\).*hole 7: putts \(4\) > strokes \(3\)/,
    );
  });

  it("(d) par 3 with a non-null fairway_result throws (the rule the DB can't hold)", () => {
    const p = corruptibleCopy();
    p.holes[2].fairway_result = "hit"; // hole 3 is a par 3
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(d\).*hole 3 is a par 3 but fairway_result is "hit"/,
    );
  });

  it("(d) non-par-3 with a null fairway_result throws (IFF cuts both ways)", () => {
    const p = corruptibleCopy();
    p.holes[0].fairway_result = null; // hole 1 is a par 5
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(d\).*hole 1 is a par 5 but fairway_result is null/,
    );
  });

  it("(d) a value outside the shared FAIRWAY_RESULTS list throws", () => {
    const p = corruptibleCopy();
    p.holes[0].fairway_result = "left"; // v1-style value, not in the S3 list
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(d\).*"left" is not null or one of: hit, miss_left, miss_right/,
    );
  });

  it("(e) missing differential throws", () => {
    const p = corruptibleCopy();
    delete p.score.differential;
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(e\).*differential is missing/,
    );
  });

  it("(e) differential_source outside the shared DIFFERENTIAL_SOURCES list throws", () => {
    const p = corruptibleCopy();
    p.score.differential_source = "guessed";
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(e\).*"guessed" is not one of: cdga_posted, computed_adjusted/,
    );
  });

  it("(f) external_key !== date + '_' + course.slug throws", () => {
    const p = corruptibleCopy();
    p.external_key = "2026-06-23_fox-bend"; // date says 06-22
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(f\).*"2026-06-23_fox-bend" !== date \+ '_' \+ course\.slug/,
    );
  });

  it("(f) filename !== external_key + '.json' throws", () => {
    expect(() => validateRoundPayload("2026-06-22_foxbend.json", corruptibleCopy())).toThrow(
      /round payload 2026-06-22_foxbend\.json violates §3 rule \(f\).*filename/,
    );
  });

  it("(g) missing tee_box throws (required: tee_box_id must resolve)", () => {
    const p = corruptibleCopy();
    delete p.tee_box;
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(g\).*tee_box is missing/,
    );
  });

  it("(g) tee_box without rating throws", () => {
    const p = corruptibleCopy();
    delete p.tee_box.rating;
    expect(() => validateRoundPayload(SMOKE_FILENAME, p)).toThrow(
      /rule \(g\).*tee_box\.rating/,
    );
  });

  it("throws RoundPayloadError carrying the filename and rule letter", () => {
    const p = corruptibleCopy();
    p.score.gross = 100;
    try {
      validateRoundPayload(SMOKE_FILENAME, p);
      expect.unreachable("validator should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RoundPayloadError);
      expect((err as RoundPayloadError).filename).toBe(SMOKE_FILENAME);
      expect((err as RoundPayloadError).rule).toBe("b");
    }
  });
});

// ── Tier 2: the sync against a real database ─────────────────────────────────

describe.skipIf(!hasDb)("D22 round sync against the live schema", () => {
  const fixtureCourseIds: string[] = [];

  afterAll(async () => {
    const pool = getPool();
    if (fixtureCourseIds.length > 0) {
      // Rounds first: round.tee_box_id is ON DELETE RESTRICT.
      await pool.query("DELETE FROM round WHERE course_id = ANY($1::uuid[])", [fixtureCourseIds]);
      await pool.query("DELETE FROM course WHERE id = ANY($1::uuid[])", [fixtureCourseIds]);
    }
    // The rollback test's course must not survive — assert-then-clean.
    await pool.query("DELETE FROM course WHERE name LIKE 'StatsS4 %'");
  });

  it("1. clean import: 1 round + 18 holes, tee_box upserted, every value from the payload", async () => {
    await syncRounds(); // the real entry point: migrations first, then the sync
    const pool = getPool();

    const { rows: roundRows } = await pool.query(
      `SELECT r.id, r.differential::float8 AS differential, r.differential_source,
              r.reflection, r.is_test, to_char(r.played_date, 'YYYY-MM-DD') AS played_date,
              c.slug AS course_slug, t.name AS tee_name, t.rating::float8 AS rating,
              t.slope, t.yardage
         FROM round r
         JOIN course c ON c.id = r.course_id
         JOIN tee_box t ON t.id = r.tee_box_id
        WHERE r.external_key = $1`,
      [SMOKE_KEY],
    );
    expect(roundRows).toHaveLength(1);
    const round = roundRows[0]!;
    expect(round.course_slug).toBe("fox-bend");
    expect(round.played_date).toBe("2026-06-22");
    expect(round.differential).toBe(8.7);
    expect(round.differential_source).toBe("cdga_posted");
    expect(round.is_test).toBe(false);
    expect(round.reflection).toMatch(/faded on the back 9/);
    expect({ name: round.tee_name, rating: round.rating, slope: round.slope, yardage: round.yardage })
      .toEqual({ name: "White", rating: 71.2, slope: 128, yardage: 6525 });

    // Exactly one White tee box on Fox Bend — upserted, not duplicated.
    const { rows: tees } = await pool.query(
      `SELECT count(*)::int AS n FROM tee_box t
         JOIN course c ON c.id = t.course_id
        WHERE c.slug = 'fox-bend' AND t.name = 'White'`,
    );
    expect(tees[0]!.n).toBe(1);

    // 18 holes, hole-by-hole identical to the payload; deprecated fairway_hit untouched.
    const payload = validateRoundPayload(SMOKE_FILENAME, JSON.parse(smokeEntry!.json));
    const { rows: holes } = await pool.query(
      `SELECT hole_number, strokes, putts, fairway_result, gir, fairway_hit
         FROM round_hole WHERE round_id = $1 ORDER BY hole_number`,
      [round.id],
    );
    expect(holes).toHaveLength(18);
    expect(
      holes.map((h) => ({
        hole: h.hole_number,
        strokes: h.strokes,
        putts: h.putts,
        fairway_result: h.fairway_result,
        gir: h.gir,
      })),
    ).toEqual(
      payload.holes.map((h) => ({
        hole: h.hole,
        strokes: h.strokes,
        putts: h.putts,
        fairway_result: h.fairway_result,
        gir: h.gir,
      })),
    );
    expect(holes.every((h) => h.fairway_hit === null), "deprecated fairway_hit is never written").toBe(true);

    // The derived totals the design doc quotes for this round.
    const totals = holes.reduce(
      (acc, h) => ({
        strokes: acc.strokes + h.strokes,
        putts: acc.putts + h.putts,
        gir: acc.gir + (h.gir ? 1 : 0),
      }),
      { strokes: 0, putts: 0, gir: 0 },
    );
    expect(totals).toEqual({ strokes: 81, putts: 32, gir: 10 });
    const split = { hit: 0, miss_left: 0, miss_right: 0, none: 0 };
    for (const h of holes) {
      if (h.fairway_result === null) split.none++;
      else split[h.fairway_result as "hit" | "miss_left" | "miss_right"]++;
    }
    expect(split).toEqual({ hit: 3, miss_left: 6, miss_right: 5, none: 4 });
  });

  it("2. re-run is a silent no-op: still exactly 1 round, no duplicate, no update", async () => {
    await syncRounds();
    const pool = getPool();
    const before = await pool.query(
      "SELECT id, created_at, differential, reflection FROM round WHERE external_key = $1",
      [SMOKE_KEY],
    );
    expect(before.rows).toHaveLength(1);

    // Run the (unmemoized) sync pass again — the ledger check must skip it.
    await applyRoundSync();

    const after = await pool.query(
      "SELECT id, created_at, differential, reflection FROM round WHERE external_key = $1",
      [SMOKE_KEY],
    );
    expect(after.rows).toEqual(before.rows); // same row: no duplicate, no update-in-place
    const { rows: holeCount } = await pool.query(
      "SELECT count(*)::int AS n FROM round_hole WHERE round_id = $1",
      [before.rows[0]!.id],
    );
    expect(holeCount[0]!.n).toBe(18);
  });

  it("3. coexistence: hand-seeded is_test rounds are untouched — the sync only acts on manifested files", async () => {
    await syncRounds();
    const pool = getPool();

    // Stand in for the two pre-existing Jun 5 / Jun 13 test rounds: hand-seeded
    // rows that were never in data/rounds/.
    const { rows: courseRows } = await pool.query<{ id: string }>(
      "INSERT INTO course (name, slug) VALUES ('StatsS4 Coexist CC', 'stats-s4-coexist') RETURNING id",
    );
    const courseId = courseRows[0]!.id;
    fixtureCourseIds.push(courseId);
    for (const [date, key] of [
      ["2026-06-05", "stats-s4-coexist-a"],
      ["2026-06-13", "stats-s4-coexist-b"],
    ] as const) {
      await pool.query(
        `INSERT INTO round (course_id, played_date, differential, differential_source, external_key, is_test)
         VALUES ($1, $2, 0, 'computed_adjusted', $3, true)`,
        [courseId, date, key],
      );
    }

    const snapshot = await pool.query(
      "SELECT * FROM round WHERE course_id = $1 ORDER BY external_key",
      [courseId],
    );
    const { rows: totalBefore } = await pool.query("SELECT count(*)::int AS n FROM round");

    await applyRoundSync();

    const rerun = await pool.query(
      "SELECT * FROM round WHERE course_id = $1 ORDER BY external_key",
      [courseId],
    );
    const { rows: totalAfter } = await pool.query("SELECT count(*)::int AS n FROM round");
    expect(rerun.rows).toEqual(snapshot.rows); // byte-identical: never touched
    expect(totalAfter[0]!.n).toBe(totalBefore[0]!.n); // and nothing else changed
  });

  it("4. partial failure rolls back the WHOLE round — never a half-imported round", async () => {
    await syncRounds();
    const pool = getPool();

    // Passes the §3 validator, then dies on hole 18 in the DB: strokes 2^31
    // overflows int4 AFTER the round row + 17 hole rows + the seeded course
    // are already written inside the transaction.
    const HUGE = 2_147_483_648;
    const p = JSON.parse(smokeEntry!.json);
    p.external_key = "2026-06-23_stats-s4-rollback";
    p.date = "2026-06-23";
    p.course = { name: "StatsS4 Rollback CC", slug: "stats-s4-rollback" };
    p.holes[17].strokes = HUGE;
    p.holes[17].putts = 2;
    p.score.gross = p.holes.reduce((s: number, h: any) => s + h.strokes, 0);

    await expect(
      applyRoundSync({
        rounds: [{ filename: "2026-06-23_stats-s4-rollback.json", json: JSON.stringify(p) }],
      }),
    ).rejects.toThrow(/round sync 2026-06-23_stats-s4-rollback\.json failed/);

    // Nothing survived: no round, no holes, and even the seeded course rolled back.
    const { rows: rounds } = await pool.query(
      "SELECT count(*)::int AS n FROM round WHERE external_key = $1",
      ["2026-06-23_stats-s4-rollback"],
    );
    expect(rounds[0]!.n).toBe(0);
    const { rows: courses } = await pool.query(
      "SELECT count(*)::int AS n FROM course WHERE slug = 'stats-s4-rollback'",
    );
    expect(courses[0]!.n).toBe(0);
  });

  it("5. a malformed payload in the batch imports NOTHING — validation runs before any insert", async () => {
    await syncRounds();
    const pool = getPool();

    const valid = JSON.parse(smokeEntry!.json);
    valid.external_key = "2026-06-24_stats-s4-heldback";
    valid.date = "2026-06-24";
    valid.course = { name: "StatsS4 Heldback CC", slug: "stats-s4-heldback" };

    const broken = JSON.parse(smokeEntry!.json);
    broken.external_key = "2026-06-25_stats-s4-broken";
    broken.date = "2026-06-25";
    broken.course = { name: "StatsS4 Broken CC", slug: "stats-s4-broken" };
    broken.score.gross = 999; // rule (b)

    await expect(
      applyRoundSync({
        rounds: [
          { filename: "2026-06-24_stats-s4-heldback.json", json: JSON.stringify(valid) },
          { filename: "2026-06-25_stats-s4-broken.json", json: JSON.stringify(broken) },
        ],
      }),
    ).rejects.toThrow(/2026-06-25_stats-s4-broken\.json violates §3 rule \(b\)/);

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM round WHERE external_key LIKE '%stats-s4-%'",
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("6. an empty manifest throws — loud failure, never a silent no-op", async () => {
    await expect(applyRoundSync({ rounds: [] })).rejects.toThrow(/rounds manifest is EMPTY/);
  });
});

describe.skipIf(hasDb)("D22 round sync tests (skipped — no DATABASE_URL)", () => {
  it("is skipped without DATABASE_URL — self-skip is NOT passing", () => {
    expect(hasDb).toBe(false);
  });
});
