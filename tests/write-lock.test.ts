// Write-endpoint lock (CAPT69_WRITE_KEY). Pure unit tests: no DB, no network.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { middleware } from "../apps/web/src/middleware";
import { POST as unlockPost, DELETE as unlockDelete } from "../apps/web/src/app/api/unlock/route";
import { UNLOCK_COOKIE, unlockToken, safeEqual } from "../apps/web/src/lib/writeKey";

const KEY = "test-key-" + "x".repeat(40);
const URL_BASE = "https://capt69.test";
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

function req(method: string, path = "/api/practice/sessions", init: { headers?: Record<string, string> } = {}) {
  return new NextRequest(URL_BASE + path, { method, headers: init.headers });
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.CAPT69_WRITE_KEY;
  process.env.CAPT69_WRITE_KEY = KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env.CAPT69_WRITE_KEY;
  else process.env.CAPT69_WRITE_KEY = saved;
});

describe("write lock middleware", () => {
  it("lets reads through without a key", async () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(passes(await middleware(req(m)))).toBe(true);
  });

  it("rejects writes with no credentials (401)", async () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await middleware(req(m));
      expect(res.status).toBe(401);
    }
  });

  it("rejects a wrong header key and a wrong cookie", async () => {
    expect((await middleware(req("POST", undefined, { headers: { "x-capt69-key": "nope" } }))).status).toBe(401);
    expect((await middleware(req("POST", undefined, { headers: { cookie: `${UNLOCK_COOKIE}=deadbeef` } }))).status).toBe(401);
    // the raw key is NOT an acceptable cookie value (only its derived token is)
    expect((await middleware(req("POST", undefined, { headers: { cookie: `${UNLOCK_COOKIE}=${KEY}` } }))).status).toBe(401);
  });

  it("accepts the correct header key", async () => {
    expect(passes(await middleware(req("POST", undefined, { headers: { "x-capt69-key": KEY } })))).toBe(true);
  });

  it("accepts the correct unlock cookie", async () => {
    const token = await unlockToken(KEY);
    expect(passes(await middleware(req("DELETE", "/api/practice/sessions/abc", { headers: { cookie: `${UNLOCK_COOKIE}=${token}` } })))).toBe(true);
  });

  it("fails closed (503) when the key is not configured, even with a header", async () => {
    delete process.env.CAPT69_WRITE_KEY;
    expect((await middleware(req("POST"))).status).toBe(503);
    expect((await middleware(req("POST", undefined, { headers: { "x-capt69-key": "" } }))).status).toBe(503);
  });

  it("keeps /api/unlock and /api/health reachable so the device can be unlocked", async () => {
    expect(passes(await middleware(req("POST", "/api/unlock")))).toBe(true);
    expect(passes(await middleware(req("POST", "/api/health")))).toBe(true);
  });
});

describe("/api/unlock", () => {
  const post = (body: unknown) =>
    unlockPost(new NextRequest(URL_BASE + "/api/unlock", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("sets an httpOnly secure strict cookie for the right key, and middleware then accepts it", async () => {
    const res = await post({ key: KEY });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${UNLOCK_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("secure");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
    expect(setCookie).not.toContain(KEY); // the cookie never carries the raw key
    const value = setCookie.split(";")[0].split("=")[1];
    expect(passes(await middleware(req("POST", undefined, { headers: { cookie: `${UNLOCK_COOKIE}=${value}` } })))).toBe(true);
  });

  it("rejects a wrong key (401), bad JSON (400) and an unset server key (503)", async () => {
    expect((await post({ key: "wrong" })).status).toBe(401);
    expect((await post("not json")).status).toBe(400);
    delete process.env.CAPT69_WRITE_KEY;
    expect((await post({ key: KEY })).status).toBe(503);
  });

  it("DELETE clears the cookie", async () => {
    const res = await unlockDelete();
    expect(res.headers.get("set-cookie") ?? "").toMatch(/max-age=0/i);
  });
});

describe("safeEqual", () => {
  it("compares correctly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("the key never reaches client code", () => {
  it("is only referenced server-side and never with a NEXT_PUBLIC prefix", () => {
    const root = join(__dirname, "..", "apps", "web", "src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && files.push(p);
      }
    };
    walk(root);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/NEXT_PUBLIC_CAPT69/);
      if (/^\s*["']use client["']/m.test(src)) expect(src, f).not.toContain("CAPT69_WRITE_KEY");
    }
  });
});
