import { describe, it, expect } from "vitest";
import {
  FORM_FIELDS,
  buildSaveBody,
  initialFieldValues,
  type FieldValues,
  type DrillBlockDraft,
  type ClubRosterEntry,
  type SessionClubDrafts,
} from "../apps/web/src/app/practice/formFields";

// =============================================================
// Mission 3 — data-driven form-field registry (behavior-preserving refactor).
//
// The expected bodies below were transcribed from saveSession() in
// apps/web/src/app/practice/page.tsx AS IT STOOD BEFORE the refactor
// (commit 2a468a3, lines 298–352) — they are the spec. buildSaveBody()
// must reproduce them exactly: same keys, same nesting.
//
// Mission 7 update: 'short_game' and 'net' (Spornia) are retired from the
// registry — their payload specs are gone with their forms. The Focus Areas
// chips and metric inputs are retired app-wide, so focusAreas/metrics are
// pinned to [] for every type (the keys stay for wire-shape stability;
// practice_focus/practice_metric are frozen, written by nothing).
// Pure module — no DB, no React, runs in the node harness unconditionally.
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
  it("covers exactly the four offered session types (short_game and net retired, Mission 7)", () => {
    expect(Object.keys(FORM_FIELDS).sort()).toEqual([
      "around_green",
      "grass_range",
      "putting",
      "trackman",
    ]);
  });

  it("putting has no scalar registry fields (its structure is the bespoke block list)", () => {
    expect(FORM_FIELDS.putting).toEqual([]);
  });

  it("around_green has no scalar registry fields — and NO metric inputs at all (§4c)", () => {
    expect(FORM_FIELDS.around_green).toEqual([]);
  });

  it("field keys are unique across the whole registry (they share one state object)", () => {
    const keys = Object.values(FORM_FIELDS).flat().map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("initialFieldValues covers exactly the surviving types' fields", () => {
    expect(initialFieldValues()).toEqual({
      facility: "",
      surface: "",
      ball: "",
      location: "",
      conditions: "",
    });
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
      focusAreas: [],
      metrics: [],
      clubs: [],
    });
    expect(Object.keys(body)).toEqual([...BODY_KEYS, "clubs"]);
  });

  it("all-blank form → all-null optionals, empty arrays", () => {
    const body = buildSaveBody({
      type: "trackman",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
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
      clubs: [],
    });
    expect(Object.keys(body)).toEqual([...BODY_KEYS, "clubs"]);
  });

  it("non-numeric duration → null", () => {
    const body = buildSaveBody({
      type: "trackman",
      date: "2026-07-09",
      durationMin: "abc",
      rating: 0,
      recap: "",
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
      clubs: [],
    });
    expect(Object.keys(body)).toEqual([...BODY_KEYS, "clubs"]);
  });

  it("no conditions and no recap → recap_md null; surface still 'grass'", () => {
    const body = buildSaveBody({
      type: "grass_range",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
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
      fields: fields({ conditions: "Calm" }),
    });
    expect(body.recap_md).toBe("Conditions: Calm");
  });
});

describe("putting payload (drill blocks — Mission 4)", () => {
  const gate: DrillBlockDraft = {
    uid: "b1",
    drillId: "gate-uuid",
    drillTitle: "Gate Drill (MJF variant)",
    metricDefs: [{ id: "resets-uuid", label: "Resets", unit: null, valueType: "integer" }],
    values: { "resets-uuid": "2" },
    note: "",
  };
  const general: DrillBlockDraft = {
    uid: "b2",
    drillId: "general-uuid",
    drillTitle: "General",
    metricDefs: [],
    values: {},
    note: "  30–60 ft, came up short  ",
  };

  it("emits ordered blocks; filled metrics only; General is note-only", () => {
    const body = buildSaveBody({
      type: "putting",
      date: "2026-07-08",
      durationMin: "40",
      rating: 4,
      recap: "Putting felt good",
      fields: fields(),
      blocks: [gate, general],
    });
    expect(body).toEqual({
      date: "2026-07-08",
      type: "putting",
      location: null,
      surface: null,
      ball: null,
      duration_min: 40,
      overall_rating: 4,
      recap_md: "Putting felt good",
      focusAreas: [],
      metrics: [],
      drillBlocks: [
        { drillId: "gate-uuid", note: null, values: [{ metricDefId: "resets-uuid", value: 2 }] },
        { drillId: "general-uuid", note: "30–60 ft, came up short", values: [] },
      ],
    });
    // Block order is exactly the list order, and drillBlocks is the one extra key.
    expect(Object.keys(body)).toEqual([...BODY_KEYS, "drillBlocks"]);
    expect(body.drillBlocks!.map((b) => b.drillId)).toEqual(["gate-uuid", "general-uuid"]);
  });

  it("reordering the drafts reorders the wire blocks (position = list order)", () => {
    const body = buildSaveBody({
      type: "putting",
      date: "2026-07-08",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
      blocks: [general, gate],
    });
    expect(body.drillBlocks!.map((b) => b.drillId)).toEqual(["general-uuid", "gate-uuid"]);
  });

  it("drops blank/non-numeric metric values but keeps the (empty) block", () => {
    const lag: DrillBlockDraft = {
      uid: "b1",
      drillId: "lag-uuid",
      drillTitle: "Lag Ladder",
      metricDefs: [
        { id: "dist", label: "Distance", unit: "ft", valueType: "integer" },
        { id: "balls", label: "Balls", unit: null, valueType: "integer" },
      ],
      values: { dist: "", balls: "abc" },
      note: "",
    };
    const body = buildSaveBody({
      type: "putting",
      date: "2026-07-08",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
      blocks: [lag],
    });
    expect(body.drillBlocks).toEqual([{ drillId: "lag-uuid", note: null, values: [] }]);
  });

  it("no blocks → an empty drillBlocks array (key still present for putting)", () => {
    const body = buildSaveBody({
      type: "putting",
      date: "2026-07-08",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
    });
    expect(body.drillBlocks).toEqual([]);
  });
});

