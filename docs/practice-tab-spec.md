# GAI Caddie — Practice Tab: Design & Integration Spec

*Companion to Build Plan v2.0. Proposes the sixth tab (Plan · Bag · Course · Play · Recap · **Practice**) and how it threads into the existing modules, data model, phases, and decision log. Paired with the interactive mockup `gai-caddie-practice-tab.html`.*

---

## 0. The one idea

Everything else in v2 *reads* from your data — the yardage book consumes dispersion, confidence flags, and scoring weaknesses; Play reads the authored plan; Recap records outcomes. **Practice is the only tab that writes back to that data.** It's the input side of the loop:

```
Recap (what happened on the course)
   → reveals weaknesses (3-putts, doubles, a club you stopped trusting)
   → Practice (work on them, refresh the numbers)
   → updates Bag dispersion + confidence
   → next prep produces a sharper book
```

So Practice isn't a logging bolt-on. It's the **maintenance bay for the engine's inputs.** Designing it this way means it reuses what you've already built rather than introducing a second AI system — see §4.

---

## 1. Session types (the taxonomy)

Four types, because they differ in *what data they can possibly produce*. That distinction drives the whole tab — a Trackman session can move your dispersion numbers; a net session physically cannot.

| Type | Produces | Feeds | Type-specific fields |
|---|---|---|---|
| **Trackman range** (Map My Bag) | Structured shot data | **Dispersion (measured)** via the Shot Logger | facility, surface, ball, clubs hit, screenshot import |
| **Grass range** | Feel only — no launch monitor | Feel-confidence only | location, surface=grass, wind/conditions, clubs worked, ball-flight notes |
| **Short game** (course practice area) | Optional light metrics + feel | Feel-confidence; optional putting/scrambling signal | area (putting green / chipping / pitching / bunker), optional metric (lag-in-3ft, up-and-downs), what worked |
| **Spornia net** (home) | **No distance or dispersion possible** (net stops the ball) | Feel-confidence + swing-thought log | club(s), reps, duration, swing thought being grooved |

**Universal fields (all types):** date, duration, overall rating, and the **recap** — free text for feels and swing thoughts, plus per-club confidence nudges. The recap is the point of the whole tab for you: it's where "shallower takeaway felt automatic today" or "lost trust in the 4i" gets captured while it's fresh, so the next session and the caddie both know it.

**The honesty rule, surfaced in the UI:** grass-range and net sessions are labeled *feel only* so you never expect them to update carry numbers. Only Trackman flows into dispersion. This mirrors the discipline already in the Shot Logger (surface/ball must match before carries are comparable).

---

## 2. The Trackman bridge

The Trackman session type is the seam between this tab and the **`mjf-trackman-shot-logger` skill** you just built. "Import screenshots" on that form runs the same parse → validate → append pipeline; on success it writes `shot` rows and recomputes per-club SD, which is exactly what flips a club from `seeded`/`partial` to `measured`. The Practice tab is the natural home for that action — logging the session and refreshing the bag are one motion, not two.

---

## 3. Two confidences, one view

A caddie cares about two different things that the word "confidence" usually blurs:

- **Data confidence** — `measured | partial | seeded`. Objective, from shot count and recency. Already in the `club` table.
- **Feel confidence** — how much *you* trust the club right now. Subjective, set by you after a session. New.

