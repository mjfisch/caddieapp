import { NextResponse, type NextRequest } from "next/server";
import {
  runPracticeCoachStream,
  isAnthropicConfigured,
  syncRounds,
  PracticeError,
} from "@gai/api";

// pg + the Anthropic SDK need the Node runtime, not edge. Never cache a read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/practice/coach — the AI coach. Body: { persona }.
 *
 * Runs the deterministic signal ranker (@gai/sg-engine), assembles the Layer-5
 * swap prompt (@gai/caddie-context), calls Anthropic server-side, and streams an
 * SSE response: a `signals` event, a `drills` event (the curated link table), then
 * `delta` events of the coach's prose, then `done`.
 *
 * Invariant #3: the key never reaches this file or the client — it lives only in
 * the server-side Anthropic accessor. We only ask isAnthropicConfigured() whether
 * a key is present, and return a generic 500 if not (never a 401, which would leak
 * that a key exists). Invariant #4: drill links come from the `drill` table only.
 */
export async function POST(req: NextRequest) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

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
    await syncRounds();
    const stream = await runPracticeCoachStream({ persona });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (err) {
    if (err instanceof PracticeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/practice/coach] unexpected error:", err);
    return NextResponse.json({ error: "coach generation failed" }, { status: 500 });
  }
}
