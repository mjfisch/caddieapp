import { describe, it, expect } from "vitest";
import { computeHandicapIndex, type HandicapRound } from "@gai/sg-engine";
import { getHandicapIndex, getPool, syncRounds } from "@gai/api";

// =============================================================
// WHS Handicap Index (packages/sg-engine/src/handicap.ts) - pure, no DB.
// Pins the lowest-N-of-20 table at every edge, the rounding, the 54.0 cap,
// recency selection, and test-round exclusion.
//
// ASCII only on purpose (see the esbuild note in practice-stats-compute.test.ts).
// =============================================================

/** n rounds, newest first, one per day back from 2026-06-30, with the given differentials. */
function rounds(diffs: number[], extra: Partial<HandicapRound> = {}): HandicapRound[] {
  return diffs.map((differential, i) => {
    const d = new Date(Date.UTC(2026, 5, 30 - i));
    return { differential, playedDate: d.toISOString().slice(0, 10), ...extra };
  });
}

/** Differentials 10.0, 11.0, ... so the lowest k are 10..10+k-1. */
function ladder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 10 + i);
}

describe("WHS table edges", () => {
  it("0 rounds -> null", () => {
    expect(computeHandicapIndex([])).toEqual({ index: null, roundsInRecord: 0, differentialsUsed: 0 });
  });

  it("2 rounds -> null (below the WHS minimum, never a fake number)", () => {
    expect(computeHandicapIndex(rounds([8.7, 9.1])).index).toBeNull();
  });

  it("3 rounds -> lowest 1 minus 2.0", () => {
    expect(computeHandicapIndex(rounds([12.0, 8.7, 15.0]))).toEqual({
      index: 6.7,
      roundsInRecord: 3,
      differentialsUsed: 1,
    });
  });

  it("4 rounds -> lowest 1 minus 1.0", () => {
    expect(computeHandicapIndex(rounds(ladder(4))).index).toBe(9.0);
  });

  it("5 rounds -> lowest 1", () => {
    expect(computeHandicapIndex(rounds(ladder(5))).index).toBe(10.0);
  });

  it("6 rounds -> average of lowest 2 minus 1.0", () => {
    // (10 + 11) / 2 - 1 = 9.5
    expect(computeHandicapIndex(rounds(ladder(6))).index).toBe(9.5);
  });

  it("7 and 8 rounds -> average of lowest 2", () => {
    expect(computeHandicapIndex(rounds(ladder(7))).index).toBe(10.5);
    expect(computeHandicapIndex(rounds(ladder(8)))).toMatchObject({ index: 10.5, differentialsUsed: 2 });
  });

  it.each([
    [9, 3, 11.0],
    [11, 3, 11.0],
    [12, 4, 11.5],
    [14, 4, 11.5],
    [15, 5, 12.0],
    [16, 5, 12.0],
    [17, 6, 12.5],
    [18, 6, 12.5],
    [19, 7, 13.0],
    [20, 8, 13.5],
  ])("%i rounds -> lowest %i", (n, used, expected) => {
    expect(computeHandicapIndex(rounds(ladder(n)))).toEqual({
      index: expected,
      roundsInRecord: n,
      differentialsUsed: used,
    });
  });

  it("25 rounds -> only the 20 most recent count, lowest 8 of those", () => {
    // Newest 20 are 20.0..39.0; the 5 OLDEST are very low and must be ignored.
    const diffs = [...ladder(20).map((d) => d + 10), 1, 2, 3, 4, 5];
    const res = computeHandicapIndex(rounds(diffs));
    expect(res.roundsInRecord).toBe(20);
    expect(res.differentialsUsed).toBe(8);
    expect(res.index).toBe(23.5); // avg(20..27)
  });

  it("selects recency by playedDate, not input order", () => {
    const rs = rounds([...ladder(20).map((d) => d + 10), 1]);
    // Move the oldest (differential 1) to the front of the array: it is still oldest.
    const shuffled = [rs[20]!, ...rs.slice(0, 20)];
    expect(computeHandicapIndex(shuffled).index).toBe(23.5);
  });
});

