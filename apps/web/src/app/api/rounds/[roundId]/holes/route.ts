import { NextResponse, type NextRequest } from "next/server";
import { upsertRoundHole, runMigrations, RoundError } from "@gai/api";

// pg needs the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rounds/[roundId]/holes — upsert one hole's score on
 * (round_id, hole_number). Body: { holeNumber, strokes, putts?, fairwayHit?,
 * gir?, penaltyStrokes?, notes? }. A re-tap updates the existing row.
 */
export async function POST(
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

  const b = (body ?? {}) as Record<string, unknown>;

  try {
    await runMigrations();
    await upsertRoundHole(roundId, {
      holeNumber: b.holeNumber as number,
      strokes: b.strokes as number,
      putts: typeof b.putts === "number" ? b.putts : null,
      fairwayHit: typeof b.fairwayHit === "boolean" ? b.fairwayHit : null,
      gir: typeof b.gir === "boolean" ? b.gir : null,
      penaltyStrokes: typeof b.penaltyStrokes === "number" ? b.penaltyStrokes : null,
      notes: typeof b.notes === "string" ? b.notes : null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RoundError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/rounds/[roundId]/holes POST] error:", err);
    return NextResponse.json({ error: "could not save hole" }, { status: 500 });
  }
}
