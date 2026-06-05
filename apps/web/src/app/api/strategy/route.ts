import { NextResponse, type NextRequest } from "next/server";
import { runStrategyStream, isAnthropicConfigured, StrategyError } from "@gai/api";

// pg + the Anthropic SDK need the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/strategy — the caddie's read for one hole.
 *
 * Body: { courseId, holeNumber, persona, conditions: { windMph?, windDir?,
 *         pinPosition?, lie?, notes? } }
 *
 * Streams an SSE response: an `engine` event (the engine's club / carry / danger /
 * confidence — invariant #1, computed in @gai/sg-engine), then `delta` events
 * carrying the streamed caddie prose, then `done`. The assembled prompt and the
 * engine's reasoning[] never leave the server (invariant #5 leak guard).
 */
export async function POST(req: NextRequest) {
  // Invariant #3 pre-flight: a missing key is a server misconfiguration. Return a
  // generic 500 — never a 401, which would leak whether a key exists at all.
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { courseId, holeNumber, persona, conditions } = (body ?? {}) as Record<string, unknown>;
  if (typeof courseId !== "string" || typeof holeNumber !== "number" || typeof persona !== "string") {
    return NextResponse.json(
      { error: "courseId (string), holeNumber (number) and persona (string) are required" },
      { status: 400 },
    );
  }

  try {
    const stream = await runStrategyStream({
      courseId,
      holeNumber,
      persona,
      conditions: (conditions ?? {}) as never,
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (err) {
    if (err instanceof StrategyError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // Don't surface internal errors (which could echo the prompt) to the client.
    console.error("[/api/strategy] unexpected error:", err);
    return NextResponse.json({ error: "strategy generation failed" }, { status: 500 });
  }
}