describe("clubs used payload (Mission 5 — range forms)", () => {
  // Bag order: driver, 3h, 5h, 4i, 6i, 7i, 8i, 9i, PW, GW50, SW54, LW60, LW64.
  // Only a slice is needed for these fixtures.
  const roster: ClubRosterEntry[] = [
    { name: "driver", sortOrder: 0, aroundGreenEligible: false },
    { name: "3h", sortOrder: 1, aroundGreenEligible: false },
    { name: "7i", sortOrder: 5, aroundGreenEligible: true },
    { name: "PW", sortOrder: 8, aroundGreenEligible: true },
  ];

  it("trackman: two tagged clubs (one shape+note, one bare) — exact wire body", () => {
    const clubDrafts: SessionClubDrafts = {
      driver: { shotShape: "fade", note: "  Started it at the left bunker  " },
      "7i": { shotShape: "draw", note: "" },
    };
    const body = buildSaveBody({
      type: "trackman",
      date: "2026-07-09",
      durationMin: "45",
      rating: 4,
      recap: "Good session",
      fields: fields({ facility: "Oak Brook GC" }),
      clubRoster: roster,
      clubDrafts,
    });
    expect(body).toEqual({
      date: "2026-07-09",
      type: "trackman",
      location: "Oak Brook GC",
      surface: null,
      ball: null,
      duration_min: 45,
      overall_rating: 4,
      recap_md: "Good session",
      focusAreas: [],
      metrics: [],
      clubs: [
        { club: "driver", shotShape: "fade", note: "Started it at the left bunker" },
        { club: "7i", shotShape: "draw", note: null },
      ],
    });
    // clubs is the one extra key, appended after the shared body — same pattern as drillBlocks.
    expect(Object.keys(body)).toEqual([...BODY_KEYS, "clubs"]);
  });

  it("trackman: clubs render in bag order regardless of tag order", () => {
    const clubDrafts: SessionClubDrafts = {
      PW: { shotShape: "", note: "" },
      driver: { shotShape: "", note: "" },
      "3h": { shotShape: "", note: "" },
    };
    const body = buildSaveBody({
      type: "trackman",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
      clubRoster: roster,
      clubDrafts,
    });
    expect(body.clubs!.map((c) => c.club)).toEqual(["driver", "3h", "PW"]);
  });

  it("grass_range: a bare tagged club (no shape, no note) still saves as a row", () => {
    const body = buildSaveBody({
      type: "grass_range",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
      clubRoster: roster,
      clubDrafts: { "7i": { shotShape: "", note: "" } },
    });
    expect(body.clubs).toEqual([{ club: "7i", shotShape: null, note: null }]);
  });

  it("no clubs tagged → an empty clubs array (key still present for trackman/grass_range)", () => {
    const body = buildSaveBody({
      type: "trackman",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
    });
    expect(body.clubs).toEqual([]);
  });

  it("putting never gets a clubs key", () => {
    const putting = buildSaveBody({
      type: "putting",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
    });
    expect(putting.clubs).toBeUndefined();
  });
});

