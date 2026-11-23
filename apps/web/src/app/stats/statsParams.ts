import { STATS_WINDOWS, type StatsWindow } from "./computeStats";
import { PRACTICE_WINDOWS, type PracticeWindow } from "./computePracticeStats";

// =============================================================
// D31 — the /stats URL contract. Pure, clock-free, DOM-free.
//
//   /stats?view=rounds|practice&window=<id>
//     view   — rounds (default) | practice
//     window — applies to the active view only:
//              rounds:   last20 (default) | ytd | hcp8
//              practice: 4w (default) | 12w | ytd
//
// Unknown or missing values fall back to the defaults, never an error. The
// canonical query omits defaults, so plain /stats is the default view.
// =============================================================

export const STATS_VIEWS = ["rounds", "practice"] as const;
export type StatsViewId = (typeof STATS_VIEWS)[number];

export const DEFAULT_VIEW: StatsViewId = "rounds";
export const DEFAULT_ROUNDS_WINDOW: StatsWindow = "last20";
export const DEFAULT_PRACTICE_WINDOW: PracticeWindow = "4w";

export type StatsUrlState = {
  view: StatsViewId;
  roundsWindow: StatsWindow;
  practiceWindow: PracticeWindow;
};

type RawParam = string | string[] | undefined;

function first(v: RawParam): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function pick<T extends string>(allowed: readonly T[], v: string | undefined, fallback: T): T {
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Parse Next's searchParams record into a fully defaulted state. */
export function parseStatsParams(params: Record<string, RawParam>): StatsUrlState {
  const view = pick(STATS_VIEWS, first(params.view), DEFAULT_VIEW);
  const win = first(params.window);
  return {
    view,
    roundsWindow: view === "rounds" ? pick(STATS_WINDOWS, win, DEFAULT_ROUNDS_WINDOW) : DEFAULT_ROUNDS_WINDOW,
    practiceWindow:
      view === "practice" ? pick(PRACTICE_WINDOWS, win, DEFAULT_PRACTICE_WINDOW) : DEFAULT_PRACTICE_WINDOW,
  };
}

/** Canonical query string ("" or "?view=practice&window=12w") — defaults omitted. */
export function buildStatsQuery(state: StatsUrlState): string {
  const q = new URLSearchParams();
  if (state.view !== DEFAULT_VIEW) q.set("view", state.view);
  const win = state.view === "rounds" ? state.roundsWindow : state.practiceWindow;
  const def = state.view === "rounds" ? DEFAULT_ROUNDS_WINDOW : DEFAULT_PRACTICE_WINDOW;
  if (win !== def) q.set("window", win);
  const s = q.toString();
  return s ? `?${s}` : "";
}
