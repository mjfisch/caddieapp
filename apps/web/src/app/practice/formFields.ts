// Practice form-field registry (Mission 3) — single source of truth for the
// per-type SCALAR fields of the session logger. Each FieldDef drives all four
// call sites in practice/page.tsx that previously duplicated the field list by
// hand: initial state, field JSX, saveSession() body assembly, and resetForm()
// clearing. Adding/removing a field for a session type is now one registry edit.
//
// Bespoke widgets stay hand-written in page.tsx on purpose: the date/duration
// grid, star rating, type picker, and trackman import block are either
// universal (not per-type) or interaction patterns richer than
// "label + one input → one payload slot", which is all the registry models.
//
// Pure data + pure functions — no React, no I/O — so tests/form-fields.test.ts
// can assert the exact POST body per type in the node test harness.

// Mission 7: 'short_game' and 'net' retired — no longer selectable or loggable.
// Legacy rows of both types still render in history via TYPE_LABEL (page.tsx).
export const SESSION_TYPE_IDS = [
  "trackman",
  "grass_range",
  "around_green",
  "putting",
] as const;
export type SessionTypeId = (typeof SESSION_TYPE_IDS)[number];

/** Top-level practice_session columns a field can write into. */
type ColumnKey = "location" | "surface" | "ball";

/** How a scalar (string-valued) field lands in the POST body. */
export type ScalarPayload =
  /** Trimmed value into a top-level column; empty → null. */
  | { to: "column"; column: ColumnKey }
  /** Rendered line prepended above the free-text recap (null = contribute nothing). */
  | { to: "recapPrefix"; prefix: (raw: string) => string | null };

/** A readonly field contributes a fixed column value (e.g. grass range → surface "grass"). */
export type ConstantPayload = { to: "constantColumn"; column: ColumnKey; value: string };

type FieldBase = {
  /** Unique across the WHOLE registry — all fields share one state object. */
  key: string;
  label: string;
  /**
   * "grid": rendered inside a shared two-column .pr-grid with adjacent grid
   * fields. "standalone": its own full-width .pr-field block.
   */
  layout: "grid" | "standalone";
  /** Inside a grid, span both columns (className "full"). */
  gridFull?: boolean;
};

// New input kinds (textarea, date, …) are added here deliberately, with their
// own render + payload handling — not by loosening an existing variant.
// (Mission 7 retired the "select", "number", and "chips" kinds along with the
// focusTag/metric payloads — all were short_game/net-only. Re-add deliberately.)
export type FieldDef =
  | (FieldBase & { kind: "text"; id: string; placeholder: string; defaultValue: string; payload: ScalarPayload })
  | (FieldBase & { kind: "readonly"; displayValue: string; payload: ConstantPayload });

export const FORM_FIELDS: Record<SessionTypeId, FieldDef[]> = {
  trackman: [
    {
      kind: "text",
      key: "facility",
      id: "pr-fac",
      label: "Facility",
      placeholder: "Oak Brook GC",
      defaultValue: "",
      layout: "grid",
      payload: { to: "column", column: "location" },
    },
    {
      kind: "text",
      key: "surface",
      id: "pr-surf",
      label: "Surface",
      placeholder: "Mat",
      defaultValue: "",
      layout: "grid",
      payload: { to: "column", column: "surface" },
    },
    {
      kind: "text",
      key: "ball",
      id: "pr-ball",
      label: "Ball",
      placeholder: "Range",
      defaultValue: "",
      layout: "grid",
      gridFull: true,
      payload: { to: "column", column: "ball" },
    },
  ],
  grass_range: [
    {
      kind: "text",
      key: "location",
      id: "pr-loc",
      label: "Location",
      placeholder: "Range name",
      defaultValue: "",
      layout: "grid",
      payload: { to: "column", column: "location" },
    },
    {
      kind: "readonly",
      key: "surfaceGrass",
      label: "Surface",
      displayValue: "Grass",
      layout: "grid",
      payload: { to: "constantColumn", column: "surface", value: "grass" },
    },
    {
      kind: "text",
      key: "conditions",
      id: "pr-cond",
      label: "Wind / conditions",
      placeholder: "Calm, into off the right",
      defaultValue: "",
      layout: "grid",
      gridFull: true,
      payload: { to: "recapPrefix", prefix: (raw) => (raw.trim() ? `Conditions: ${raw.trim()}` : null) },
    },
  ],
  // Around the Green has NO scalar registry fields (§4c): shared fields plus three
  // bespoke chip rows (clubs used, lie types, shot types) — and deliberately NO
  // metric inputs (no Area dropdown, no percentage fields; measurement-structure
  // is banned by spec principle 2). Assembled separately below (Mission 6).
  around_green: [],
  // Putting has NO scalar registry fields: its structure is the ordered drill-block
  // list, a bespoke widget (like rating/chips), assembled separately below (§4d,
  // Mission 4). Shared fields (date/duration/rating/recap) stay universal.
  putting: [],
};

