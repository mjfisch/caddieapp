// @gai/shared — types & constants shared across packages. No runtime deps.

/**
 * Confidence flag — invariant #2. Every club's data quality is one of these,
 * and the caddie's certainty must track it end-to-end into the voice:
 *   measured -> decisive | partial -> hedged | seeded -> named as a placeholder.
 * The visual language reinforces it (Brief section 10):
 *   measured = green (--green) | partial = amber (--amber) | seeded = faint grey (--faint).
 */
export type ConfidenceFlag = "measured" | "partial" | "seeded";

/** Token color for a confidence flag — keeps data model and visual language in lockstep. */
export const CONFIDENCE_COLOR: Record<ConfidenceFlag, string> = {
  measured: "var(--green)",
  partial: "var(--amber)",
  seeded: "var(--faint)",
};

/**
 * The five context layers, in precedence order (README_caddie_context_architecture.md).
 * Layer 1 (accuracy) wins — invariant #5. Index 0 = highest precedence.
 */
export const CONTEXT_LAYERS = [
  "accuracy", // Layer 1 — the numbers from the SG engine. Never overridden.
  "core",     // Layer 2 — core caddie rules
  "profile",  // Layer 3 — player_profile_michael.md
  "persona",  // Layer 4 — voice x risk-config
  "situation",// Layer 5 — the live hole/shot context
] as const;
export type ContextLayer = (typeof CONTEXT_LAYERS)[number];

// ── Club vocabulary ──────────────────────────────────────────────────────────
// One canonical id per club, shared by every layer that reads or writes a club
// name. Without this, the importer's "7 Iron" and the seed's "7i" become two
// rows under club_dispersion's UNIQUE(club) and a club never ratchets seeded ->
// measured — silently breaking invariant #2. Canonical ids match the seed file's
// keys (driver / 3w / 3h / 7i / PW / GW50 …) so seeded and measured rows collide
// on the same key, as intended. Wedge ids carry loft (GW50/SW54/LW60/LW64)
// because the carries differ and must stay distinct.

export const CANONICAL_CLUBS = [
  "driver",
  "3w", "5w", "7w",
  "2h", "3h", "4h", "5h",
  "2i", "3i", "4i", "5i", "6i", "7i", "8i", "9i",
  "PW", "GW50", "SW54", "LW60", "LW64",
] as const;
export type CanonicalClub = (typeof CANONICAL_CLUBS)[number];

const CANON_SET: ReadonlySet<string> = new Set(CANONICAL_CLUBS);

/** Aliases pattern rules can't derive — names and this bag's specific wedges.
 *  Keys are compacted (lowercase, no spaces/dashes) to match the lookup form. */
const CLUB_ALIASES: Record<string, CanonicalClub> = {
  d: "driver",
  "1w": "driver",
  "1wood": "driver",
  pitchingwedge: "PW",
  pw: "PW",
  pitch: "PW",
  gapwedge: "GW50",
  approachwedge: "GW50",
  aw: "GW50",
  gw: "GW50",
  gw50: "GW50",
  sandwedge: "SW54",
  sw: "SW54",
  sw54: "SW54",
  lobwedge: "LW60",
  lw: "LW60",
  lw60: "LW60",
  lw64: "LW64",
};

/** Loft (degrees) -> wedge id, for inputs like "54°" or "Lob Wedge 60". */
const LOFT_TO_WEDGE: Record<string, CanonicalClub> = {
  "50": "GW50", "52": "GW50",
  "54": "SW54", "56": "SW54",
  "58": "LW60", "60": "LW60",
  "62": "LW64", "64": "LW64",
};

/**
 * Map any reasonable spelling of a club to its canonical id:
 *   "7 Iron" | "7i" | "7-iron"      -> "7i"
 *   "Pitching Wedge" | "PW"          -> "PW"
 *   "Gap Wedge" | "50°"              -> "GW50"
 *   "3 Hybrid" | "3h" | "3 Rescue"   -> "3h"
 *   "Driver" | "D" | "1W"            -> "driver"
 *
 * Unknown inputs return a cleaned (lowercased, compacted) token rather than
 * throwing — a shot is still stored under a stable key, just flagged as
 * non-canonical by `isCanonicalClub`. Never invent or drop a club silently.
 */
export function normalizeClub(raw: string): string {
  const original = raw.trim();
  if (!original) return original;
  if (CANON_SET.has(original)) return original; // already canonical (e.g. seed keys)

  const t = original
    .toLowerCase()
    .replace(/°|º|deg(?:rees?)?/g, " ")
    .replace(/[\s_-]+/g, " ")
    .trim();
  const compact = t.replace(/ /g, "");

  if (CLUB_ALIASES[compact]) return CLUB_ALIASES[compact];

  // Bare loft or "<name> 54": treat as a wedge only when it looks like one.
  const loft = /(?:^|[^0-9])(46|48|50|52|54|56|58|60|62|64)(?:[^0-9]|$)/.exec(t)?.[1];
  if (loft && LOFT_TO_WEDGE[loft] && /(wedge|gw|sw|lw|pw|^\s*\d{2}\s*$)/.test(t)) {
    return LOFT_TO_WEDGE[loft];
  }

  // Numbered families: iron / wood / hybrid.
  let m = /^(\d{1,2})(?:i|iron)$/.exec(compact);
  if (m) return `${m[1]}i`;
  m = /^(\d{1,2})(?:w|wood)$/.exec(compact);
  if (m) return `${m[1]}w`;
  m = /^(\d{1,2})(?:h|hy|hyb|hybrid|rescue)$/.exec(compact);
  if (m) return `${m[1]}h`;

  if (/^driver$/.test(t)) return "driver";

  return compact; // unknown — stable but non-canonical
}

/** True when `club` is exactly one of the canonical ids. */
export function isCanonicalClub(club: string): club is CanonicalClub {
  return CANON_SET.has(club);
}
