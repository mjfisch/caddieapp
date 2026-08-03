"use client";

import { useState } from "react";
import { StatsView } from "./StatsView";
import { PracticeView } from "./PracticeView";
import type { StatsRound } from "./computeStats";
import type { PracticeMetricDef, PracticeStatsSession } from "./computePracticeStats";

// =============================================================
// Mission S8 — the ROUNDS · PRACTICE segmented toggle (D28, amending D25's
// rounds-only framing of the Stats tab). Same visual pattern as the Club
// Confidence panel's DATA · FEEL pairing.
//
// ROUNDS is the default and renders the S6 view UNCHANGED — this component
// only mounts it. Each half owns its own filter windows: rounds keep
// Last 20 / YTD / Hcp 8 on round.played_date; practice gets 4W / 12W / YTD on
// practice_session.date.
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
}: {
  rounds: StatsRound[];
  currentYear: number;
  practiceSessions: PracticeStatsSession[];
  practiceMetricDefs: PracticeMetricDef[];
  today: string;
}) {
  const [tab, setTab] = useState<TabId>("rounds");

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
        <StatsView rounds={rounds} currentYear={currentYear} />
      ) : (
        <PracticeView
          sessions={practiceSessions}
          metricDefs={practiceMetricDefs}
          today={today}
        />
      )}
    </>
  );
}
