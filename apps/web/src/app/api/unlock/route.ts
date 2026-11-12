import { NextResponse, type NextRequest } from "next/server";
import { UNLOCK_COOKIE, UNLOCK_MAX_AGE, unlockToken, safeEqual } from "../../../lib/writeKey";

export const dynamic = "force-dynamic";

// POST /api/unlock { key } -> sets a one-year httpOnly cookie on this device.
// DELETE /api/unlock -> clears it (lock this device again).
export async function POST(req: NextRequest) {
  const key = process.env.CAPT69_WRITE_KEY;
  if (!key) return NextResponse.json({ error: "writes are locked" }, { status: 503 });
  let given = "";
  try {
    given = String(((await req.json()) as { key?: unknown })?.key ?? "");
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!given || !safeEqual(given, key)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return NextResponse.json({ error: "wrong key" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(UNLOCK_COOKIE, await unlockToken(key), {
    httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: UNLOCK_MAX_AGE,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(UNLOCK_COOKIE, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