// ── State ──────────────────────────────────────────────────────────────────────

/** One state object for ALL types' fields (keys stay unique registry-wide). */
export type FieldValues = Record<string, string>;

/** Default values for every stateful field across all types — the initial (and reset) form state. */
export function initialFieldValues(): FieldValues {
  const values: FieldValues = {};
  for (const defs of Object.values(FORM_FIELDS)) {
    for (const def of defs) {
      if (def.kind === "readonly") continue; // no state — fixed display + constant payload
      values[def.key] = def.defaultValue;
    }
  }
  return values;
}

export function scalarValue(fields: FieldValues, key: string): string {
  return fields[key] ?? "";
}

// ── Drill blocks (Putting — bespoke widget, not a FieldDef) ─────────────────────

/** A drill's metric definition, as delivered by GET /api/practice/drills. */
export type DrillMetricDef = {
  id: string;
  label: string;
  unit: string | null;
  valueType: string;
};

/** A putting drill in the block picker. General is the is_system, metric-less one. */
export type PuttingDrill = {
  id: string;
  title: string;
  area: string;
  isSystem: boolean;
  sortOrder: number | null;
  metricDefs: DrillMetricDef[];
};

/**
 * One drill block being edited in the Putting form. `uid` is a client-only stable
 * React key (the same drill may be added more than once). `values` maps a metric
 * def id → its raw input string; blank/non-numeric entries are dropped on save.
 */
export type DrillBlockDraft = {
  uid: string;
  drillId: string;
  drillTitle: string;
  metricDefs: DrillMetricDef[];
  values: Record<string, string>;
  note: string;
};

/** The wire shape of a block: position is the array index, so it isn't sent. */
export type DrillBlockPayload = {
  drillId: string;
  note: string | null;
  values: { metricDefId: string; value: number }[];
};

/**
 * Fold the block drafts into their wire payload, preserving list order (= block
 * position). Only filled, finite metric values survive; an empty block (no note,
 * no metrics) still emits a payload so it records "I did this drill" (§4d).
 */
export function buildDrillBlocks(blocks: DrillBlockDraft[]): DrillBlockPayload[] {
  return blocks.map((b) => ({
    drillId: b.drillId,
    note: b.note.trim() ? b.note.trim() : null,
    values: b.metricDefs
      .map((def) => ({ metricDefId: def.id, raw: b.values[def.id] ?? "" }))
      .filter((x) => x.raw.trim() !== "" && Number.isFinite(Number(x.raw)))
      .map((x) => ({ metricDefId: x.metricDefId, value: Number(x.raw) })),
  }));
}

// ── Clubs Used (Trackman + Grass Range — bespoke widget, not a FieldDef) ───────
// The tag-then-expand pattern from Mission 4's drill blocks, applied to the fixed
// bag roster instead of an ordered list: tap a chip to toggle a club on/off; a
// selected chip gains an expand affordance for its optional shot shape + note.

