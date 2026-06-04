// Load apps/web/.env.local into process.env for tests that need a live DB
// (round-trip, migrations). Zero-dependency parser — Next.js owns this file at
// runtime; here we just mirror it so `vitest run` sees DATABASE_URL. Existing
// env vars win, so CI can still override. Missing file → no-op (tests skip).
import { readFileSync } from "node:fs";

const ENV_FILE = new URL("../apps/web/.env.local", import.meta.url);

try {
  const text = readFileSync(ENV_FILE, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && value && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // No .env.local — tests that require a DB will skip loudly.
}
