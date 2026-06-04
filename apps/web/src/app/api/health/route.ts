import { NextResponse } from "next/server";
import { checkHealth, runMigrations } from "@gai/api";

export const runtime = "nodejs"; // pg requires the Node runtime, not edge
export const dynamic = "force-dynamic"; // never cache the round-trip

export async function GET() {
  try {
    // Apply pending migrations on startup (memoized — runs once per process).
    await runMigrations();
    const result = await checkHealth();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
