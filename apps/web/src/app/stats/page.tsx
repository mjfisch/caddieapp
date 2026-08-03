import { listPracticeStats, listStatsRounds, syncRounds } from "@gai/api";
import { StatsTabs } from "./StatsTabs";

// Stats tab — Mission S6 (D24/D25) + Mission S8 (D28). A clean data surface
// covering BOTH halves of the record behind a ROUNDS · PRACTICE toggle.
//
// Rounds: three query windows over the FULL round table × the seven derived
// stat groups. Practice: three windows over every logged practice session ×
// the seven practice stat groups. The server loads each side once; every
// number is derived client-side through the pure computeStats /
// computePracticeStats modules the unit tests pin. No narrative, no coaching
// copy — that's Plan's job (D19).
//
// DB-backed, server-only (mirrors /bag). pg needs the Node runtime; the data
// is live, so never statically cache. INVARIANT #3: @gai/api stays server-side.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Today as YYYY-MM-DD in the server's local zone — the practice windows' anchor. */
function todayIso(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default async function StatsPage() {
  await syncRounds();
  const [rounds, practice] = await Promise.all([listStatsRounds(), listPracticeStats()]);
  const now = new Date();

  return (
    <main className="st-page">
      <header className="st-header">
        <span className="lp-eyebrow">Stats</span>
        <h1 className="st-title serif">The record</h1>
      </header>
      <StatsTabs
        rounds={rounds}
        currentYear={now.getFullYear()}
        practiceSessions={practice.sessions}
        practiceMetricDefs={practice.metricDefs}
        today={todayIso(now)}
      />
    </main>
  );
}
