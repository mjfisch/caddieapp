import { NextResponse, type NextRequest } from "next/server";
import { createRound, listRounds, runMigrations, RoundError } from "@gai/api";

// pg needs the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rounds?courseId=… — all rounds for a course, newest first, each with
 * its total strokes + score vs par (for the play index's "Past rounds" list).
 */
export async function GET(req: NextRequest) {
  const courseId = req.nextUrl.searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "courseId query param is required" }, { status: 400 });
  }
  try {
    await runMigrations();
    const rounds = await listRounds(courseId);
    return NextResponse.json({ rounds });
  } catch (err) {
    if (err instanceof RoundError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/rounds GET] error:", err);
    return NextResponse.json({ error: "could not load rounds" }, { status: 500 });
  }
}

/**
 * POST /api/rounds — create a new round. Body: { courseId, playedDate,
 * differential, differentialSource, externalKey, teeSet?, teeBoxId?,
 * reflection? } — the last three schema fields landed with migration 012
 * (Mission S3) and are validated in createRound. Returns { roundId }.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const {
    courseId,
    playedDate,
    teeSet,
    teeBoxId,
    differential,
    differentialSource,
    externalKey,
    reflection,
  } = (body ?? {}) as Record<string, unknown>;

  try {
    await runMigrations();
    const { roundId } = await createRound({
      courseId: courseId as string,
      playedDate: playedDate as string,
      teeSet: typeof teeSet === "string" ? teeSet : null,
      teeBoxId: typeof teeBoxId === "string" ? teeBoxId : null,
      differential: differential as number,
      differentialSource: differentialSource as Parameters<
        typeof createRound
      >[0]["differentialSource"],
      externalKey: externalKey as string,
      reflection: typeof reflection === "string" ? reflection : null,
    });
    return NextResponse.json({ roundId }, { status: 201 });
  } catch (err) {
    if (err instanceof RoundError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/rounds POST] error:", err);
    return NextResponse.json({ error: "could not create round" }, { status: 500 });
  }
}
