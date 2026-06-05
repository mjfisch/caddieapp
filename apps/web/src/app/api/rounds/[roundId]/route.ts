import { NextResponse } from "next/server";
import { getRound, runMigrations } from "@gai/api";

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
