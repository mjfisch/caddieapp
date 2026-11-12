import { NextResponse, type NextRequest } from "next/server";
import { UNLOCK_COOKIE, unlockToken, safeEqual } from "./lib/writeKey";

const READ = new Set(["GET", "HEAD", "OPTIONS"]);
const OPEN = new Set(["/api/unlock", "/api/health"]);

// Every non-read call to /api/* needs the write key (header) or the unlock cookie.
// Fails closed: if CAPT69_WRITE_KEY is not set, all writes are refused.
export async function middleware(req: NextRequest) {
  if (READ.has(req.method) || OPEN.has(req.nextUrl.pathname)) return NextResponse.next();
  const key = process.env.CAPT69_WRITE_KEY;
  if (!key) return NextResponse.json({ error: "writes are locked" }, { status: 503 });
  const header = req.headers.get("x-capt69-key");
  if (header && safeEqual(header, key)) return NextResponse.next();
  const cookie = req.cookies.get(UNLOCK_COOKIE)?.value;
  if (cookie && safeEqual(cookie, await unlockToken(key))) return NextResponse.next();
  return NextResponse.json({ error: "locked: unlock this device at /unlock" }, { status: 401 });
}

export const config = { matcher: ["/api/:path*"] };