describe("rounding, cap, plus handicaps", () => {
  it("rounds to the nearest 0.1, a .x5 average rounding up (no float drift)", () => {
    // 6 rounds: avg(8.6, 8.7) - 1 = 7.65 -> 7.7 (float math would give 7.6499...).
    expect(computeHandicapIndex(rounds([8.6, 8.7, 20, 20, 20, 20])).index).toBe(7.7);
    // 8 rounds: avg(8.6, 8.7) = 8.65 -> 8.7.
    expect(computeHandicapIndex(rounds([8.6, 8.7, 20, 20, 20, 20, 20, 20])).index).toBe(8.7);
    // 9 rounds: avg(10.0, 10.1, 10.1) = 10.0666 -> 10.1.
    expect(computeHandicapIndex(rounds([10.0, 10.1, 10.1, 30, 30, 30, 30, 30, 30])).index).toBe(10.1);
  });

  it("caps at 54.0", () => {
    expect(computeHandicapIndex(rounds([60, 61, 62, 63, 64])).index).toBe(54.0);
  });

  it("a below-scratch record yields a negative (plus) index", () => {
    expect(computeHandicapIndex(rounds([-1.0, 2.0, 3.0])).index).toBe(-3.0);
  });

  it("a scratch result is 0, not -0", () => {
    expect(Object.is(computeHandicapIndex(rounds([2.0, 5, 5])).index, 0)).toBe(true);
  });
});

describe("test-round exclusion", () => {
  it("test rounds never count, even when they are the lowest", () => {
    const real = rounds([12.0, 13.0, 14.0]);
    const test = rounds([0.5, 0.5], { isTest: true });
    expect(computeHandicapIndex([...test, ...real])).toEqual({
      index: 10.0,
      roundsInRecord: 3,
      differentialsUsed: 1,
    });
  });

  it("test rounds do not count toward the minimum", () => {
    const res = computeHandicapIndex([...rounds([9.0, 9.0]), ...rounds([1, 1, 1], { isTest: true })]);
    expect(res.index).toBeNull();
    expect(res.roundsInRecord).toBe(2);
  });
});

describe("known-good: the Fox Bend 2026-06-22 round (differential 8.7)", () => {
  it("as the lowest of three, 8.7 - 2.0 = 6.7", () => {
    const res = computeHandicapIndex([
      { differential: 8.7, playedDate: "2026-06-22" },
      { differential: 11.4, playedDate: "2026-06-10" },
      { differential: 13.2, playedDate: "2026-05-30" },
    ]);
    expect(res.index).toBe(6.7);
  });

  it("is deterministic: same input, same output", () => {
    const input = rounds([8.7, 11.4, 13.2, 9.9, 10.5, 12.0]);
    expect(computeHandicapIndex(input)).toEqual(computeHandicapIndex(input));
  });
});

// ---- DB-gated: the service path agrees with the pure function ---------------

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("getHandicapIndex against the live schema", () => {
  it("equals computeHandicapIndex over every non-test round's stored differential", async () => {
    await syncRounds();
    const fromService = await getHandicapIndex();
    // Every round, test flag included: the pure fn must do the exclusion itself.
    const { rows } = await getPool().query<{ played_date: string; differential: string; is_test: boolean }>(
      `SELECT to_char(played_date, 'YYYY-MM-DD') AS played_date, differential, is_test
         FROM round ORDER BY played_date DESC, created_at DESC`,
    );
    const all = rows.map((r) => ({
      playedDate: r.played_date,
      differential: Number(r.differential),
      isTest: r.is_test,
    }));
    expect(fromService).toEqual(computeHandicapIndex(all));
    // The manifested Fox Bend round (8.7) is present, so the record is not empty.
    expect(all.some((r) => r.playedDate === "2026-06-22" && r.differential === 8.7)).toBe(true);
    expect(fromService.roundsInRecord).toBeGreaterThan(0);
  });
});
