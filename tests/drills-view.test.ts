import { describe, it, expect } from "vitest";
import { toPuttingDrillView, type PuttingDrillRow } from "@gai/api";

// GET /api/practice/drills — row → wire mapping. Pure, no DB. `better` is
// additive: every metric def carries it, passed through as 'lower' | 'higher',
// otherwise null (never invented).

const PAST_LADDER_ROW: PuttingDrillRow = {
  id: "past-uuid",
  title: "Past Ladder",
  area: "putting",
  is_system: false,
  sort_order: 2,
  metric_defs: [
    { id: "d", label: "Distance", unit: "ft", valueType: "integer", better: null },
    { id: "b", label: "Balls", unit: null, valueType: "integer", better: null },
    { id: "s", label: "Short", unit: null, valueType: "integer", better: "lower" },
    { id: "z", label: "In zone", unit: null, valueType: "integer", better: "higher" },
    { id: "l", label: "Long", unit: null, valueType: "integer", better: "lower" },
    { id: "c", label: "Longest comeback", unit: "ft", valueType: "integer", better: "lower" },
  ],
};

describe("toPuttingDrillView", () => {
  it("keeps every previous field and adds better per metric def", () => {
    const view = toPuttingDrillView(PAST_LADDER_ROW);
    expect(view).toEqual({
      id: "past-uuid",
      title: "Past Ladder",
      area: "putting",
      isSystem: false,
      sortOrder: 2,
      metricDefs: [
        { id: "d", label: "Distance", unit: "ft", valueType: "integer", better: null },
        { id: "b", label: "Balls", unit: null, valueType: "integer", better: null },
        { id: "s", label: "Short", unit: null, valueType: "integer", better: "lower" },
        { id: "z", label: "In zone", unit: null, valueType: "integer", better: "higher" },
        { id: "l", label: "Long", unit: null, valueType: "integer", better: "lower" },
        { id: "c", label: "Longest comeback", unit: "ft", valueType: "integer", better: "lower" },
      ],
    });
    for (const m of view.metricDefs) expect(m).toHaveProperty("better");
  });

  it("never invents a direction: missing or unexpected better → null", () => {
    const view = toPuttingDrillView({
      ...PAST_LADDER_ROW,
      metric_defs: [
        { id: "x", label: "X", unit: null, valueType: "integer" },
        { id: "y", label: "Y", unit: null, valueType: "integer", better: "sideways" },
      ],
    });
    expect(view.metricDefs.map((m) => m.better)).toEqual([null, null]);
  });

  it("General (no defs, metric_defs null or []) → empty metricDefs", () => {
    const general = { ...PAST_LADDER_ROW, title: "General", is_system: true, sort_order: 0 };
    expect(toPuttingDrillView({ ...general, metric_defs: null }).metricDefs).toEqual([]);
    expect(toPuttingDrillView({ ...general, metric_defs: [] }).metricDefs).toEqual([]);
  });
});