/** Primary shot shape (§4a/§4b) — single-select, one per club per session, optional. */
export const SHOT_SHAPES = ["straight", "draw", "pull", "hook", "fade", "push", "slice"] as const;
export type ShotShape = (typeof SHOT_SHAPES)[number];

/** One active bag club, as delivered by GET /api/practice/clubs, in bag order. */
export type ClubRosterEntry = {
  name: string;
  sortOrder: number | null;
  aroundGreenEligible: boolean;
};

/** A selected club's collapsed-by-default detail (shot shape + note), keyed by club name. */
export type SessionClubDraft = {
  shotShape: string;
  note: string;
};

/** Selected clubs for the session, keyed by club name (bag order comes from the roster, not this map). */
export type SessionClubDrafts = Record<string, SessionClubDraft>;

/** The wire shape of one tagged club. */
export type SessionClubPayload = {
  club: string;
  shotShape: string | null;
  note: string | null;
};

/**
 * Fold the selected-clubs map into its wire payload, in bag-roster order (not
 * selection order) — the Recent Sessions clubs line and the payload both read
 * in bag order. A selected club with no shape/note still emits a bare row.
 */
export function buildSessionClubs(roster: ClubRosterEntry[], selected: SessionClubDrafts): SessionClubPayload[] {
  return roster
    .filter((c) => Object.prototype.hasOwnProperty.call(selected, c.name))
    .map((c) => {
      const d = selected[c.name]!;
      return {
        club: c.name,
        shotShape: d.shotShape ? d.shotShape : null,
        note: d.note.trim() ? d.note.trim() : null,
      };
    });
}

// ── Around the Green (§4c — bespoke chip rows, not FieldDefs) ──────────────────
// Same tag-then-expand clubs chip row as the range forms, with two differences:
// the roster is filtered to around_green_eligible clubs (7i through LW64), and
// the per-club expand is the NOTE ONLY — shot shape is a full-swing concept and
// never appears on (or leaks into) this form's payload.

/** Lie tags (§4c). "bunker" here is the sand LIE. */
export const LIE_TYPES = ["tight", "short rough", "deep rough", "bunker"] as const;
/** Shot tags (§4c). "bunker" here is the explosion SHOT — a different axis than the lie. */
export const SHOT_TYPES = ["chipping", "pitching", "flops", "bunker"] as const;

/** The wire shape of one around-green tagged club — deliberately NO shotShape key (§4c). */
export type AroundGreenClubPayload = {
  club: string;
  note: string | null;
};

/**
 * Fold the selected-clubs map into the around-green wire payload: eligible clubs
 * only (a stale draft tagged on a range form must not leak through a type
 * switch), in bag order, note-only — any drafted shot shape is dropped with the
 * ineligible clubs.
 */
export function buildAroundGreenClubs(
  roster: ClubRosterEntry[],
  selected: SessionClubDrafts,
): AroundGreenClubPayload[] {
  return roster
    .filter((c) => c.aroundGreenEligible && Object.prototype.hasOwnProperty.call(selected, c.name))
    .map((c) => {
      const note = selected[c.name]!.note.trim();
      return { club: c.name, note: note || null };
    });
}

/**
 * Normalize a chip selection to the canonical option order (and drop anything
 * that isn't an option) — the wire arrays and the Recent Sessions line both
 * read in row order regardless of tap order.
 */
function canonicalTags(options: readonly string[], selected: string[]): string[] {
  return options.filter((o) => selected.includes(o));
}

// ── Save-payload assembly ──────────────────────────────────────────────────────

export type SaveSessionBody = {
  date: string;
  type: SessionTypeId;
  location: string | null;
  surface: string | null;
  ball: string | null;
  duration_min: number | null;
  overall_rating: number | null;
  recap_md: string | null;
  /** Always [] since Mission 7 — the Focus Areas chips and metric inputs are
   * retired (practice_focus/practice_metric frozen). The keys stay so the wire
   * body's shared shape is unchanged for the four surviving types. */
  focusAreas: string[];
  metrics: { kind: string; value: number }[];
  /** Lie tags — present for around_green sessions only (§4c). */
  lie_types?: string[];
  /** Shot tags — present for around_green sessions only (§4c). */
  shot_types?: string[];
  /** Ordered drill blocks — present for putting sessions only. */
  drillBlocks?: DrillBlockPayload[];
  /** Clubs Used — trackman/grass_range carry shape+note rows; around_green carries note-only rows. */
  clubs?: SessionClubPayload[] | AroundGreenClubPayload[];
};

