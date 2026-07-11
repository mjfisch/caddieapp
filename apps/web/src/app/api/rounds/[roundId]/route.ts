import { NextResponse, type NextRequest } from "next/server";
import { getRound, markRoundTest, runMigrations, RoundError } from "@gai/api";

// pg needs the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/rounds/[roundId] — the full round with all its hole rows joined. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roundId: string }> },
) {
  const { roundId } = await params;
  try {
    await runMigrations();
    const round = await getRound(roundId);
    if (!round) {
      return NextResponse.json({ error: "round not found" }, { status: 404 });
    }
    return NextResponse.json({ round });
  } catch (err) {
    console.error("[/api/rounds/[roundId] GET] error:", err);
    return NextResponse.json({ error: "could not load round" }, { status: 500 });
  }
}

/**
 * PATCH /api/rounds/[roundId] — flag/un-flag a round as a test round (D-5-1).
 * Body: { isTest: boolean }. Idempotent for a missing id.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ roundId: string }> },
) {
  const { roundId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { isTest } = (body ?? {}) as Record<string, unknown>;

  try {
    await runMigrations();
    const { updated } = await markRoundTest(roundId, isTest as boolean);
    return NextResponse.json({ updated });
  } catch (err) {
    if (err instanceof RoundError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/rounds/[roundId] PATCH] error:", err);
    return NextResponse.json({ error: "could not update round" }, { status: 500 });
  }
}
