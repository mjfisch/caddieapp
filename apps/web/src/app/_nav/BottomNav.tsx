"use client";

// Persistent bottom tab bar (Mission 1). Client component: active state is
// derived from the live path via usePathname. Icons are hand-rolled inline SVG
// (currentColor) — same approach as the homepage DispersionMark, so no new icon
// dependency. Fixed to the viewport bottom and padded for the iOS safe area.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, isActiveTab, type TabIcon } from "./tabs";

function TabIconGlyph({ name }: { name: TabIcon }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "plan": // folded course map
      return (
        <svg {...common}>
          <path d="M9 4 3 6.2v13.8L9 18l6 2 6-2V4l-6 2-6-2Z" />
          <path d="M9 4v14M15 6v14" />
        </svg>
      );
    case "stats": // bar chart — round history & trends
      return (
        <svg {...common}>
          <path d="M4 20h16" />
          <path d="M7 20v-6M12 20V6M17 20v-9" />
        </svg>
      );
    case "practice": // dispersion target
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "bag": // golf bag with clubs
      return (
        <svg {...common}>
          <rect x="7" y="7" width="9.5" height="14" rx="3" />
          <path d="M10 7V4M13 7V3.5" />
          <path d="M7 12.5h9.5" />
        </svg>
      );
  }
}

export default function BottomNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map((tab) => {
        const active = isActiveTab(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "tab active" : "tab"}
            aria-current={active ? "page" : undefined}
          >
            <TabIconGlyph name={tab.icon} />
            <span className="tab-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