/** Session types whose form shows the Clubs Used chip row. */
const CLUBS_USED_TYPES: ReadonlySet<SessionTypeId> = new Set(["trackman", "grass_range"]);

/**
 * Assemble the POST /api/practice/sessions body from universal inputs plus the
 * registry-driven field values. Must stay byte-for-byte compatible with the
 * pre-registry saveSession() — tests/form-fields.test.ts pins that shape.
 */
export function buildSaveBody(input: {
  type: SessionTypeId;
  date: string;
  durationMin: string;
  rating: number;
  recap: string;
  fields: FieldValues;
  /** Putting drill blocks (ignored for other types). */
  blocks?: DrillBlockDraft[];
  /** Clubs Used — the full active roster (for bag-order output) plus the current selections. Ignored for types that don't show the chip row. */
  clubRoster?: ClubRosterEntry[];
  clubDrafts?: SessionClubDrafts;
  /** Around the Green lie/shot tags (ignored for other types). */
  lieTypes?: string[];
  shotTypes?: string[];
}): SaveSessionBody {
  const { type, fields } = input;
  const columns: Record<ColumnKey, string | null> = { location: null, surface: null, ball: null };
  const recapParts: string[] = [];

  for (const def of FORM_FIELDS[type]) {
    if (def.kind === "readonly") {
      columns[def.payload.column] = def.payload.value;
      continue;
    }
    const p = def.payload;
    const raw = scalarValue(fields, def.key);
    if (p.to === "column") {
      columns[p.column] = raw.trim() || null;
    } else {
      const part = p.prefix(raw);
      if (part) recapParts.push(part);
    }
  }

  // Prefix parts join into one line ("Clubs: … Swing thought: …"), then sit
  // above the free-text recap — matching the hand-written assembly this replaced.
  const recapText = [recapParts.join(" "), input.recap.trim()].filter(Boolean).join("\n").trim();

  const body: SaveSessionBody = {
    date: input.date,
    type,
    location: columns.location,
    surface: columns.surface,
    ball: columns.ball,
    duration_min:
      input.durationMin.trim() && Number.isFinite(Number(input.durationMin)) ? Number(input.durationMin) : null,
    overall_rating: input.rating > 0 ? input.rating : null,
    recap_md: recapText || null,
    focusAreas: [],
    metrics: [],
  };

  // Putting alone carries drill blocks (the bespoke widget). Other types never
  // get the `drillBlocks` key, so their wire body is byte-for-byte unchanged.
  if (type === "putting") {
    body.drillBlocks = buildDrillBlocks(input.blocks ?? []);
  }

  // Trackman/Grass Range alone carry Clubs Used (the bespoke widget). Other
  // types never get the `clubs` key, so their wire body is byte-for-byte unchanged.
  if (CLUBS_USED_TYPES.has(type)) {
    body.clubs = buildSessionClubs(input.clubRoster ?? [], input.clubDrafts ?? {});
  }

  // Around the Green alone carries the lie/shot tag arrays plus its note-only
  // clubs rows (§4c). Empty selections still send empty arrays — a valid "none
  // tagged". No metric keys, no focus tags, no shot shapes ever appear here.
  if (type === "around_green") {
    body.lie_types = canonicalTags(LIE_TYPES, input.lieTypes ?? []);
    body.shot_types = canonicalTags(SHOT_TYPES, input.shotTypes ?? []);
    body.clubs = buildAroundGreenClubs(input.clubRoster ?? [], input.clubDrafts ?? {});
  }

  return body;
}
