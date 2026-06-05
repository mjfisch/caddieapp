import { NextResponse, type NextRequest } from "next/server";
import {
  createPracticeSession,
  listPracticeSessions,
  runMigrations,
  PracticeError,
  type CreatePracticeSessionInput,
} from "@gai/api";

// pg needs the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/practice/sessions — all sessions, newest first, with focus tags. */
export async function GET() {
  try {
    await runMigrations();
    const sessions = await listPracticeSessions();
    return NextResponse.json({ sessions });
  } catch (err) {
    console.error("[/api/practice/sessions GET] error:", err);
    return NextResponse.json({ error: "could not load sessions" }, { status: 500 });
  }
}

/**
 * POST /api/practice/sessions — create a session + its focus tags + metrics in a
 * transaction. Body: CreatePracticeSessionInput. Returns { id }.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    await runMigrations();
    const { id } = await createPracticeSession(body as CreatePracticeSessionInput);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    if (err instanceof PracticeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/practice/sessions POST] error:", err);
    return NextResponse.json({ error: "could not create session" }, { status: 500 });
  }
}
