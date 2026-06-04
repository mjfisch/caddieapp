import { describe, it, expect } from "vitest";
import { checkHealth } from "@gai/api";

// Phase 0 "done when": a "hello" round-trips through the backend.
// Requires DATABASE_URL (local Postgres in CI/dev, Neon in prod). If unset, skip
// loudly rather than silently — the gate is the live DB hop, not a mock.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("round-trip: client -> server -> Postgres -> back", () => {
  it("writes and reads back 'hello' with a db timestamp and sg-engine version", async () => {
    const result = await checkHealth();
    expect(result.message).toBe("hello");
    expect(result.source).toBe("database");
    expect(result.sgEngineVersion).toBe("0.0.0");
    // dbTime is a real ISO timestamp from Postgres
    expect(Number.isNaN(Date.parse(result.dbTime))).toBe(false);
  });
});

describe.skipIf(hasDb)("round-trip (skipped — no DATABASE_URL)", () => {
  it("is skipped without DATABASE_URL", () => {
    expect(hasDb).toBe(false);
  });
});
