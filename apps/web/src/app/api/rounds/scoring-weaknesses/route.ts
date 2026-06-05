import { NextResponse } from "next/server";
import { computeScoringWeaknesses, runMigrations } from "@gai/api";

// pg needs the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This STATIC segment is matched ahead of the sibling [roundId] dynamic segment,
// so GET /api/rounds/scoring-weaknesses lands here, not in [roundId]/route.ts.

/**
 * GET /api/rounds/scoring-weaknesses — the scoring weaknesses across all rounds,
 * as { area, value, benchmark }[]. Only metrics meaningfully outside their
 * benchmark are returned; this is the shape the practice ranker consumes.
 */
export async function GET() {
  try {
    await runMigrations();
    const weaknesses = await computeScoringWeaknesses();
    return NextResponse.json({ weaknesses });
  } catch (err) {
    console.error("[/api/rounds/scoring-weaknesses GET] error:", err);
    return NextResponse.json({ error: "could not compute weaknesses" }, { status: 500 });
  }
}
