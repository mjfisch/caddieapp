# GAI Caddie — root CLAUDE.md

AI-authored, web-based golf yardage book. Two modes: heavy **prep** authoring, light **on-course** read. Web + Vercel + Postgres. No native, no PostGIS, no live GPS, no polygon geometry (deliberately removed in the v2 pivot — don't add them back without a decision-log entry).

## The non-negotiable invariants (breaking one is a bug, not a judgment call)

1. **The math runs in code; the LLM only narrates it.** All SG / dispersion / EV lives in `packages/sg-engine` — deterministic, no I/O, no network. The model receives *numbers* and turns them into a decision + explanation. It never computes, never overrides the engine's club/target, never fabricates a yardage.
2. **Confidence flags propagate end to end.** Every club is `measured | partial | seeded`; the caddie's certainty must track it — decisive / hedged / named-as-placeholder. Semantic colors: green / amber / faint grey. The flag survives data → assembler → voice.
3. **The Anthropic key is server-side only.** It lives in Vercel functions (`services/api`), never the client. No `NEXT_PUBLIC_` prefix, ever.
4. **The LLM never invents a URL.** Drill/resource links come from a curated library or a real server-side `web_search` at generation time — never model-generated.
5. **The five layers compose in order; Layer 1 (accuracy) wins.** No persona voice or profile preference can invent a number, override the SG math, or recommend a clear loser. Tone changes *how* it says no, never *whether*.
6. **The personas are voice × risk-config, and they're locked.** Voice-only swap → identical target (a CI test). Risk-config swap → target moves in the expected direction. Don't redefine the four personas without a decision-log entry.

## Conventions

- **Markdown all the way down** for every context layer (rules, persona voice, profile, club data) — human-readable, diffable, hand-editable.
- **Monorepo** (npm workspaces): `apps/web`, `services/api`, `packages/{sg-engine,caddie-context,shared}`, `courses`, `docs`, `tests`.
- **Build discipline:** fresh session per mission; narrow task with explicit input/output files; no "review everything" prompts; checkpoint + commit often; build the test first when output is verifiable; keep every CLAUDE.md short and current.
- **Two design systems (D16):** GAI Caddie product UI = the dark as-built tokens (this app). BTP brand = the agency's light marketing identity (never app chrome; only a "Built by Back Tee Partners" attribution).

## What not to do

- Don't cross the math/LLM boundary (no arithmetic in the model).
- Don't ship the API key client-side, or design a flow that needs it there.
- Don't let the caddie's confidence outrun the data — preserve the flags.
- Don't reintroduce v1 complexity (native, PostGIS, live GPS, polygons) without a decision.
- Don't redefine locked personas/configs or the five-layer architecture without a decision-log entry.
- Don't drift into coaching Michael's actual game — that's the separate MJF Golf Project.
