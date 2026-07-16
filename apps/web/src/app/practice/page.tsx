"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FORM_FIELDS,
  buildSaveBody,
  initialFieldValues,
  scalarValue,
  SHOT_SHAPES,
  LIE_TYPES,
  SHOT_TYPES,
  type FieldDef,
  type FieldValues,
  type SessionTypeId,
  type PuttingDrill,
  type DrillBlockDraft,
  type ClubRosterEntry,
  type SessionClubDrafts,
} from "./formFields";

// Practice tab (Phase 4.5) — the input side of the Capt. 69 OS loop. CLIENT code:
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
type SessionBlock = {
  drillTitle: string;
  note: string | null;
  metrics: { label: string; unit: string | null; value: number }[];
};
type SessionClub = {
  club: string;
  shotShape: string | null;
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
  lieTypes?: string[];
  shotTypes?: string[];
  blocks?: SessionBlock[];
  clubs?: SessionClub[];
};

const PERSONAS: Persona[] = [
  { id: "beta", label: "Beta", blurb: "conservative · play it safe" },
  { id: "rain_man", label: "Rain Man", blurb: "your caddie · flat & factual" },
  { id: "captain_69", label: "Captain 69", blurb: "aggressive · send it" },
  { id: "the_ringer", label: "The Ringer", blurb: "scramble specialist" },
];

// Mission 7: the four loggable types (spec v2 §2). 'short_game' and 'net'
// (Spornia) are retired from the picker; their legacy rows still render via
// TYPE_LABEL below. A Recap "Take to Practice →" link (?focus=…) still lands
// here, but with the Focus Areas chips retired the param is simply ignored.
const SESSION_TYPES = [
  { id: "trackman", label: "Trackman range", sub: "Map my bag · feeds dispersion", feeds: "data" },
  { id: "grass_range", label: "Grass range", sub: "Off turf · no LM data", feeds: "feel" },
  { id: "around_green", label: "Around the green", sub: "Chip · pitch · flop · bunker", feeds: "feel" },
  { id: "putting", label: "Putting", sub: "Drill blocks · lag & gate", feeds: "feel" },
] as const satisfies readonly { id: SessionTypeId; label: string; sub: string; feeds: "data" | "feel" }[];

