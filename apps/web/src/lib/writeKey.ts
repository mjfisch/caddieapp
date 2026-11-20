// Write-endpoint lock (golf lane report §9 item A, approved Nov 12, 2026).
// One secret, CAPT69_WRITE_KEY (server env only, never NEXT_PUBLIC_). Writes are
// allowed with either the `x-capt69-key` header (skills/scripts) or the unlock
// cookie set once per device at /unlock (browser). GETs stay public (decision 9).
export const UNLOCK_COOKIE = "capt69_unlock";
export const UNLOCK_MAX_AGE = 60 * 60 * 24 * 365; // one year per device

export async function unlockToken(key: string): Promise<string> {
  const data = new TextEncoder().encode(`capt69-unlock-v1:${key}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
