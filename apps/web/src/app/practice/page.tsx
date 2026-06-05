"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

// Practice tab (Phase 4.5) — the input side of the GAI Caddie loop. CLIENT code:
// it talks to the server only over fetch (/api/practice/*) and NEVER imports
// @gai/api or references the Anthropic key (invariant #3). The coach's drill
// links arrive from the server's `drills` SSE event — the model never invents one.

// ── Types (client-side mirrors of the API shapes) ──────────────────────────────
type Persona = { id: string; label: string; blurb: string };
type Signal = { priority: number; area: string; sourceSignal: string; description: string };
type Drill = {
  area: string;
  title: string;
  description: string;
  resource_url: string | null;
  resource_kind: string;
};
type Rec = { priority: number; area: string; signal: string; drill: string; why: string };
type ClubConf = {
  club: string;
  dataConfidence: "measured" | "partial" | "seeded" | null;
  feelLevel: number | null;
  note: string | null;
};
type Session = {
  id: string;
  date: string;
  type: string;
  location: string | null;
  duration_min: number | null;
  overall_rating: number | null;
  recap_md: string | null;
  focusAreas: string[];
};

const PERSONAS: Persona[] = [
  { id: "beta", label: "Beta", blurb: "conservative · play it safe" },
  { id: "rain_man", label: "Rain Man", blurb: "your caddie · flat & factual" },
  { id: "captain_69", label: "Captain 69", blurb: "aggressive · send it" },
  { id: "the_ringer", label: "The Ringer", blurb: "scramble specialist" },
];

const SESSION_TYPES = [
  { id: "trackman", label: "Trackman range", sub: "Map my bag · feeds dispersion", feeds: "data" },
  { id: "grass_range", label: "Grass range", sub: "Off turf · no LM data", feeds: "feel" },
  { id: "short_game", label: "Short game", sub: "Chip · putt · bunker", feeds: "feel" },
  { id: "net", label: "Spornia net", sub: "Home · swing thoughts", feeds: "feel" },
] as const;
type SessionTypeId = (typeof SESSION_TYPES)[number]["id"];

const FOCUS_OPTIONS: { label: string; area: string }[] = [
  { label: "Driver", area: "driver" },
  { label: "Lag putting", area: "lag_putting" },
  { label: "Chipping", area: "chipping" },
  { label: "Pitching", area: "pitching" },
  { label: "Bunker", area: "bunker" },
  { label: "4i path", area: "4i_path" },
  { label: "Short irons", area: "short_irons" },
];

const CONFIDENCE_COLOR: Record<string, string> = {
  measured: "var(--green)",
  partial: "var(--amber)",
  seeded: "var(--faint)",
};

const TYPE_LABEL: Record<string, string> = {
  trackman: "Trackman",
  grass_range: "Grass range",
  short_game: "Short game",
  net: "Spornia net",
};

