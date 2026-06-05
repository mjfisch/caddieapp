"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Mode B on-course hole view (Phase 4). Glance-and-go: club, carry, one sentence.
// Auto-loads the caddie read on mount — no "Get read" button. Persona + scores
// persist in localStorage; conditions live in a slide-up settings sheet.
//
// CLIENT code: it must never import @gai/api or reference the Anthropic key
// (invariant #3). It talks to the server only over fetch to /api/strategy.

type EngineView = {
  club: string;
  carryTarget: number;
  dangerSide: "left" | "right" | "center" | null;
  layupRecommended: boolean;
  confidenceFlag: "measured" | "partial" | "seeded";
};

// Locked personas (invariant #6). Ids match @gai/sg-engine PERSONAS keys.
const PERSONAS: { id: string; label: string }[] = [
  { id: "beta", label: "Beta" },
  { id: "rain_man", label: "Rain Man" },
  { id: "captain_69", label: "Captain 69" },
  { id: "the_ringer", label: "The Ringer" },
];

const PERSONA_LABEL: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p.label]),
);

const WIND_DIRS = ["Into", "Down", "Cross", "N", "S", "E", "W"] as const;
const PINS = ["front", "middle", "back"] as const;

const DEFAULT_PERSONA = "rain_man"; // per the brief
const PERSONA_KEY = "gai-caddie-persona";
const SCORES_KEY = "gai-play-scores";
const PUTTS_KEY = "gai-play-putts";
// Active-round id, keyed by course → { date, roundId }. localStorage stays the
// source of truth for the active round; Neon is the persistence layer behind it.
const ROUND_ID_KEY = "gai-play-round-id";

const SCORE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
const PUTT_OPTIONS = [0, 1, 2, 3, 4];

/** Today's date as YYYY-MM-DD in local time (matches the played_date we store). */
function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

interface SseEvent {
  event: string;
  data: unknown;
}

/** Parse one raw SSE frame (`event: x\ndata: {...}`) into {event, data}. */
function parseFrame(raw: string): SseEvent | null {
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

/** Truncate streamed prose at the third sentence boundary (Mode B keeps it to 3). */
function clampToThreeSentences(text: string): string {
  const matches = text.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!matches || matches.length <= 3) return text.trim();
  return matches.slice(0, 3).join("").trim();
}

const CONFIDENCE_CLASS: Record<EngineView["confidenceFlag"], string> = {
  measured: "mb-chip-measured",
  partial: "mb-chip-partial",
  seeded: "mb-chip-seeded",
};

