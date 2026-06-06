// The bottom tab-bar model — pure, React-free so it can be unit-tested in the
// repo's node-env Vitest harness without rendering. The <BottomNav> component and
// tests/bottom-nav.test.ts both import from here, so the nav and its test can't drift.
//
// Tabs are locked by Mission 1: Plan → /courses · Play → /play · Practice →
// /practice · Bag → /bag. The landing route ("/") is intentionally NOT a tab, so
// every tab is inactive there.

export type TabIcon = "plan" | "play" | "practice" | "bag";

export interface NavTab {
  label: string;
  href: string;
  icon: TabIcon;
}

export const TABS: readonly NavTab[] = [
  { label: "Plan", href: "/courses", icon: "plan" },
  { label: "Play", href: "/play", icon: "play" },
  { label: "Practice", href: "/practice", icon: "practice" },
  { label: "Bag", href: "/bag", icon: "bag" },
];

/**
 * A tab is active when the current path is its route or a descendant of it —
 * so /courses/glen-club lights "Plan" and /play/x/holes/3 lights "Play". The
 * trailing-slash guard stops /playground from false-matching the /play tab.
 */
export function isActiveTab(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
