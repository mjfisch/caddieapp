// Practice form-field registry (Mission 3) — single source of truth for the
// per-type SCALAR fields of the session logger. Each FieldDef drives all four
// call sites in practice/page.tsx that previously duplicated the field list by
// hand: initial state, field JSX, saveSession() body assembly, and resetForm()
// clearing. Adding/removing a field for a session type is now one registry edit.
//
// Bespoke widgets stay hand-written in page.tsx on purpose: the date/duration
// grid, star rating, focus-area chips, type picker, and trackman import block
// are either universal (not per-type) or interaction patterns richer than
// "label + one input → one payload slot", which is all the registry models.
//
// Pure data + pure functions — no React, no I/O — so tests/form-fields.test.ts
// can assert the exact POST body per type in the node test harness.

export const SESSION_TYPE_IDS = ["trackman", "grass_range", "short_game", "net", "putting"] as const;
export type SessionTypeId = (typeof SESSION_TYPE_IDS)[number];

/** Top-level practice_session columns a field can write into. */
type ColumnKey = "location" | "surface" | "ball";

/** How a scalar (string-valued) field lands in the POST body. */
export type ScalarPayload =
  /** Trimmed value into a top-level column; empty → null. */
  | { to: "column"; column: ColumnKey }
  /** Rendered line prepended above the free-text recap (null = contribute nothing). */
  | { to: "recapPrefix"; prefix: (raw: string) => string | null }
  /** Select value → auto-added focus-area tag (Set semantics, so no duplicates). */
  | { to: "focusTag"; tagByValue: Record<string, string> }
  /** Numeric string → { kind, value } metric when non-blank and finite. */
  | { to: "metric"; metric: string };

/** A readonly field contributes a fixed column value (e.g. grass range → surface "grass"). */
export type ConstantPayload = { to: "constantColumn"; column: ColumnKey; value: string };

/** A chips field's selection folds into the recap prefix (null = contribute nothing). */
export type ChipsPayload = { to: "recapPrefix"; prefix: (selected: string[]) => string | null };

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
export type FieldDef =
  | (FieldBase & { kind: "text"; id: string; placeholder: string; defaultValue: string; payload: ScalarPayload })
  | (FieldBase & { kind: "number"; id: string; placeholder: string; defaultValue: string; payload: ScalarPayload })
  | (FieldBase & {
      kind: "select";
      id: string;
      options: { value: string; label: string }[];
      defaultValue: string;
      payload: ScalarPayload;
    })
  | (FieldBase & { kind: "readonly"; displayValue: string; payload: ConstantPayload })
  | (FieldBase & { kind: "chips"; options: string[]; defaultValue: string[]; payload: ChipsPayload });

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
  short_game: [
    {
      kind: "select",
      key: "sgArea",
      id: "pr-sga",
      label: "Area",
      defaultValue: "putting_green",
      layout: "standalone",
      options: [
        { value: "putting_green", label: "Putting green" },
        { value: "chipping", label: "Chipping" },
        { value: "pitching", label: "Pitching" },
        { value: "bunker", label: "Bunker" },
      ],
      payload: {
        to: "focusTag",
        tagByValue: {
          putting_green: "lag_putting",
          chipping: "chipping",
          pitching: "pitching",
          bunker: "bunker",
        },
      },
    },
    {
      kind: "number",
      key: "lagIn3ft",
      id: "pr-lag",
      label: "Lag: in 3 ft (%)",
      placeholder: "70",
      defaultValue: "",
      layout: "grid",
      payload: { to: "metric", metric: "lag_in_3ft" },
    },
    {
      kind: "number",
      key: "upDown",
      id: "pr-ud",
      label: "Up & down (%)",
      placeholder: "50",
      defaultValue: "",
      layout: "grid",
      payload: { to: "metric", metric: "up_and_down" },
    },
  ],
  net: [
    {
      kind: "chips",
      key: "clubsWorked",
      label: "Clubs worked",
      options: ["Driver", "7i", "8i", "PW", "Wedges"],
      defaultValue: [],
      layout: "standalone",
      payload: { to: "recapPrefix", prefix: (clubs) => (clubs.length ? `Clubs: ${clubs.join(", ")}.` : null) },
    },
    {
      kind: "number",
      key: "reps",
      id: "pr-reps",
      label: "Reps",
      placeholder: "40",
      defaultValue: "",
      layout: "grid",
      payload: { to: "metric", metric: "reps" },
    },
    {
      kind: "text",
      key: "swingThought",
      id: "pr-st",
      label: "Swing thought",
      placeholder: "Shallower takeaway",
      defaultValue: "",
      layout: "grid",
      payload: { to: "recapPrefix", prefix: (raw) => (raw.trim() ? `Swing thought: ${raw.trim()}.` : null) },
    },
  ],
  // Putting has NO scalar registry fields: its structure is the ordered drill-block
  // list, a bespoke widget (like rating/chips), assembled separately below (§4d,
  // Mission 4). Shared fields (date/duration/rating/recap) stay universal.
  putting: [],
};

