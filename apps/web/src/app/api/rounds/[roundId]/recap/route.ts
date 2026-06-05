import { NextResponse, type NextRequest } from "next/server";
import {
  runRoundRecapStream,
  isAnthropicConfigured,
  runMigrations,
  RoundError,
} from "@gai/api";

// pg + the Anthropic SDK need the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rounds/[roundId]/recap — the optional, load-on-demand caddie recap.
 * Body: { persona }. Computes the round's stats + weaknesses in code, assembles the
 * Layer-5 swap prompt, calls Anthropic server-side, and streams SSE `delta` events
 * of the persona-voiced recap, then `done`.
 *
 * Invariant #3: the key never reaches this file or the client — it lives only in
 * the server-side Anthropic accessor. We only ask isAnthropicConfigured() whether a
 * key is present, returning a generic 500 if not (never a 401, which would leak that
 * a key exists). Invariant #1: every number narrated is computed server-side.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roundId: string }> },
) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  const { roundId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { persona } = (body ?? {}) as Record<string, unknown>;
  if (typeof persona !== "string") {
    return NextResponse.json({ error: "persona (string) is required" }, { status: 400 });
  }

  try {
    await runMigrations();
    const stream = await runRoundRecapStream(roundId, { persona });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (err) {
    if (err instanceof RoundError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/rounds/[roundId]/recap POST] unexpected error:", err);
    return NextResponse.json({ error: "recap generation failed" }, { status: 500 });
  }
}