// Keeps entries for BOTH retired types so history renders: short_game has 7
// legacy rows; net has zero today, but the label is cheap insurance. Legacy is
// LABEL-ONLY (a logged decision) — these rows stay expandable and deletable.
const TYPE_LABEL: Record<string, string> = {
  trackman: "Trackman",
  grass_range: "Grass range",
  around_green: "Around the green",
  short_game: "Short game (legacy)",
  putting: "Putting",
  net: "Spornia net (legacy)",
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
  // type-specific — one state object keyed by FieldDef.key (see formFields.ts)
  const [fields, setFields] = useState<FieldValues>(initialFieldValues);
  // Putting only: the ordered drill-block list + the drill catalog for its picker.
  const [blocks, setBlocks] = useState<DrillBlockDraft[]>([]);
  const [puttingDrills, setPuttingDrills] = useState<PuttingDrill[]>([]);
  // Trackman + Grass Range + Around the Green: Clubs Used chip row (§4a/§4b/§4c).
  const [clubRoster, setClubRoster] = useState<ClubRosterEntry[]>([]);
  const [clubDrafts, setClubDrafts] = useState<SessionClubDrafts>({});
  const [expandedClub, setExpandedClub] = useState<string | null>(null);
  // Around the Green only: the lie/shot tag rows (Mission 6, §4c).
  const [lieTypes, setLieTypes] = useState<string[]>([]);
  const [shotTypes, setShotTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── History ──
  const [sessions, setSessions] = useState<Session[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Default date to today on the client (avoids a hydration mismatch).
  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
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

  const loadDrills = useCallback(async () => {
    try {
      const res = await fetch("/api/practice/drills");
      if (!res.ok) return;
      const j = (await res.json()) as { drills: PuttingDrill[] };
      setPuttingDrills(j.drills ?? []);
    } catch {
      /* leave the picker empty on failure */
    }
  }, []);

  const loadClubs = useCallback(async () => {
    try {
      const res = await fetch("/api/practice/clubs");
      if (!res.ok) return;
      const j = (await res.json()) as { clubs: ClubRosterEntry[] };
      setClubRoster(j.clubs ?? []);
    } catch {
      /* leave the chip row empty on failure */
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    void loadDrills();
    void loadClubs();
  }, [loadSessions, loadDrills, loadClubs]);

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
  function toggleTag(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  // ── Clubs Used (Trackman + Grass Range) — tap to toggle, expand for detail ──
  function toggleClub(club: string) {
    setClubDrafts((prev) => {
      if (club in prev) {
        const next = { ...prev };
        delete next[club];
        return next;
      }
      return { ...prev, [club]: { shotShape: "", note: "" } };
    });
    setExpandedClub((prev) => (prev === club ? null : prev));
  }

  function setClubShape(club: string, shotShape: string) {
    setClubDrafts((prev) => (club in prev ? { ...prev, [club]: { ...prev[club]!, shotShape } } : prev));
  }

  function setClubNote(club: string, note: string) {
    setClubDrafts((prev) => (club in prev ? { ...prev, [club]: { ...prev[club]!, note } } : prev));
  }

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setDurationMin("");
    setRating(0);
    setRecap("");
    setFields(initialFieldValues());
    setBlocks([]);
    setClubDrafts({});
    setExpandedClub(null);
    setLieTypes([]);
    setShotTypes([]);
  }

  async function saveSession() {
    setSaving(true);
    setSaveOk(false);
    setSaveError(null);

    // Per-type body assembly is registry-driven; the shape is pinned by
    // tests/form-fields.test.ts to the pre-registry hand-written version.
    const body = buildSaveBody({
      type,
      date,
      durationMin,
      rating,
      recap,
      fields,
      blocks,
      clubRoster,
      clubDrafts,
      lieTypes,
      shotTypes,
    });

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

  // ── Session: delete (cascades focus + metrics server-side) ──
  // Practice sessions never touch localStorage (they POST straight to Neon), so a
  // delete is just the server call + an immediate list update — no reconciliation.
  async function deleteSession(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/practice/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setDeleteError(j?.error ?? "Could not delete the session.");
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setConfirmDelete(null);
      if (expanded === id) setExpanded(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setDeletingId(null);
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
              // Collapse any open club detail — the next type may filter that club
              // out of its chip row (around_green shows eligible clubs only).
              setExpandedClub(null);
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
        {type === "around_green" && (
          <p className="pr-form-note feel">
            Chips, pitches, flops, bunker work. Tag the clubs, lies, and shots you worked — no
            percentages here; the feel goes in the recap.
          </p>
        )}
        {type === "putting" && (
          <p className="pr-form-note feel">
            Build the session from drill blocks — add each drill you ran, in order, and log its numbers.
            A block with just a note still counts (it records that you did the drill).
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

        {/* Type-specific — driven by the form-field registry (formFields.ts) */}
        <TypeFields defs={FORM_FIELDS[type]} fields={fields} onChange={setField} />

        {/* Putting — bespoke ordered drill-block list (not registry-driven) */}
        {type === "putting" && (
          <DrillBlocks blocks={blocks} drills={puttingDrills} onChange={setBlocks} />
        )}

        {/* Trackman + Grass Range — bespoke Clubs Used chip row (§4a/§4b, replaces Focus Areas) */}
        {(type === "trackman" || type === "grass_range") && (
          <ClubsUsed
            roster={clubRoster}
            drafts={clubDrafts}
            expanded={expandedClub}
            onToggle={toggleClub}
            onExpand={setExpandedClub}
            onShape={setClubShape}
            onNote={setClubNote}
          />
        )}

        {/* Around the Green (§4c) — the same Clubs Used chip row with two differences:
            roster filtered to around_green_eligible (7i–LW64) and note-only expand
            (no onShape — shot shape is a full-swing concept). Plus the lie/shot tag
            rows. "bunker" appears in both on purpose: sand lie vs. explosion shot. */}
        {type === "around_green" && (
          <>
            <ClubsUsed
              roster={clubRoster.filter((c) => c.aroundGreenEligible)}
              drafts={clubDrafts}
              expanded={expandedClub}
              onToggle={toggleClub}
              onExpand={setExpandedClub}
              onNote={setClubNote}
            />
            <TagChips
              label="Lie types"
              options={LIE_TYPES}
              selected={lieTypes}
              onToggle={(t) => setLieTypes((prev) => toggleTag(prev, t))}
            />
            <TagChips
              label="Shot types"
              options={SHOT_TYPES}
              selected={shotTypes}
              onToggle={(t) => setShotTypes((prev) => toggleTag(prev, t))}
            />
          </>
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

      {/* D — session history */}
      <div className="pr-label">Recent sessions</div>
      {deleteError && <p className="pr-err">{deleteError}</p>}
      <div className="pr-hist">
        {sessions.length === 0 && <p className="pr-empty">No sessions logged yet.</p>}
        {sessions.map((s) => {
          const open = expanded === s.id;
          const confirming = confirmDelete === s.id;
          const busy = deletingId === s.id;
          const recapFull = s.recap_md ?? "";
          const recapClip = recapFull.length > 100 ? `${recapFull.slice(0, 100)}…` : recapFull;
          return (
            <div key={s.id} className="pr-sess">
              <div className="pr-sess-head">
                <button
                  type="button"
                  className="pr-sess-toggle"
                  onClick={() => setExpanded(open ? null : s.id)}
                  aria-expanded={open}
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
                    {s.type === "putting" && s.blocks && s.blocks.length > 0 && (
                      <div className="pr-sess-blocks">
                        {s.blocks.map((b, i) => {
                          const noteClip =
                            b.note && b.note.length > 100 ? `${b.note.slice(0, 100)}…` : b.note ?? "";
                          return (
                            <div key={i} className="pr-sess-block">
                              <span className="pr-sess-block-t">{b.drillTitle}</span>
                              {b.metrics.length > 0 && (
                                <span className="pr-sess-block-m">
                                  {" — "}
                                  {b.metrics
                                    .map((m) => `${m.label}: ${m.value}${m.unit ? ` ${m.unit}` : ""}`)
                                    .join(", ")}
                                </span>
                              )}
                              {b.note && (
                                <div className={`pr-sess-sub${open ? "" : " clip"}`}>
                                  {open ? b.note : noteClip}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Around the Green — lie/shot tags, compactly: "tight · short rough — chipping · flops" */}
                    {s.type === "around_green" &&
                      ((s.lieTypes?.length ?? 0) > 0 || (s.shotTypes?.length ?? 0) > 0) && (
                        <div className="pr-sess-sub">
                          {[(s.lieTypes ?? []).join(" · "), (s.shotTypes ?? []).join(" · ")]
                            .filter(Boolean)
                            .join(" — ")}
                        </div>
                      )}
                    {(s.type === "trackman" || s.type === "grass_range" || s.type === "around_green") && s.clubs && s.clubs.length > 0 && (
                      <div className="pr-sess-clubs">
                        <div className="pr-sess-clubs-line">
                          {s.clubs.map((c) => (c.shotShape ? `${c.club} (${c.shotShape})` : c.club)).join(" · ")}
                        </div>
                        {s.clubs
                          .filter((c) => c.note)
                          .map((c, i) => {
                            const noteFull = c.note ?? "";
                            const noteClip = noteFull.length > 100 ? `${noteFull.slice(0, 100)}…` : noteFull;
                            return (
                              <div key={i} className={`pr-sess-sub${open ? "" : " clip"}`}>
                                <b>{c.club}:</b> {open ? noteFull : noteClip}
                              </div>
                            );
                          })}
                      </div>
                    )}
                    {recapFull && (
                      <div className={`pr-sess-sub${open ? "" : " clip"}`}>{open ? recapFull : recapClip}</div>
                    )}
                  </div>
                  <div className="pr-sess-date">{formatDate(s.date)}</div>
                </button>
                <button
                  type="button"
                  className="pr-sess-del mono"
                  onClick={() => setConfirmDelete(confirming ? null : s.id)}
                  disabled={busy}
                  aria-label="Delete session"
                >
                  Delete
                </button>
              </div>
              {confirming && (
                <div className="pr-sess-confirm">
                  <span className="pr-sess-confirm-tx">Delete this session permanently?</span>
                  <div className="pr-sess-confirm-btns">
                    <button
                      type="button"
                      className="pr-sess-confirm-no mono"
                      onClick={() => setConfirmDelete(null)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="pr-sess-confirm-yes mono"
                      onClick={() => deleteSession(s.id)}
                      disabled={busy}
                    >
                      {busy ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <footer style={{ fontSize: 12, color: "var(--faint)", marginTop: 24 }}>
        Built by Back Tee Partners
      </footer>
    </main>
  );
}

// ── Registry-driven field rendering (Mission 3) ─────────────────────────────────
// Consecutive layout:"grid" fields share one .pr-grid; standalone fields render
// as their own full-width .pr-field block — matching the hand-written markup
// this replaced, so the DOM (classes, ids, labels, placeholders) is unchanged.
function TypeFields({
  defs,
  fields,
  onChange,
}: {
  defs: FieldDef[];
  fields: FieldValues;
  onChange: (key: string, value: string) => void;
}) {
  const groups: { grid: boolean; defs: FieldDef[] }[] = [];
  for (const def of defs) {
    const last = groups[groups.length - 1];
    if (def.layout === "grid" && last && last.grid) last.defs.push(def);
    else groups.push({ grid: def.layout === "grid", defs: [def] });
  }
  return (
    <>
      {groups.map((g) =>
        g.grid ? (
          <div className="pr-grid" key={g.defs[0]!.key}>
            {g.defs.map((d) => (
              <Field key={d.key} def={d} fields={fields} onChange={onChange} />
            ))}
          </div>
        ) : (
          <Field key={g.defs[0]!.key} def={g.defs[0]!} fields={fields} onChange={onChange} />
        ),
      )}
    </>
  );
}

function Field({
  def,
  fields,
  onChange,
}: {
  def: FieldDef;
  fields: FieldValues;
  onChange: (key: string, value: string) => void;
}) {
  const wrap = def.layout === "standalone" ? "pr-field full" : `pr-field${def.gridFull ? " full" : ""}`;
  switch (def.kind) {
    case "text":
      return (
        <div className={wrap}>
          <label htmlFor={def.id}>{def.label}</label>
          <input
            id={def.id}
            className="pr-input"
            value={scalarValue(fields, def.key)}
            onChange={(e) => onChange(def.key, e.target.value)}
            placeholder={def.placeholder}
          />
        </div>
      );
    case "readonly":
      return (
        <div className={wrap}>
          <label>{def.label}</label>
          <input className="pr-input" value={def.displayValue} disabled readOnly />
        </div>
      );
  }
}

// ── Putting drill blocks (Mission 4) ────────────────────────────────────────────
// The bespoke widget the registry deliberately doesn't model: an ordered list of
// drill blocks. "Add block" opens a picker (General first, then drills by
// sort_order); a block renders its drill's metric inputs (unit-suffixed) + a note;
// General renders a note only. Blocks reorder (up/down), delete, and the same
// drill may be added more than once. All values optional. List order = position.
function DrillBlocks({
  blocks,
  drills,
  onChange,
}: {
  blocks: DrillBlockDraft[];
  drills: PuttingDrill[];
  onChange: (next: DrillBlockDraft[]) => void;
}) {
  const [picking, setPicking] = useState(false);

  function addBlock(drill: PuttingDrill) {
    const uid = `${drill.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const draft: DrillBlockDraft = {
      uid,
      drillId: drill.id,
      drillTitle: drill.title,
      metricDefs: drill.metricDefs,
      values: {},
      note: "",
    };
    onChange([...blocks, draft]);
    setPicking(false);
  }

  function patch(uid: string, next: Partial<DrillBlockDraft>) {
    onChange(blocks.map((b) => (b.uid === uid ? { ...b, ...next } : b)));
  }
  function setMetric(uid: string, metricId: string, value: string) {
    onChange(
      blocks.map((b) => (b.uid === uid ? { ...b, values: { ...b.values, [metricId]: value } } : b)),
    );
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    const tmp = next[idx]!;
    next[idx] = next[j]!;
    next[j] = tmp;
    onChange(next);
  }
  function remove(uid: string) {
    onChange(blocks.filter((b) => b.uid !== uid));
  }

  return (
    <div className="pr-field full">
      <label>Drill blocks</label>
      <div className="pr-blocks">
        {blocks.map((b, i) => (
          <div key={b.uid} className="pr-block">
            <div className="pr-block-head">
              <span className="pr-block-num">{i + 1}</span>
              <span className="pr-block-title">{b.drillTitle}</span>
              <div className="pr-block-ctrls">
                <button
                  type="button"
                  className="pr-block-ctrl mono"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move block up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="pr-block-ctrl mono"
                  onClick={() => move(i, 1)}
                  disabled={i === blocks.length - 1}
                  aria-label="Move block down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="pr-block-ctrl mono"
                  onClick={() => remove(b.uid)}
                  aria-label="Remove block"
                >
                  ✕
                </button>
              </div>
            </div>
            {b.metricDefs.length > 0 && (
              <div className="pr-grid pr-block-metrics">
                {b.metricDefs.map((m) => (
                  <div className="pr-field" key={m.id}>
                    <label htmlFor={`${b.uid}-${m.id}`}>{m.label}</label>
                    <div className="pr-metric-input">
                      <input
                        id={`${b.uid}-${m.id}`}
                        className="pr-input"
                        type="number"
                        inputMode="numeric"
                        value={b.values[m.id] ?? ""}
                        onChange={(e) => setMetric(b.uid, m.id, e.target.value)}
                        placeholder="—"
                      />
                      {m.unit && <span className="pr-metric-unit">{m.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <textarea
              className="pr-textarea pr-block-note"
              value={b.note}
              onChange={(e) => patch(b.uid, { note: e.target.value })}
              placeholder={b.metricDefs.length > 0 ? "Block note (optional)" : "What you worked on…"}
            />
          </div>
        ))}

        {picking ? (
          <div className="pr-picker">
            {drills.length === 0 && <p className="pr-empty">No drills available.</p>}
            {drills.map((d) => (
              <button key={d.id} type="button" className="pr-picker-opt" onClick={() => addBlock(d)}>
                <b>{d.title}</b>
                {d.metricDefs.length > 0 ? (
                  <small>{d.metricDefs.map((m) => m.label).join(" · ")}</small>
                ) : (
                  <small>Note only</small>
                )}
              </button>
            ))}
            <button
              type="button"
              className="pr-picker-cancel mono"
              onClick={() => setPicking(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="pr-addblock" onClick={() => setPicking(true)}>
            + Add block
          </button>
        )}
      </div>
    </div>
  );
}

// ── Clubs Used (Mission 5) ───────────────────────────────────────────────────
// Trackman + Grass Range's replacement for Focus Areas (§4a/§4b): the full bag,
// in bag order, as tap-to-toggle chips. A selected chip gains an expand
// affordance (▾/▲) that opens its collapsed-by-default detail — primary shot
// shape (single-select) + a club note — mirroring Mission 4's drill-block
// tag-then-expand pattern. A quick session is just tapping chips and saving.
// Around the Green (§4c) reuses this with a filtered roster and NO onShape:
// its expand is the note only (shot shape is a full-swing concept).
function ClubsUsed({
  roster,
  drafts,
  expanded,
  onToggle,
  onExpand,
  onShape,
  onNote,
}: {
  roster: ClubRosterEntry[];
  drafts: SessionClubDrafts;
  expanded: string | null;
  onToggle: (club: string) => void;
  onExpand: (club: string | null) => void;
  onShape?: (club: string, shotShape: string) => void;
  onNote: (club: string, note: string) => void;
}) {
  return (
    <div className="pr-field full">
      <label>Clubs used</label>
      <div className="pr-chips">
        {roster.map((c) => {
          const selected = c.name in drafts;
          const isOpen = expanded === c.name;
          return (
            <div key={c.name} className="pr-club-pill">
              <button
                type="button"
                className={`pr-chip${selected ? " on" : ""}`}
                onClick={() => onToggle(c.name)}
              >
                {c.name}
              </button>
              {selected && (
                <button
                  type="button"
                  className="pr-club-expand"
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${c.name} detail`}
                  aria-expanded={isOpen}
                  onClick={() => onExpand(isOpen ? null : c.name)}
                >
                  {isOpen ? "▲" : "▾"}
                </button>
              )}
            </div>
          );
        })}
        {roster.length === 0 && <p className="pr-empty">Loading the bag…</p>}
      </div>

      {expanded && expanded in drafts && (
        <div className="pr-club-detail">
          {onShape && (
            <div className="pr-field">
              <label>{expanded} — shot shape</label>
              <div className="pr-chips">
                {SHOT_SHAPES.map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    className={`pr-chip${drafts[expanded]!.shotShape === shape ? " on" : ""}`}
                    onClick={() => onShape(expanded, drafts[expanded]!.shotShape === shape ? "" : shape)}
                  >
                    {shape}
                  </button>
                ))}
              </div>
            </div>
          )}
          <textarea
            className="pr-textarea"
            value={drafts[expanded]!.note}
            onChange={(e) => onNote(expanded, e.target.value)}
            placeholder={`Note on the ${expanded} (optional)`}
          />
        </div>
      )}
    </div>
  );
}

// ── Lie / Shot tag rows (Mission 6, §4c) ─────────────────────────────────────
// A plain multi-select chip row → a text[] tag array on the session. No expand,
// no per-chip detail — the simplest of the bespoke chip widgets.
function TagChips({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (tag: string) => void;
}) {
  return (
    <div className="pr-field full">
      <label>{label}</label>
      <div className="pr-chips">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={`pr-chip${selected.includes(o) ? " on" : ""}`}
            onClick={() => onToggle(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
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
