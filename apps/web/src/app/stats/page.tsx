import { listStatsRounds, syncRounds } from "@gai/api";
import { StatsView } from "./StatsView";

// Stats tab — Mission S6 (D24/D25). A clean data surface: three query windows
// over the FULL round table × the seven derived stat groups. The server loads
// every non-test round once (read-only — round/round_hole/course); every
// number is derived client-side through the pure computeStats module, the
// same one the golden-round unit tests pin. No narrative, no coaching copy —
// that's Plan's job (D19).
//
// DB-backed, server-only (mirrors /bag). pg needs the Node runtime; the data
// is live, so never statically cache. INVARIANT #3: @gai/api stays server-side.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StatsPage() {
  await syncRounds();
  const rounds = await listStatsRounds();

  return (
    <main className="st-page">
      <header className="st-header">
        <span className="lp-eyebrow">Stats</span>
        <h1 className="st-title serif">The record</h1>
      </header>
      <StatsView rounds={rounds} currentYear={new Date().getFullYear()} />
    </main>
  );
}