// ── SSE frame parsing (mirrors StrategyPanel) ───────────────────────────────────
function parseFrame(raw: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

// Parse the coach's streamed [REC]…[/REC] blocks into structured cards. Tolerant
// of a still-streaming final block (fields fill in as they arrive).
function parseRecs(text: string): Rec[] {
  const blocks = text.split("[REC]").slice(1);
  const field = (body: string, key: string): string => {
    const m = new RegExp(`${key}:[ \\t]*(.*)`).exec(body);
    return m && m[1] ? m[1].trim() : "";
  };
  return blocks.map((b) => {
    const body = b.split("[/REC]")[0] ?? "";
    const whyMatch = /WHY:[ \t]*([\s\S]*)/.exec(body);
    const why = whyMatch && whyMatch[1] ? whyMatch[1].replace(/\[\/REC\][\s\S]*/, "").trim() : "";
    return {
      priority: Number(field(body, "PRIORITY")) || 0,
      area: field(body, "AREA"),
      signal: field(body, "SIGNAL"),
      drill: field(body, "DRILL"),
      why,
    };
  });
}

const priClass = (p: number) => (p <= 1 ? "p1" : p <= 2 ? "p2" : "p3");

export default function PracticePage() {
  // ── Coach state ──
  const [persona, setPersona] = useState("rain_man");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [coachText, setCoachText] = useState("");

  const drillByTitle = useMemo(() => {
    const m = new Map<string, Drill>();
    for (const d of drills) m.set(d.title.trim().toLowerCase(), d);
    return m;
  }, [drills]);
  const recs = useMemo(() => parseRecs(coachText), [coachText]);

  // ── Session-log state ──
  const [type, setType] = useState<SessionTypeId>("trackman");
  const [date, setDate] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [rating, setRating] = useState(0);
  const [recap, setRecap] = useState("");
  const [focus, setFocus] = useState<Set<string>>(new Set());
  // type-specific
  const [facility, setFacility] = useState("");
  const [surface, setSurface] = useState("");
  const [ball, setBall] = useState("");
  const [location, setLocation] = useState("");
  const [conditions, setConditions] = useState("");
  const [sgArea, setSgArea] = useState("putting_green");
  const [lagIn3ft, setLagIn3ft] = useState("");
  const [upDown, setUpDown] = useState("");
  const [clubsWorked, setClubsWorked] = useState<Set<string>>(new Set());
  const [reps, setReps] = useState("");
  const [swingThought, setSwingThought] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Confidence + history ──
  const [clubs, setClubs] = useState<ClubConf[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Default date to today on the client (avoids a hydration mismatch).
  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
  }, []);

  const loadConfidence = useCallback(async () => {
    try {
      const res = await fetch("/api/practice/confidence");
      if (!res.ok) return;
      const j = (await res.json()) as { clubs: ClubConf[] };
      setClubs(j.clubs ?? []);
    } catch {
      /* leave panel empty on failure */
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/practice/sessions");
      if (!res.ok) return;
      const j = (await res.json()) as { sessions: Session[] };
      setSessions(j.sessions ?? []);
    } catch {
      /* leave history empty on failure */
    }
  }, []);

  useEffect(() => {
    void loadConfidence();
    void loadSessions();
  }, [loadConfidence, loadSessions]);

  // ── Coach: POST + stream ──
  async function getPlan() {
    setCoachLoading(true);
    setCoachError(null);
    setSignals([]);
    setDrills([]);
    setCoachText("");
    try {
      const res = await fetch("/api/practice/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setCoachError(j?.error ?? "Could not get a practice plan.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = parseFrame(buf.slice(0, sep));
          buf = buf.slice(sep + 2);
          if (!frame) continue;
          if (frame.event === "signals") setSignals(frame.data as Signal[]);
          else if (frame.event === "drills") setDrills(frame.data as Drill[]);
          else if (frame.event === "delta") {
            acc += (frame.data as { text: string }).text;
            setCoachText(acc);
          } else if (frame.event === "error") {
            setCoachError((frame.data as { error: string }).error);
          }
        }
      }
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setCoachLoading(false);
    }
  }

  // ── Session log: submit ──
  function toggle(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function resetForm() {
    setDurationMin("");
    setRating(0);
    setRecap("");
    setFocus(new Set());
    setFacility("");
    setSurface("");
    setBall("");
    setLocation("");
    setConditions("");
    setSgArea("putting_green");
    setLagIn3ft("");
    setUpDown("");
    setClubsWorked(new Set());
    setReps("");
    setSwingThought("");
  }

  async function saveSession() {
    setSaving(true);
    setSaveOk(false);
    setSaveError(null);

    const focusAreas = new Set(focus);
    const metrics: { kind: string; value: number }[] = [];
    let recapText = recap.trim();
    let loc: string | null = null;
    let surf: string | null = null;
    let ballType: string | null = null;

    if (type === "trackman") {
      loc = facility.trim() || null;
      surf = surface.trim() || null;
      ballType = ball.trim() || null;
    } else if (type === "grass_range") {
      loc = location.trim() || null;
      surf = "grass";
      if (conditions.trim()) recapText = `Conditions: ${conditions.trim()}\n${recapText}`.trim();
    } else if (type === "short_game") {
      const tagByArea: Record<string, string> = {
        putting_green: "lag_putting",
        chipping: "chipping",
        pitching: "pitching",
        bunker: "bunker",
      };
      const tag = tagByArea[sgArea];
      if (tag) focusAreas.add(tag);
      if (lagIn3ft.trim() && Number.isFinite(Number(lagIn3ft)))
        metrics.push({ kind: "lag_in_3ft", value: Number(lagIn3ft) });
      if (upDown.trim() && Number.isFinite(Number(upDown)))
        metrics.push({ kind: "up_and_down", value: Number(upDown) });
    } else if (type === "net") {
      const worked = [...clubsWorked];
      if (reps.trim() && Number.isFinite(Number(reps)))
        metrics.push({ kind: "reps", value: Number(reps) });
      const parts: string[] = [];
      if (worked.length) parts.push(`Clubs: ${worked.join(", ")}.`);
      if (swingThought.trim()) parts.push(`Swing thought: ${swingThought.trim()}.`);
      recapText = [parts.join(" "), recapText].filter(Boolean).join("\n").trim();
    }

    const body = {
      date,
      type,
      location: loc,
      surface: surf,
      ball: ballType,
      duration_min: durationMin.trim() && Number.isFinite(Number(durationMin)) ? Number(durationMin) : null,
      overall_rating: rating > 0 ? rating : null,
      recap_md: recapText || null,
      focusAreas: [...focusAreas],
      metrics,
    };

    try {
      const res = await fetch("/api/practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setSaveError(j?.error ?? "Could not save the session.");
        return;
      }
      setSaveOk(true);
      resetForm();
      void loadSessions();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Confidence: tap a feel segment ──
  async function setFeel(club: string, level: number) {
    // optimistic
    setClubs((prev) => prev.map((c) => (c.club === club ? { ...c, feelLevel: level } : c)));
    try {
      await fetch("/api/practice/confidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ club, feel_level: level }),
      });
    } catch {
      void loadConfidence(); // reconcile on failure
    }
  }

  const activePersona = PERSONAS.find((p) => p.id === persona) ?? PERSONAS[1]!;

  return (
    <main className="pr-page">
      <Link href="/" className="mono pr-back">
        ← home
      </Link>

      <div className="pr-head">
        <h1>
          <span className="pr-sub">Practice</span>Range &amp; reps
        </h1>
        <div className="pr-cadence">
          this week
          <b>{sessions.length}</b>
          logged
        </div>
      </div>

      {/* A — the loop strip (desktop-only) */}
      <div className="pr-loop">
        <span><b>Recap</b> reveals weaknesses</span>
        <span className="pr-arr">→</span>
        <span className="pr-here"><b>Practice</b> refreshes numbers</span>
        <span className="pr-arr">→</span>
        <span>Next round, a sharper <b>book</b></span>
      </div>

      {/* B — AI coach */}
      <div className="pr-label">
        <span>What to work on <span className="pr-t">· AI</span></span>
      </div>
      <div className="pr-coach">
        <div className="pr-coach-who">
          <div className="pr-coach-av">
            {activePersona.label.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="pr-coach-nm">
            {activePersona.label}
            <small>{activePersona.blurb}</small>
          </div>
          {signals.length > 0 && <div className="pr-coach-tag">{signals.length} signals</div>}
        </div>

        <div className="pr-persona-row">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`pr-persona-btn${p.id === persona ? " on" : ""}`}
              onClick={() => setPersona(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button type="button" className="pr-coach-btn" onClick={getPlan} disabled={coachLoading}>
          {coachLoading ? "Reading your bag…" : "Get practice plan"}
        </button>

        {coachError && <p className="pr-err">{coachError}</p>}

        {recs.map((r, i) => {
          const d = drillByTitle.get(r.drill.trim().toLowerCase());
          const kind = d?.resource_kind ?? "drill";
          return (
            <div className="pr-rec" key={i}>
              <div className="pr-rec-row1">
                <span className={`pr-pri ${priClass(r.priority || i + 1)}`}>P{r.priority || i + 1}</span>
                <span className="pr-rec-area">{r.area || "—"}</span>
              </div>
              {r.why && <p className="pr-rec-why">{r.why}</p>}
              {r.drill && (
                <div className="pr-drill">
                  <div className="pr-drill-tx">
                    <b>{r.drill}</b>
                    {d?.resource_url ? (
                      <a href={d.resource_url} target="_blank" rel="noopener noreferrer">
                        Open resource →
                      </a>
                    ) : (
                      d && <span style={{ fontSize: 12, color: "var(--muted)" }}>{d.description}</span>
                    )}
                  </div>
                  <span className="pr-drill-kind">{kind}</span>
                </div>
              )}
              {r.signal && <span className="pr-rec-src">{r.signal}</span>}
            </div>
          );
        })}

        {/* Fallback: stream arrived but didn't parse into REC blocks. */}
        {recs.length === 0 && coachText && <div className="pr-coach-raw">{coachText}</div>}
      </div>

      {/* C — log a session */}
      <div className="pr-label">Log a session</div>
      <div className="pr-types">
        {SESSION_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`pr-type${t.id === type ? " on" : ""}`}
            onClick={() => {
              setType(t.id);
              setSaveOk(false);
            }}
          >
            <span className={`pr-type-feeds ${t.feeds}`}>{t.feeds === "data" ? "→ bag" : "feel"}</span>
            <b>{t.label}</b>
            <small>{t.sub}</small>
          </button>
        ))}
      </div>

      <div className="pr-form">
        {type === "trackman" && (
          <p className="pr-form-note">
            Structured shot data. Import your screenshots via the Shot Logger skill (see README) and the
            session updates per-club carry &amp; dispersion in your Bag.
          </p>
        )}
        {type === "grass_range" && (
          <p className="pr-form-note feel">
            Off real turf — no launch monitor, so this is feel only. It won&apos;t move your dispersion
            numbers, but it&apos;s gold for trust and contact.
          </p>
        )}
        {type === "short_game" && (
          <p className="pr-form-note">
            Chipping, pitching, putting, bunker. Log a light metric if you took one — otherwise just the
            feel.
          </p>
        )}
        {type === "net" && (
          <p className="pr-form-note feel">
            The net stops the ball — no distance or dispersion possible. Pure swing-thought &amp;
            maintenance work. Log the feel and the reps.
          </p>
        )}

        {/* Universal: date + duration */}
        <div className="pr-grid">
          <div className="pr-field">
            <label htmlFor="pr-date">Date</label>
            <input
              id="pr-date"
              className="pr-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="pr-field">
            <label htmlFor="pr-dur">Duration (min)</label>
            <input
              id="pr-dur"
              className="pr-input"
              type="number"
              inputMode="numeric"
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              placeholder="45"
            />
          </div>
        </div>

        {/* Type-specific */}
        {type === "trackman" && (
          <div className="pr-grid">
            <div className="pr-field">
              <label htmlFor="pr-fac">Facility</label>
              <input id="pr-fac" className="pr-input" value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="Oak Brook GC" />
            </div>
            <div className="pr-field">
              <label htmlFor="pr-surf">Surface</label>
              <input id="pr-surf" className="pr-input" value={surface} onChange={(e) => setSurface(e.target.value)} placeholder="Mat" />
            </div>
            <div className="pr-field full">
              <label htmlFor="pr-ball">Ball</label>
              <input id="pr-ball" className="pr-input" value={ball} onChange={(e) => setBall(e.target.value)} placeholder="Range" />
            </div>
          </div>
        )}
        {type === "grass_range" && (
          <div className="pr-grid">
            <div className="pr-field">
              <label htmlFor="pr-loc">Location</label>
              <input id="pr-loc" className="pr-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Range name" />
            </div>
            <div className="pr-field">
              <label>Surface</label>
              <input className="pr-input" value="Grass" disabled readOnly />
            </div>
            <div className="pr-field full">
              <label htmlFor="pr-cond">Wind / conditions</label>
              <input id="pr-cond" className="pr-input" value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Calm, into off the right" />
            </div>
          </div>
        )}
        {type === "short_game" && (
          <>
            <div className="pr-field full">
              <label htmlFor="pr-sga">Area</label>
              <select id="pr-sga" className="pr-select" value={sgArea} onChange={(e) => setSgArea(e.target.value)}>
                <option value="putting_green">Putting green</option>
                <option value="chipping">Chipping</option>
                <option value="pitching">Pitching</option>
                <option value="bunker">Bunker</option>
              </select>
            </div>
            <div className="pr-grid">
              <div className="pr-field">
                <label htmlFor="pr-lag">Lag: in 3 ft (%)</label>
                <input id="pr-lag" className="pr-input" type="number" inputMode="numeric" value={lagIn3ft} onChange={(e) => setLagIn3ft(e.target.value)} placeholder="70" />
              </div>
              <div className="pr-field">
                <label htmlFor="pr-ud">Up &amp; down (%)</label>
                <input id="pr-ud" className="pr-input" type="number" inputMode="numeric" value={upDown} onChange={(e) => setUpDown(e.target.value)} placeholder="50" />
              </div>
            </div>
          </>
        )}
        {type === "net" && (
          <>
            <div className="pr-field full">
              <label>Clubs worked</label>
              <div className="pr-chips">
                {["Driver", "7i", "8i", "PW", "Wedges"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`pr-chip${clubsWorked.has(c) ? " on" : ""}`}
                    onClick={() => setClubsWorked((s) => toggle(s, c))}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="pr-grid">
              <div className="pr-field">
                <label htmlFor="pr-reps">Reps</label>
                <input id="pr-reps" className="pr-input" type="number" inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} placeholder="40" />
              </div>
              <div className="pr-field">
                <label htmlFor="pr-st">Swing thought</label>
                <input id="pr-st" className="pr-input" value={swingThought} onChange={(e) => setSwingThought(e.target.value)} placeholder="Shallower takeaway" />
              </div>
            </div>
          </>
        )}

        {/* Trackman import bridge */}
        {type === "trackman" && (
          <div className="pr-import">
            <div className="pr-import-tx">
              <b>Import Trackman screenshots</b>
              <small>Runs the Shot Logger skill → updates Bag dispersion</small>
            </div>
          </div>
        )}

        {/* Universal: rating + focus + recap */}
        <div className="pr-field">
          <label>Overall rating</label>
          <div className="pr-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`pr-star${n <= rating ? " on" : ""}`}
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
                onClick={() => setRating(n === rating ? 0 : n)}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        <div className="pr-field">
          <label>Focus areas</label>
          <div className="pr-chips">
            {FOCUS_OPTIONS.map((f) => (
              <button
                key={f.area}
                type="button"
                className={`pr-chip${focus.has(f.area) ? " on" : ""}`}
                onClick={() => setFocus((s) => toggle(s, f.area))}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pr-field">
          <label htmlFor="pr-recap">Recap &amp; feels</label>
          <textarea
            id="pr-recap"
            className="pr-textarea"
            value={recap}
            onChange={(e) => setRecap(e.target.value)}
            placeholder="Feels, swing thoughts, confidence changes…"
          />
        </div>

        <button type="button" className="pr-save" onClick={saveSession} disabled={saving || !date}>
          {saving ? "Saving…" : "Save session"}
        </button>
        {saveOk && <p className="pr-ok">Session logged ✓</p>}
        {saveError && <p className="pr-err">{saveError}</p>}
      </div>

      {/* D — club confidence */}
      <div className="pr-label">
        <span>Club confidence</span>
        <span className="pr-t" style={{ fontFamily: "var(--font-mono), monospace", fontSize: 10 }}>
          DATA · FEEL
        </span>
      </div>
      <p className="pr-conf-help">
        Data confidence is objective (shot count). Feel confidence is yours to set.
      </p>
      <div className="pr-conf">
        {clubs.map((c) => {
          const feel = c.feelLevel ?? 0;
          const lvlClass = feel <= 1 ? "lo" : feel <= 2 ? "mid" : "";
          const flab = feel === 0 ? "—" : feel <= 1 ? "LOW" : feel <= 2 ? "MED" : "HIGH";
          const dc = c.dataConfidence;
          return (
            <div className="pr-conf-card" key={c.club}>
              {feel >= 1 && feel <= 2 && <span className="pr-lowdot" aria-label="low trust" />}
              <div className="pr-conf-top">
                <span className="pr-conf-club">{c.club}</span>
                {dc && (
                  <span className="pr-dc" style={{ color: CONFIDENCE_COLOR[dc] }}>
                    {dc}
                  </span>
                )}
              </div>
              <div className="pr-feel">
                {[1, 2, 3, 4].map((i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`set feel ${i}`}
                    className={`pr-bar${i <= feel ? ` fill ${lvlClass}` : ""}`}
                    onClick={() => setFeel(c.club, i)}
                  />
                ))}
                <span className="pr-flab">{flab}</span>
              </div>
            </div>
          );
        })}
        {clubs.length === 0 && <p className="pr-empty">Loading the bag…</p>}
      </div>

      {/* E — session history */}
      <div className="pr-label">Recent sessions</div>
      <div className="pr-hist">
        {sessions.length === 0 && <p className="pr-empty">No sessions logged yet.</p>}
        {sessions.map((s) => {
          const open = expanded === s.id;
          const recapFull = s.recap_md ?? "";
          const recapClip = recapFull.length > 100 ? `${recapFull.slice(0, 100)}…` : recapFull;
          return (
            <button
              key={s.id}
              type="button"
              className="pr-sess"
              onClick={() => setExpanded(open ? null : s.id)}
            >
              <div className="pr-sess-main">
                <div className="pr-sess-row1">
                  <b>{s.location || TYPE_LABEL[s.type] || s.type}</b>
                  <span className="pr-sess-typ">{TYPE_LABEL[s.type] ?? s.type}</span>
                  {s.duration_min != null && (
                    <span className="pr-sess-typ">{s.duration_min}m</span>
                  )}
                  {s.overall_rating != null && (
                    <span className="pr-sess-stars">{"★".repeat(s.overall_rating)}</span>
                  )}
                </div>
                {s.focusAreas.length > 0 && (
                  <div className="pr-sess-sub">{s.focusAreas.join(" · ")}</div>
                )}
                {recapFull && (
                  <div className={`pr-sess-sub${open ? "" : " clip"}`}>{open ? recapFull : recapClip}</div>
                )}
              </div>
              <div className="pr-sess-date">
                {formatDate(s.date)}
              </div>
            </button>
          );
        })}
      </div>

      <footer style={{ fontSize: 12, color: "var(--faint)", marginTop: 24 }}>
        Built by Back Tee Partners
      </footer>
    </main>
  );
}

// "2026-06-03" → { Jun / 3 } stacked. Parsed as plain parts (no Date tz shift).
function formatDate(iso: string): React.ReactNode {
  const parts = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Number(parts[1]) - 1;
  const day = parts[2] ?? "";
  return (
    <>
      {months[mi] ?? ""}
      <b>{day.replace(/^0/, "")}</b>
    </>
  );
}
