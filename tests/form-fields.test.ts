import { describe, it, expect } from "vitest";
import {
  FORM_FIELDS,
  buildSaveBody,
  initialFieldValues,
  type FieldValues,
} from "../apps/web/src/app/practice/formFields";

// =============================================================
// Mission 3 — data-driven form-field registry (behavior-preserving refactor).
//
// The expected bodies below were transcribed from saveSession() in
// apps/web/src/app/practice/page.tsx AS IT STOOD BEFORE the refactor
// (commit 2a468a3, lines 298–352) — they are the spec. buildSaveBody()
// must reproduce them exactly: same keys, same nesting, same
// focusAreas/metrics behavior. Pure module — no DB, no React, runs in
// the node harness unconditionally.
// =============================================================

// The exact top-level key set (and order) of the POST /api/practice/sessions body.
const BODY_KEYS = [
  "date",
  "type",
  "location",
  "surface",
  "ball",
  "duration_min",
  "overall_rating",
  "recap_md",
  "focusAreas",
  "metrics",
];

function fields(overrides: FieldValues = {}): FieldValues {
  return { ...initialFieldValues(), ...overrides };
}

describe("registry shape", () => {
  it("covers exactly the four current session types", () => {
    expect(Object.keys(FORM_FIELDS).sort()).toEqual(["grass_range", "net", "short_game", "trackman"]);
  });

  it("field keys are unique across the whole registry (they share one state object)", () => {
    const keys = Object.values(FORM_FIELDS).flat().map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("initialFieldValues matches the pre-refactor useState defaults", () => {
    expect(initialFieldValues()).toEqual({
      facility: "",
      surface: "",
      ball: "",
      location: "",
      conditions: "",
      sgArea: "putting_green",
      lagIn3ft: "",
      upDown: "",
      clubsWorked: [],
      reps: "",
      swingThought: "",
    });
  });

  it("initialFieldValues returns fresh array instances (no shared mutable state)", () => {
    const a = initialFieldValues();
    const b = initialFieldValues();
    expect(a.clubsWorked).not.toBe(b.clubsWorked);
  });
});

describe("trackman payload", () => {
  it("maps facility/surface/ball to trimmed columns, empty → null", () => {
    const body = buildSaveBody({
      type: "trackman",
      date: "2026-07-09",
      durationMin: "45",
      rating: 4,
      recap: "  Solid session  ",
      focus: new Set(["driver"]),
      fields: fields({ facility: " Oak Brook GC ", surface: "Mat", ball: "  " }),
    });
    expect(body).toEqual({
      date: "2026-07-09",
      type: "trackman",
      location: "Oak Brook GC",
      surface: "Mat",
      ball: null,
      duration_min: 45,
      overall_rating: 4,
      recap_md: "Solid session",
      focusAreas: ["driver"],
      metrics: [],
    });
    expect(Object.keys(body)).toEqual(BODY_KEYS);
  });

  it("all-blank form → all-null optionals, empty arrays", () => {
    const body = buildSaveBody({
      type: "trackman",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      focus: new Set(),
      fields: fields(),
    });
    expect(body).toEqual({
      date: "2026-07-09",
      type: "trackman",
      location: null,
      surface: null,
      ball: null,
      duration_min: null,
      overall_rating: null,
      recap_md: null,
      focusAreas: [],
      metrics: [],
    });
    expect(Object.keys(body)).toEqual(BODY_KEYS);
  });

  it("non-numeric duration → null", () => {
    const body = buildSaveBody({
      type: "trackman",
      date: "2026-07-09",
      durationMin: "abc",
      rating: 0,
      recap: "",
      focus: new Set(),
      fields: fields(),
    });
    expect(body.duration_min).toBeNull();
  });
});

describe("grass_range payload", () => {
  it("location column, surface locked to 'grass', conditions prepended to recap", () => {
    const body = buildSaveBody({
      type: "grass_range",
      date: "2026-07-09",
      durationMin: "90",
      rating: 3,
      recap: "Struck it pure",
      focus: new Set(),
      fields: fields({ location: "Diversey Range", conditions: " Windy off the right " }),
    });
    expect(body).toEqual({
      date: "2026-07-09",
      type: "grass_range",
      location: "Diversey Range",
      surface: "grass",
      ball: null,
      duration_min: 90,
      overall_rating: 3,
      recap_md: "Conditions: Windy off the right\nStruck it pure",
      focusAreas: [],
      metrics: [],
    });
    expect(Object.keys(body)).toEqual(BODY_KEYS);
  });

  it("no conditions and no recap → recap_md null; surface still 'grass'", () => {
    const body = buildSaveBody({
      type: "grass_range",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      focus: new Set(),
      fields: fields(),
    });
    expect(body.surface).toBe("grass");
    expect(body.location).toBeNull();
    expect(body.recap_md).toBeNull();
  });

  it("conditions with empty recap → recap_md is just the conditions line", () => {
    const body = buildSaveBody({
      type: "grass_range",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      focus: new Set(),
      fields: fields({ conditions: "Calm" }),
    });
    expect(body.recap_md).toBe("Conditions: Calm");
  });
});

describe("short_game payload", () => {
  it("area select auto-adds its focus tag; lag/upDown become metrics in order", () => {
    const body = buildSaveBody({
      type: "short_game",
      date: "2026-07-09",
      durationMin: "30",
      rating: 5,
      recap: "Bunker day",
      focus: new Set(["chipping"]),
      fields: fields({ sgArea: "bunker", lagIn3ft: "70", upDown: "50" }),
    });
    expect(body).toEqual({
      date: "2026-07-09",
      type: "short_game",
      location: null,
      surface: null,
      ball: null,
      duration_min: 30,
      overall_rating: 5,
      recap_md: "Bunker day",
      focusAreas: ["chipping", "bunker"],
      metrics: [
        { kind: "lag_in_3ft", value: 70 },
        { kind: "up_and_down", value: 50 },
      ],
    });
    expect(Object.keys(body)).toEqual(BODY_KEYS);
  });

  it("auto-tag does not duplicate an already-selected focus chip", () => {
    const body = buildSaveBody({
      type: "short_game",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      focus: new Set(["lag_putting"]),
      fields: fields({ sgArea: "putting_green" }),
    });
    expect(body.focusAreas).toEqual(["lag_putting"]);
  });

  it("non-numeric or blank metric inputs are skipped", () => {
    const body = buildSaveBody({
      type: "short_game",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      focus: new Set(),
      fields: fields({ sgArea: "chipping", lagIn3ft: "abc", upDown: "" }),
    });
    expect(body.metrics).toEqual([]);
    expect(body.focusAreas).toEqual(["chipping"]);
  });
});

describe("net payload", () => {
  it("clubs + swing thought fold into the recap prefix; reps becomes a metric", () => {
    const body = buildSaveBody({
      type: "net",
      date: "2026-07-09",
      durationMin: "20",
      rating: 2,
      recap: "Felt good",
      focus: new Set(),
      fields: fields({ clubsWorked: ["Driver", "7i"], reps: "40", swingThought: " Shallower takeaway " }),
    });
    expect(body).toEqual({
      date: "2026-07-09",
      type: "net",
      location: null,
      surface: null,
      ball: null,
      duration_min: 20,
      overall_rating: 2,
      recap_md: "Clubs: Driver, 7i. Swing thought: Shallower takeaway.\nFelt good",
      focusAreas: [],
      metrics: [{ kind: "reps", value: 40 }],
    });
    expect(Object.keys(body)).toEqual(BODY_KEYS);
  });

  it("swing thought alone (no clubs) still prefixes the recap", () => {
    const body = buildSaveBody({
      type: "net",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "Maintenance",
      focus: new Set(),
      fields: fields({ swingThought: "Tempo" }),
    });
    expect(body.recap_md).toBe("Swing thought: Tempo.\nMaintenance");
  });

  it("all-blank net form → recap_md null, no metrics", () => {
    const body = buildSaveBody({
      type: "net",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      focus: new Set(),
      fields: fields(),
    });
    expect(body.recap_md).toBeNull();
    expect(body.metrics).toEqual([]);
  });
});
