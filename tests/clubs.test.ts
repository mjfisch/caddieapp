import { describe, it, expect } from "vitest";
import { normalizeClub, isCanonicalClub, CANONICAL_CLUBS } from "@gai/shared";

// Pure unit tests — no DB. The whole point of the canonical vocabulary is that
// the importer's spellings and the seed's keys collapse to the same id so a
// club ratchets seeded -> measured under club_dispersion's UNIQUE(club).
describe("normalizeClub", () => {
  it("collapses the iron spellings to one canonical id", () => {
    for (const raw of ["7 Iron", "7i", "7-iron", "7I", " 7  iron ", "7iron"]) {
      expect(normalizeClub(raw)).toBe("7i");
    }
  });

  it("normalizes wedges by name and by loft", () => {
    expect(normalizeClub("Pitching Wedge")).toBe("PW");
    expect(normalizeClub("PW")).toBe("PW");
    expect(normalizeClub("Gap Wedge")).toBe("GW50");
    expect(normalizeClub("50°")).toBe("GW50");
    expect(normalizeClub("Sand Wedge")).toBe("SW54");
    expect(normalizeClub("54 degrees")).toBe("SW54");
    expect(normalizeClub("Lob Wedge")).toBe("LW60");
    expect(normalizeClub("60")).toBe("LW60");
    expect(normalizeClub("64°")).toBe("LW64");
    expect(normalizeClub("LW64")).toBe("LW64");
  });

  it("normalizes hybrids and woods", () => {
    expect(normalizeClub("3 Hybrid")).toBe("3h");
    expect(normalizeClub("3h")).toBe("3h");
    expect(normalizeClub("5 Rescue")).toBe("5h");
    expect(normalizeClub("3 Wood")).toBe("3w");
    expect(normalizeClub("5w")).toBe("5w");
  });

  it("normalizes the driver", () => {
    for (const raw of ["Driver", "driver", "D", "1W", "1 Wood"]) {
      expect(normalizeClub(raw)).toBe("driver");
    }
  });

  it("leaves the seed's own keys unchanged (idempotent on canonical ids)", () => {
    for (const club of CANONICAL_CLUBS) {
      expect(normalizeClub(club)).toBe(club);
    }
  });

  it("returns a stable, non-canonical token for unknown input rather than throwing", () => {
    const out = normalizeClub("Knife");
    expect(out).toBe("knife");
    expect(isCanonicalClub(out)).toBe(false);
  });
});
