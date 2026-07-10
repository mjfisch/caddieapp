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
  it("covers exactly the current session types (around_green added, none removed)", () => {
    expect(Object.keys(FORM_FIELDS).sort()).toEqual([
      "around_green",
      "grass_range",
      "net",
      "putting",
      "short_game",
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
      // A stale/deep-linked focus tag must not reach a trackman payload (§4a —
      // Clubs Used replaces Focus Areas for this type).
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
      focus: new Set(),
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
      focus: new Set(),
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
      focus: new Set(),
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
      focus: new Set(),
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
      focus: new Set(),
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
      focus: new Set(),
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
      focus: new Set(),
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
      focus: new Set(),
      fields: fields(),
    });
    expect(body.clubs).toEqual([]);
  });

  it("short_game and putting never get a clubs key", () => {
    const shortGame = buildSaveBody({
      type: "short_game",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      focus: new Set(),
      fields: fields(),
    });
    const putting = buildSaveBody({
      type: "putting",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      focus: new Set(),
      fields: fields(),
    });
    expect(shortGame.clubs).toBeUndefined();
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
      // A stale/deep-linked focus tag must not reach an around_green payload.
      focus: new Set(["chipping"]),
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
      focus: new Set(),
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
      focus: new Set(),
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
      focus: new Set(),
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
      focus: new Set(),
      fields: fields(),
    });
    expect(body.lie_types).toEqual([]);
    expect(body.shot_types).toEqual([]);
    expect(body.clubs).toEqual([]);
    expect(Object.keys(body)).toEqual([...BODY_KEYS, "lie_types", "shot_types", "clubs"]);
  });

  it("no other type ever gets lie_types/shot_types keys", () => {
    for (const type of ["trackman", "grass_range", "short_game", "net", "putting"] as const) {
      const body = buildSaveBody({
        type,
        date: "2026-07-10",
        durationMin: "",
        rating: 0,
        recap: "",
        focus: new Set(),
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

describe("Focus Areas removal from range forms (§4a — Clubs Used replaces Focus Areas)", () => {
  it("trackman/grass_range/around_green/putting: a selected focus tag never reaches the payload", () => {
    for (const type of ["trackman", "grass_range", "around_green", "putting"] as const) {
      const body = buildSaveBody({
        type,
        date: "2026-07-09",
        durationMin: "",
        rating: 0,
        recap: "",
        focus: new Set(["driver", "chipping"]),
        fields: fields(),
      });
      expect(body.focusAreas, `${type} should never emit focus tags`).toEqual([]);
    }
  });

  it("short_game and net still emit a selected focus tag", () => {
    const shortGame = buildSaveBody({
      type: "short_game",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      focus: new Set(["driver"]),
      fields: fields({ sgArea: "putting_green" }),
    });
    const net = buildSaveBody({
      type: "net",
      date: "2026-07-09",
      durationMin: "",
      rating: 0,
      recap: "",
      focus: new Set(["driver"]),
      fields: fields(),
    });
    expect(shortGame.focusAreas).toContain("driver");
    expect(net.focusAreas).toContain("driver");
  });
});