// ── State ──────────────────────────────────────────────────────────────────────

export type FieldValue = string | string[];
/** One state object for ALL types' fields (keys stay unique registry-wide). */
export type FieldValues = Record<string, FieldValue>;

/** Default values for every stateful field across all types — the initial (and reset) form state. */
export function initialFieldValues(): FieldValues {
  const values: FieldValues = {};
  for (const defs of Object.values(FORM_FIELDS)) {
    for (const def of defs) {
      if (def.kind === "readonly") continue; // no state — fixed display + constant payload
      values[def.key] = def.kind === "chips" ? [...def.defaultValue] : def.defaultValue;
    }
  }
  return values;
}

export function scalarValue(fields: FieldValues, key: string): string {
  const v = fields[key];
  return typeof v === "string" ? v : "";
}

export function listValue(fields: FieldValues, key: string): string[] {
  const v = fields[key];
  return Array.isArray(v) ? v : [];
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
  focusAreas: string[];
  metrics: { kind: string; value: number }[];
  /** Ordered drill blocks — present for putting sessions only. */
  drillBlocks?: DrillBlockPayload[];
};

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
  focus: ReadonlySet<string>;
  fields: FieldValues;
  /** Putting drill blocks (ignored for other types). */
  blocks?: DrillBlockDraft[];
}): SaveSessionBody {
  const { type, fields } = input;
  const focusAreas = new Set(input.focus);
  const metrics: { kind: string; value: number }[] = [];
  const columns: Record<ColumnKey, string | null> = { location: null, surface: null, ball: null };
  const recapParts: string[] = [];

  for (const def of FORM_FIELDS[type]) {
    if (def.kind === "readonly") {
      columns[def.payload.column] = def.payload.value;
      continue;
    }
    if (def.kind === "chips") {
      const part = def.payload.prefix(listValue(fields, def.key));
      if (part) recapParts.push(part);
      continue;
    }
    const p = def.payload;
    const raw = scalarValue(fields, def.key);
    if (p.to === "column") {
      columns[p.column] = raw.trim() || null;
    } else if (p.to === "recapPrefix") {
      const part = p.prefix(raw);
      if (part) recapParts.push(part);
    } else if (p.to === "focusTag") {
      const tag = p.tagByValue[raw];
      if (tag) focusAreas.add(tag);
    } else if (p.to === "metric") {
      if (raw.trim() && Number.isFinite(Number(raw))) metrics.push({ kind: p.metric, value: Number(raw) });
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
    focusAreas: [...focusAreas],
    metrics,
  };

  // Putting alone carries drill blocks (the bespoke widget). Other types never
  // get the `drillBlocks` key, so their wire body is byte-for-byte unchanged.
  if (type === "putting") {
    body.drillBlocks = buildDrillBlocks(input.blocks ?? []);
  }

  return body;
}
