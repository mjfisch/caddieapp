"use client";

import { useState } from "react";
import { StatsView } from "./StatsView";
import { PracticeView } from "./PracticeView";
import type { StatsRound, StatsWindow } from "./computeStats";
import type {
  PracticeMetricDef,
  PracticeStatsSession,
  PracticeWindow,
} from "./computePracticeStats";
import { buildStatsQuery, type StatsUrlState } from "./statsParams";

// =============================================================
// Mission S8 — the ROUNDS · PRACTICE segmented toggle (D28, amending D25's
// rounds-only framing of the Stats tab). Same visual pattern as the Club
// Confidence panel's DATA · FEEL pairing.
//
// ROUNDS is the default and renders the S6 view UNCHANGED — this component
// only mounts it. Each half owns its own filter windows: rounds keep
// Last 20 / YTD / Hcp 8 on round.played_date; practice gets 4W / 12W / YTD on
// practice_session.date.
//
// D31 — view + window are addressable (/stats?view=practice&window=12w). The
// server page parses searchParams into `initial`, so the first HTML is already
// the requested view; after that this component owns the state and mirrors it
// into the URL with history.replaceState — no navigation, no server refetch,
// no Back-button spam.
// =============================================================

const TABS = [
  { id: "rounds", label: "Rounds" },
  { id: "practice", label: "Practice" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function StatsTabs({
  rounds,
  currentYear,
  practiceSessions,
  practiceMetricDefs,
  today,
  initial,
}: {
  rounds: StatsRound[];
  currentYear: number;
  practiceSessions: PracticeStatsSession[];
  practiceMetricDefs: PracticeMetricDef[];
  today: string;
  /** Parsed from the request's searchParams (parseStatsParams). */
  initial: StatsUrlState;
}) {
  const [state, setState] = useState<StatsUrlState>(initial);
  const tab: TabId = state.view;

  function update(next: StatsUrlState) {
    setState(next);
    globalThis.history.replaceState(
      globalThis.history.state,
      "",
      `${globalThis.location.pathname}${buildStatsQuery(next)}`,
    );
  }
  const setTab = (view: TabId) => update({ ...state, view });

  return (
    <>
      <div className="ps-toggle" role="tablist" aria-label="Stats surface">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`ps-toggle-btn mono${tab === t.id ? " on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "rounds" ? (
        <StatsView
          rounds={rounds}
          currentYear={currentYear}
          window={state.roundsWindow}
          onWindowChange={(w: StatsWindow) => update({ ...state, roundsWindow: w })}
        />
      ) : (
        <PracticeView
          sessions={practiceSessions}
          metricDefs={practiceMetricDefs}
          today={today}
          window={state.practiceWindow}
          onWindowChange={(w: PracticeWindow) => update({ ...state, practiceWindow: w })}
        />
      )}
    </>
  );
}