describe("around_green payload (Mission 6 — §4c)", () => {
  // Bag slice spanning both sides of the eligibility line (7i–LW64 are eligible).
  const roster: ClubRosterEntry[] = [
    { name: "driver", sortOrder: 0, aroundGreenEligible: false },
    { name: "7i", sortOrder: 5, aroundGreenEligible: true },
    { name: "SW54", sortOrder: 10, aroundGreenEligible: true },
    { name: "LW64", sortOrder: 12, aroundGreenEligible: true },
  ];

  it("2 lie types, 2 shot types, two clubs (one with note) — the exact wire body", () => {
    const clubDrafts: SessionClubDrafts = {
      LW64: { shotShape: "", note: "  Opened the face on the flops  " },
      SW54: { shotShape: "", note: "" },
    };
    const body = buildSaveBody({
      type: "around_green",
      date: "2026-07-10",
      durationMin: "40",
      rating: 4,
      recap: "Tight lies clicked",
      fields: fields(),
      lieTypes: ["tight", "short rough"],
      shotTypes: ["chipping", "flops"],
      clubRoster: roster,
      clubDrafts,
    });
    expect(body).toEqual({
      date: "2026-07-10",
      type: "around_green",
      location: null,
      surface: null,
      ball: null,
      duration_min: 40,
      overall_rating: 4,
      recap_md: "Tight lies clicked",
      focusAreas: [],
      metrics: [],
      lie_types: ["tight", "short rough"],
      shot_types: ["chipping", "flops"],
      clubs: [
        { club: "SW54", note: null },
        { club: "LW64", note: "Opened the face on the flops" },
      ],
    });
    expect(Object.keys(body)).toEqual([...BODY_KEYS, "lie_types", "shot_types", "clubs"]);
    // NO shot_shape key on any club row (shape is a full-swing concept, §4c) …
    for (const c of body.clubs!) {
      expect(Object.keys(c)).toEqual(["club", "note"]);
    }
    // … and NO focus areas, ever.
    expect(body.focusAreas).toEqual([]);
  });

  it("a drafted shot shape never leaks — the club row still has no shotShape key", () => {
    // A club tagged with a shape on the trackman form, then a type switch to
    // around_green: the shape is silently dropped, not serialized.
    const body = buildSaveBody({
      type: "around_green",
      date: "2026-07-10",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
      clubRoster: roster,
      clubDrafts: { "7i": { shotShape: "draw", note: "" } },
    });
    expect(body.clubs).toEqual([{ club: "7i", note: null }]);
    expect(Object.keys(body.clubs![0]!)).toEqual(["club", "note"]);
  });

  it("an ineligible club draft (driver) is filtered out of the payload", () => {
    const body = buildSaveBody({
      type: "around_green",
      date: "2026-07-10",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
      clubRoster: roster,
      clubDrafts: {
        driver: { shotShape: "fade", note: "range leftover" },
        SW54: { shotShape: "", note: "" },
      },
    });
    expect(body.clubs).toEqual([{ club: "SW54", note: null }]);
  });

  it("tag arrays normalize to row order and drop unknown values", () => {
    const body = buildSaveBody({
      type: "around_green",
      date: "2026-07-10",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
      lieTypes: ["bunker", "tight", "not-a-lie"],
      shotTypes: ["flops", "chipping"],
    });
    expect(body.lie_types).toEqual(["tight", "bunker"]);
    expect(body.shot_types).toEqual(["chipping", "flops"]);
  });

  it("empty selections → empty arrays (keys still present for around_green)", () => {
    const body = buildSaveBody({
      type: "around_green",
      date: "2026-07-10",
      durationMin: "",
      rating: 0,
      recap: "",
      fields: fields(),
    });
    expect(body.lie_types).toEqual([]);
    expect(body.shot_types).toEqual([]);
    expect(body.clubs).toEqual([]);
    expect(Object.keys(body)).toEqual([...BODY_KEYS, "lie_types", "shot_types", "clubs"]);
  });

  it("no other type ever gets lie_types/shot_types keys", () => {
    for (const type of ["trackman", "grass_range", "putting"] as const) {
      const body = buildSaveBody({
        type,
        date: "2026-07-10",
        durationMin: "",
        rating: 0,
        recap: "",
        fields: fields(),
        lieTypes: ["tight"],
        shotTypes: ["flops"],
      });
      expect(body.lie_types, `${type} should not emit lie_types`).toBeUndefined();
      expect(body.shot_types, `${type} should not emit shot_types`).toBeUndefined();
      expect("lie_types" in body, `${type} should not have a lie_types key`).toBe(false);
      expect("shot_types" in body, `${type} should not have a shot_types key`).toBe(false);
    }
  });
});

describe("Focus Areas + metrics retirement (Mission 7 — practice_focus/practice_metric frozen)", () => {
  it("every type emits focusAreas: [] and metrics: [] — nothing writes the frozen tables", () => {
    for (const type of ["trackman", "grass_range", "around_green", "putting"] as const) {
      const body = buildSaveBody({
        type,
        date: "2026-07-09",
        durationMin: "",
        rating: 0,
        recap: "",
        fields: fields(),
      });
      expect(body.focusAreas, `${type} should never emit focus tags`).toEqual([]);
      expect(body.metrics, `${type} should never emit metrics`).toEqual([]);
    }
  });
});
