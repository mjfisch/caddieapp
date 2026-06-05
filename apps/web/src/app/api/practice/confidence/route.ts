import { NextResponse, type NextRequest } from "next/server";
import {
  getClubConfidence,
  upsertClubConfidence,
  runMigrations,
  PracticeError,
} from "@gai/api";

// pg needs the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/practice/confidence — every bag club with BOTH axes: data confidence
 * (objective, from club_dispersion) and feel confidence (subjective, 1–4 or null).
 */
export async function GET() {
  try {
    await runMigrations();
    const clubs = await getClubConfidence();
    return NextResponse.json({ clubs });
  } catch (err) {
    console.error("[/api/practice/confidence GET] error:", err);
    return NextResponse.json({ error: "could not load confidence" }, { status: 500 });
  }
}

/**
 * POST /api/practice/confidence — upsert one club's feel-trust.
 * Body: { club: string, feel_level: 1|2|3|4, note?: string }.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { club, feel_level, note } = (body ?? {}) as Record<string, unknown>;

  try {
    await runMigrations();
    const updated = await upsertClubConfidence({
      club: club as string,
      feel_level: feel_level as number,
      note: typeof note === "string" ? note : null,
    });
    return NextResponse.json({ club: updated });
  } catch (err) {
    if (err instanceof PracticeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/practice/confidence POST] error:", err);
    return NextResponse.json({ error: "could not update confidence" }, { status: 500 });
  }
}
