---
name: verify
description: Build/launch/drive recipe for verifying GAI Caddie changes at runtime (web app, practice tab flows).
---

# Verifying GAI Caddie changes

## Build & launch

- `npm install` at the repo root (npm workspaces) — a fresh container has no node_modules.
- Dev server: `npm run dev` (Next.js, port 3000). Wait for `curl -sf http://localhost:3000/practice`.
- No `.env.local` in remote sessions → no `DATABASE_URL`. Pages render fine (all client
  components fetch `/api/*` lazily), but real API calls will 500. Intercept them in the
  browser instead of hitting the server.

## Driving the UI

- Playwright: the repo doesn't depend on it. `npm i playwright-core` in the scratchpad and
  launch with `executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"`
  (the bare `/opt/pw-browsers/chromium` path is a directory, not the binary — check
  `find /opt/pw-browsers -maxdepth 3 -name chrome` if the version moved).
- Stub the practice APIs with `page.route`: `GET/POST **/api/practice/sessions`
  (`{"sessions":[]}` / `{}`) and `**/api/practice/confidence` (`{"clubs":[]}`).
  POST interception also captures the exact wire body — the strongest evidence for
  save-payload changes.
- Selector gotcha: "Driver" exists as BOTH a focus chip and a net clubs chip; scope chips
  via their field label, e.g. `.pr-field:has(> label:text-is("Clubs worked")) .pr-chips button`.

## Behavior-preserving refactors

For "no behavior change" claims, capture old vs new and diff: `git stash -u` → drive →
`git stash pop` → drive (dev server hot-reloads) → `diff` the captured POST bodies and
`.pr-form` outerHTML per session type. Byte-identical = proven parity.
