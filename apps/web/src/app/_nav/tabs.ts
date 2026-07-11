// The bottom tab-bar model — pure, React-free so it can be unit-tested in the
// repo's node-env Vitest harness without rendering. The <BottomNav> component and
// tests/bottom-nav.test.ts both import from here, so the nav and its test can't drift.
//
// Tabs (Mission S2, D20): Plan → /courses · Stats → /stats · Practice →
// /practice · Bag → /bag. Stats takes the retired Play tab's slot. The landing
// route ("/") is intentionally NOT a tab, so every tab is inactive there.

export type TabIcon = "plan" | "stats" | "practice" | "bag";

export interface NavTab {
  label: string;
  href: string;
  icon: TabIcon;
}

export const TABS: readonly NavTab[] = [
  { label: "Plan", href: "/courses", icon: "plan" },
  { label: "Stats", href: "/stats", icon: "stats" },
  { label: "Practice", href: "/practice", icon: "practice" },
  { label: "Bag", href: "/bag", icon: "bag" },
];

/**
 * A tab is active when the current path is its route or a descendant of it —
 * so /courses/glen-club lights "Plan" and /stats/2026 lights "Stats". The
 * trailing-slash guard stops a sibling like /statsx from false-matching /stats.
 */
export function isActiveTab(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
