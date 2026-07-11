import { NextResponse } from "next/server";
import { listPuttingDrills, syncRounds } from "@gai/api";

// pg needs the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/practice/drills — active putting drills for the block picker (§4d),
 * each with its ordered metric definitions. General (the system block) first,
 * then defined drills by sort_order.
 */
export async function GET() {
  try {
    await syncRounds();
    const drills = await listPuttingDrills();
    return NextResponse.json({ drills });
  } catch (err) {
    console.error("[/api/practice/drills GET] error:", err);
    return NextResponse.json({ error: "could not load drills" }, { status: 500 });
  }
}