export default function HoleView({
  courseId,
  holeNumber,
  par,
  strokeIndex,
  imageSrc,
  totalHoles,
}: {
  courseId: string;
  holeNumber: number;
  par: number;
  strokeIndex: number | null;
  imageSrc: string;
  totalHoles: number;
}) {
  const router = useRouter();
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [windMph, setWindMph] = useState("");
  const [windDir, setWindDir] = useState<string>("Into");
  const [pinPosition, setPinPosition] = useState<(typeof PINS)[number]>("middle");
  const [notes, setNotes] = useState("");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [engine, setEngine] = useState<EngineView | null>(null);
  const [caddieText, setCaddieText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [putts, setPutts] = useState<number | null>(null);
  const [allScored, setAllScored] = useState(false);

  // The active round's id (Neon), resolved on mount. A ref so the fire-and-forget
  // sync always sees the latest value without re-creating its callback.
  const roundIdRef = useRef<string | null>(null);

  // Count how many of this course's holes have a saved score → drives the Finish
  // button (appears once all holes are scored).
  const refreshAllScored = useCallback(() => {
    try {
      const scores = JSON.parse(localStorage.getItem(SCORES_KEY) ?? "{}");
      const n = Object.keys(scores).filter(
        (k) => k.startsWith(`${courseId}-`) && typeof scores[k] === "number",
      ).length;
      setAllScored(n >= totalHoles);
    } catch {
      /* localStorage unavailable */
    }
  }, [courseId, totalHoles]);

  // Hydrate persona + this hole's saved score/putts from localStorage on mount.
  useEffect(() => {
    try {
      const storedPersona = localStorage.getItem(PERSONA_KEY);
      if (storedPersona) setPersona(storedPersona);
      const scores = JSON.parse(localStorage.getItem(SCORES_KEY) ?? "{}");
      const saved = scores?.[`${courseId}-${holeNumber}`];
      if (typeof saved === "number") setScore(saved);
      const allPutts = JSON.parse(localStorage.getItem(PUTTS_KEY) ?? "{}");
      const savedPutts = allPutts?.[`${courseId}-${holeNumber}`];
      if (typeof savedPutts === "number") setPutts(savedPutts);
    } catch {
      /* localStorage unavailable — fall back to defaults */
    }
    refreshAllScored();
  }, [courseId, holeNumber, refreshAllScored]);

  // Ensure a Neon round exists for today's play on this course. Reuses an existing
  // round from localStorage if one was already opened today; otherwise creates one.
  // Best-effort: a failure here never blocks play (localStorage is the truth).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = JSON.parse(localStorage.getItem(ROUND_ID_KEY) ?? "{}");
        const existing = map?.[courseId];
        if (existing && existing.date === today() && typeof existing.roundId === "string") {
          roundIdRef.current = existing.roundId;
          return;
        }
        const res = await fetch("/api/rounds", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ courseId, playedDate: today(), teeSet: "white" }),
        });
        if (!res.ok) return;
        const { roundId } = (await res.json()) as { roundId: string };
        if (cancelled || !roundId) return;
        roundIdRef.current = roundId;
        map[courseId] = { date: today(), roundId };
        localStorage.setItem(ROUND_ID_KEY, JSON.stringify(map));
      } catch {
        /* offline / localStorage unavailable — play continues on localStorage */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // Fire-and-forget: persist this hole's score to Neon. Never blocks the UI; a
  // failed write is silently dropped (localStorage already holds the score).
  const syncHole = useCallback(
    (strokes: number, puttCount: number | null) => {
      const roundId = roundIdRef.current;
      if (!roundId) return;
      void fetch(`/api/rounds/${roundId}/holes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          holeNumber,
          strokes,
          putts: puttCount,
        }),
      }).catch(() => {
        /* fire and forget */
      });
    },
    [holeNumber],
  );

  // Abort any in-flight read when a new one starts or the component unmounts.
  const abortRef = useRef<AbortController | null>(null);

  const getRead = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setEngine(null);
    setCaddieText("");

    const conditions: Record<string, unknown> = { pinPosition };
    const w = Number(windMph);
    if (windMph.trim() !== "" && !Number.isNaN(w) && w > 0) {
      conditions.windMph = w;
      if (windDir) conditions.windDir = windDir;
    }
    if (notes.trim() !== "") conditions.notes = notes.trim();

    try {
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, holeNumber, persona, conditions }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "Could not get a read.");
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
          if (frame.event === "engine") {
            setEngine(frame.data as EngineView);
          } else if (frame.event === "delta") {
            acc += (frame.data as { text: string }).text;
            setCaddieText(clampToThreeSentences(acc));
          } else if (frame.event === "error") {
            setError((frame.data as { error: string }).error);
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, holeNumber, persona, windMph, windDir, pinPosition, notes]);

  // Keep a stable ref to the latest getRead so the auto-fire effect can call it
  // without re-firing on every conditions keystroke (only on mount / hole change /
  // persona change, per Steps 2 & 4). Conditions re-fire on sheet dismiss instead.
  const getReadRef = useRef(getRead);
  getReadRef.current = getRead;

  // Auto-fire on page open, on persona change, and on hole change. Navigating to a
  // new hole remounts this component (the route is force-dynamic), so a fresh read
  // streams in immediately for each hole.
  useEffect(() => {
    getReadRef.current();
    return () => abortRef.current?.abort();
  }, [courseId, holeNumber, persona]);

  function chooseScore(n: number) {
    setScore(n);
    try {
      const scores = JSON.parse(localStorage.getItem(SCORES_KEY) ?? "{}");
      scores[`${courseId}-${holeNumber}`] = n;
      localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
    } catch {
      /* localStorage unavailable — selection is still reflected in UI state */
    }
    // Persist to Neon (fire-and-forget) and recompute whether the round is complete.
    syncHole(n, putts);
    refreshAllScored();
  }

  function choosePutts(n: number) {
    const next = putts === n ? null : n; // tap again to clear
    setPutts(next);
    try {
      const all = JSON.parse(localStorage.getItem(PUTTS_KEY) ?? "{}");
      if (next == null) delete all[`${courseId}-${holeNumber}`];
      else all[`${courseId}-${holeNumber}`] = next;
      localStorage.setItem(PUTTS_KEY, JSON.stringify(all));
    } catch {
      /* localStorage unavailable — selection is still reflected in UI state */
    }
    // Only sync once a score exists (strokes is required on the round_hole row).
    if (score != null) syncHole(score, next);
  }

  function choosePersona(id: string) {
    setPersona(id);
    try {
      localStorage.setItem(PERSONA_KEY, id);
    } catch {
      /* ignore */
    }
  }

  // Dismissing the sheet re-fires the read with whatever conditions are now set
  // (Step 3). Persona changes already re-fire via the auto-fire effect.
  const closeSheet = () => {
    setSheetOpen(false);
    getRead();
  };

  const prev = holeNumber > 1 ? holeNumber - 1 : null;
  const next = holeNumber < totalHoles ? holeNumber + 1 : null;

  return (
    <main className="mb-page">
      {/* Hole header */}
      <header className="mb-header">
        <span className="mb-holenum mono">{holeNumber}</span>
        <div className="mb-header-right">
          <span className="mb-meta mono">
            PAR {par}
            {strokeIndex != null && <span className="mb-meta-si"> · SI {strokeIndex}</span>}
          </span>
          <button
            type="button"
            className="mb-settings-btn"
            aria-label="Conditions & persona"
            onClick={() => setSheetOpen(true)}
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="mb-persona-name mono">{PERSONA_LABEL[persona] ?? persona}</div>

      {/* Satellite image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageSrc} alt={`Hole ${holeNumber} satellite view`} className="hole-image mb-image" />

      {/* Engine block — the decision (invariant #1, numbers come from the engine) */}
      <section className="mb-engine" aria-live="polite">
        {engine ? (
          <>
            <div className="mb-club mono">{engine.club}</div>
            <div className="mb-carry mono">
              {engine.carryTarget}
              <span className="mb-carry-unit">yds</span>
            </div>
            <div className="mb-chips">
              {engine.dangerSide != null && (
                <span className="mb-chip mb-chip-danger mono">⚠ {engine.dangerSide}</span>
              )}
              <span className={`mb-chip ${CONFIDENCE_CLASS[engine.confidenceFlag]} mono`}>
                {engine.confidenceFlag}
              </span>
              {engine.layupRecommended && <span className="mb-chip mb-chip-layup mono">layup</span>}
            </div>
          </>
        ) : (
          <div className="mb-club-placeholder mono">{error ? "—" : "reading…"}</div>
        )}
      </section>

      {error && <p className="mb-error">{error}</p>}

      {/* Caddie voice — streams in, clamped to 3 sentences */}
      {(caddieText || loading) && (
        <p className="mb-caddie" aria-live="polite" aria-busy={loading}>
          {caddieText || "Reading the hole…"}
        </p>
      )}

      {/* Score entry */}
      <section className="mb-score-section">
        <div className="mb-score-label mono">Score</div>
        <div className="mb-scores">
          {SCORE_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={`mb-score-chip mono${score === n ? " selected" : ""}`}
              onClick={() => chooseScore(n)}
              aria-pressed={score === n}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Putts (optional) — smaller chips, muted label. Tap again to clear. */}
        <div className="mb-putts-label mono">Putts</div>
        <div className="mb-putts">
          {PUTT_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={`mb-putt-chip mono${putts === n ? " selected" : ""}`}
              onClick={() => choosePutts(n)}
              aria-pressed={putts === n}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      {/* Finish round — appears once every hole has a score. */}
      {allScored && (
        <button
          type="button"
          className="mb-finish-btn mono"
          onClick={() => {
            const roundId = roundIdRef.current;
            if (roundId) router.push(`/play/${courseId}/recap/${roundId}`);
            else router.push(`/play/${courseId}`);
          }}
        >
          Finish round →
        </button>
      )}

      {/* Hole navigation */}
      <nav className="mb-nav">
        {prev != null ? (
          <Link href={`/play/${courseId}/holes/${prev}`} className="mb-nav-btn mono">
            ← {prev}
          </Link>
        ) : (
          <Link href={`/play/${courseId}`} className="mb-nav-btn mono">
            ← holes
          </Link>
        )}
        {next != null ? (
          <Link href={`/play/${courseId}/holes/${next}`} className="mb-nav-btn mono">
            {next} →
          </Link>
        ) : (
          <Link href={`/play/${courseId}`} className="mb-nav-btn mono">
            done →
          </Link>
        )}
      </nav>

      {/* Settings sheet (slide-up). Tapping the backdrop dismisses it. */}
      {sheetOpen && (
        <div className="mb-sheet-backdrop" onClick={closeSheet}>
          <div
            className="mb-sheet"
            role="dialog"
            aria-label="Conditions and persona"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-sheet-handle" />

            <div className="mb-field">
              <span className="mb-field-label mono">Persona</span>
              <div className="mb-persona-grid">
                {PERSONAS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`mb-persona-btn mono${p.id === persona ? " selected" : ""}`}
                    onClick={() => choosePersona(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-sheet-row">
              <label className="mb-field">
                <span className="mb-field-label mono">Wind (mph)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className="mb-input mono"
                  value={windMph}
                  onChange={(e) => setWindMph(e.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="mb-field">
                <span className="mb-field-label mono">Direction</span>
                <select
                  className="mb-input mono"
                  value={windDir}
                  onChange={(e) => setWindDir(e.target.value)}
                >
                  {WIND_DIRS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mb-field">
              <span className="mb-field-label mono">Pin</span>
              <select
                className="mb-input mono"
                value={pinPosition}
                onChange={(e) => setPinPosition(e.target.value as (typeof PINS)[number])}
              >
                {PINS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            <label className="mb-field">
              <span className="mb-field-label mono">Notes</span>
              <input
                type="text"
                className="mb-input mono"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="firm greens, tucked pin…"
              />
            </label>

            <button type="button" className="mb-sheet-done mono" onClick={closeSheet}>
              Done
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
