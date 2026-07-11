import { NextResponse } from "next/server";
import { listActiveClubs, syncRounds } from "@gai/api";

// pg needs the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/practice/clubs — active (non-archived) bag clubs, in bag order, for
 * the Trackman/Grass Range "Clubs used" chip row (§4a/§4b/§5a).
 */
export async function GET() {
  try {
    await syncRounds();
    const clubs = await listActiveClubs();
    return NextResponse.json({ clubs });
  } catch (err) {
    console.error("[/api/practice/clubs GET] error:", err);
    return NextResponse.json({ error: "could not load clubs" }, { status: 500 });
  }
}
