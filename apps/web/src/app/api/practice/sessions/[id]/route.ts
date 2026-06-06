import { NextResponse } from "next/server";
import { deletePracticeSession, runMigrations, PracticeError } from "@gai/api";

// pg needs the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/practice/sessions/[id] — delete a session and (cascade) its focus
 * tags + metrics. Idempotent: deleting a missing id returns 200 { deleted: false }.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await runMigrations();
    const { deleted } = await deletePracticeSession(id);
    return NextResponse.json({ deleted });
  } catch (err) {
    if (err instanceof PracticeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/practice/sessions/[id] DELETE] error:", err);
    return NextResponse.json({ error: "could not delete session" }, { status: 500 });
  }
}
