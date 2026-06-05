import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// INVARIANT #3: the Anthropic key is server-side only. It is read here, inside a
// server-only module, from process.env — never via a NEXT_PUBLIC_ var, never shipped
// to the client. The caddie's thinking runs in Vercel functions that import this.
//
// INVARIANT #1 reminder for whoever wires the first real call: the model NARRATES
// numbers produced by @gai/sg-engine. It never computes SG/dispersion/EV itself.

let client: Anthropic | undefined;

/**
 * The single Anthropic client accessor (the `getAnthropicClient()` the Phase 3B
 * brief asks for — kept under its established name so index.ts and the invariant
 * test don't churn). Reads ANTHROPIC_API_KEY from process.env on first use and
 * throws a clear error if it is missing. Never reads a NEXT_PUBLIC_ variant.
 */
export function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set (server-side only — see .env.example).");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Presence check for the API route's pre-flight. Reports only whether the key is
 * configured — never the value — so the route can return a generic 500 instead of
 * a 401 that would leak whether a key exists (invariant #3).
 */
export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