The club-confidence panel shows both side by side. This is genuinely useful to the strategy engine: a club can be `measured` (the numbers are solid) yet low feel-trust (you've been fighting it), and a good caddie plans around that. Which leads to the most interesting integration —

**Feel confidence can feed the caddie.** If you've flagged low trust in the 4i, the prep engine can bias the club call toward the 5h on a borderline hole, and the authored plan can acknowledge it ("you haven't trusted the 4i — this leaves the 5h, which fits the carry anyway"). It's a small risk-config nudge, not a math change, so it stays on the right side of the math-in-code invariant.

---

## 4. The AI coach — reuse, don't rebuild

The "what to work on" recommendations should **reuse the five-layer caddie assembler**, not be a separate AI. Same discipline as the rest of the app: the math/ranking runs in code, the LLM only narrates and selects.

**Deterministic layer (code) — compute and rank the signals:**
1. **Data gaps** — clubs still `seeded`/`partial` (driver today). Highest priority: these are what the engine is guessing on.
2. **Dispersion problems** — clubs with high lateral SD or a directional bias, straight from the shot log (your 3h/4i right-lean).
3. **Scoring weaknesses** — from the 28-round dataset / `round_hole`: 3-putt %, doubles/round, scrambling %, par-4 average.
4. **Feel flags** — clubs you marked low-trust.

This ranking is a pure function. It never touches the LLM.

**LLM layer (assembler) — narrate + select:** swap Layer 5. Where the yardage book puts *this hole's SG output* in Layer 5, the coach puts *the ranked practice signals*. Layers 1–4 are unchanged (core rules + persona voice + profile v1.1 + club data), so the coach **speaks in your selected caddie's voice** — Rain Man stays flat and factual, no hype, consistent with the rest of the app. The model phrases each recommendation, picks a drill, and writes the rationale tied to your actual numbers.

**Profile constraints are already in Layer 3 — let them do the work.** Your profile says range-first, embed putting rather than isolate it, 1–2x/week, feel-based, dislikes structured putting drills. Because the assembler already injects that, the coach will naturally recommend "10 lag putts before you pull an iron," not "a 45-minute putting block." You don't re-encode those rules here; you inherit them.

**Resource links — the no-hallucinated-URL rule.** This is the coach's version of "the LLM never does math": **the LLM never invents a URL.** Links come from either (a) a small curated `drill` library with vetted URLs, or (b) a real server-side `web_search` call at generation time, with the model choosing among returned results. Never a model-generated link. Display the source kind (article / video) so it's honest about what it's pointing to.

---

## 5. Data model additions (to v2 §4)

```
practice_session(id, user_id, date, type, location, surface, ball,
                 duration_min, overall_rating, recap_md,
                 linked_shot_session, created_at)        -- type: trackman|grass_range|short_game|net
practice_focus(id, practice_session_id, area)            -- tags: driver, lag_putting, 4i_path, chipping…
club_confidence(id, user_id, club_id, feel_level, note, updated_at)
                                                         -- feel_level 1–4; distinct from club.dispersion_confidence
practice_metric(id, practice_session_id, kind, value)    -- optional: lag_in_3ft, up_and_downs, make_pct…
drill(id, area, title, description, resource_url, resource_kind, level)
                                                         -- curated library; vetted URLs only
practice_recommendation(id, user_id, focus_area, drill_id, rationale,
                        source_signal, status, created_at)
                                                         -- source_signal = the data that triggered it
```

Notes:
- `linked_shot_session` joins a Trackman practice session to the `shot` rows it produced — the bridge in §2.
- `club_confidence` is the feel axis from §3; `club.dispersion_confidence` stays the data axis.
- `practice_recommendation.source_signal` keeps the coach auditable: every suggestion records which signal produced it (e.g. `driver.dispersion=partial`, `three_putt_pct=10.2`), so it's never a black box.

---

## 6. Where it plugs into v2

**Modules (§3):** add a ninth module, **Practice log + coach**, sitting beside the Scoring dashboard as an input/feedback surface. It *writes to* Dispersion (via the Shot Logger) and Club confidence; it *reads from* Scoring (`round_hole`), Dispersion, and the confidence flags; it *reuses* the Caddie assembler (Layer-5 swap) and the player profile.

**Phases (§7):** the logging + confidence tracking is light and shares the `round_hole`/stat-entry patterns, so it lands cleanly alongside **Phase 4** (on-course read + stat tracking). The AI coach depends on Phase 2 (dispersion) + Phase 3 (assembler) + scoring data, so treat it as **Phase 4.5**:

> **Phase 4.5 — Practice tab.** Session logging (4 types) + recap + dual-confidence panel; Trackman type wired to the Shot Logger; then the coach (deterministic signal ranking → assembler Layer-5 → curated/searched drill links). *Done when:* you can log each session type, the Trackman type updates the bag, and the coach produces profile-respecting, source-linked recommendations in your caddie's voice.

**Decision log (§10) — proposed additions:**

| # | Decision | Status | Notes |
|---|----------|--------|-------|
| D12 | Practice tab = the loop's input/feedback surface, not a standalone logger | Proposed | Writes dispersion + confidence; reads scoring |
| D13 | Two-confidence model: data (`measured/partial/seeded`) vs feel (1–4) | Proposed | Feel can nudge the strategy risk config |
| D14 | Practice coach reuses the 5-layer assembler via a Layer-5 swap | Proposed | Persona-voiced; no second AI system |
| D15 | Drill resource links from curated library or live search — never LLM-invented | Proposed | The coach's "LLM never does math" |

---

## 7. What's mocked vs. real in the prototype

The `gai-caddie-practice-tab.html` mockup is populated with your real signals (driver `partial`, 3-putt 10.2%, 3h/4i right-lean, the Oak Brook session) so the concept reads true. It demonstrates: the loop strip up top, the persona-voiced coach card with three ranked recommendations, the four session-type picker with a type-specific form (Trackman shown, with the import bridge), the dual-confidence panel (tap the bars to set feel), and session history. State is in-memory only — it's a design reference for the Phase 4.5 build, not production code.
