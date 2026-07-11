import { describe, it, expect } from "vitest";
import { TABS, isActiveTab } from "../apps/web/src/app/_nav/tabs";

// The persistent bottom nav. The tab model and its active-state logic are pure
// (no React), so they're tested directly in the node-env harness without rendering.
// <BottomNav> imports the same module, so what's asserted here is what ships.
// Mission S2 (D20) reshaped the nav to Plan · Stats · Practice · Bag — Stats took
// the retired Play tab's slot.

describe("bottom nav tab model", () => {
  it("has exactly 4 tabs", () => {
    expect(TABS).toHaveLength(4);
  });

  it("maps each tab to the mission's route, in order", () => {
    expect(TABS.map((t) => t.href)).toEqual(["/courses", "/stats", "/practice", "/bag"]);
  });

  it("labels the tabs Plan / Stats / Practice / Bag", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Plan", "Stats", "Practice", "Bag"]);
  });
});

describe("isActiveTab resolves the active tab from the path", () => {
  it("matches a tab's own route exactly", () => {
    expect(isActiveTab("/courses", "/courses")).toBe(true);
  });

  it("matches descendant routes under a tab", () => {
    expect(isActiveTab("/courses/glen-club", "/courses")).toBe(true);
    expect(isActiveTab("/stats/2026", "/stats")).toBe(true);
  });

  it("does not light a different tab", () => {
    expect(isActiveTab("/stats", "/courses")).toBe(false);
  });

  it("does not false-match a prefix that isn't a path segment", () => {
    expect(isActiveTab("/statsx", "/stats")).toBe(false);
  });

  it("leaves every tab inactive on the landing route", () => {
    expect(TABS.some((t) => isActiveTab("/", t.href))).toBe(false);
  });
});
