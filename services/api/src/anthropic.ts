import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// INVARIANT #3: the Anthropic key is server-side only. It is read here, inside a
// server-only module, from process.env — never via a NEXT_PUBLIC_ var, never shipped
// to the client. The caddie's thinking runs in Vercel functions that import this.
//
// INVARIANT #1 reminder for whoever wires the first real call: the model NARRATES
// numbers produced by @gai/sg-engine. It never computes SG/dispersion/EV itself.

let client: Anthropic | undefined;

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
