// Mission 3c — Club dossier reference data (DISPLAY ONLY).
//
// PROVENANCE — this is a CURATED DERIVATIVE, not a source of truth:
//   • Equipment specs derived from "MJF Golf Bag 2026 → Bag Specs" —
//     sync when clubs change.
//   • Feel / tendencies (trust, shape, feared miss, note) derived from
//     player_profile_michael.md — sync when the profile changes.
//
// Keyed by the SAME display label clubDisplayName() produces (e.g. "Driver",
// "3-hybrid", "50° GW") so the row looks it up with no extra mapping. It adds
// NO carry / dispersion / confidence numbers — those stay in the canonical
// dataset (BagClubView); the expanded card reads shot count + capture date from
// there, never from here. No SG compute, no LLM (invariant #1).

export type ClubDossier = {
  brand: string;
  model: string;
  shaft: string;
  flex: string;
  length: string;
  loft: string;
  /** Irons only (6i–GW). */
  lie?: string;
  /** Wedges only. */
  bounce?: string;
  /** Wedges only (some wedges have bounce but no grind). */
  grind?: string;
  /** 1–5 conviction pip rating. */
  trust: number;
  shape: string;
  fearedMiss: string;
  note: string;
};

export const CLUB_DOSSIER: Record<string, ClubDossier> = {
  "Driver":   { brand:"TaylorMade", model:"Stealth",        shaft:"Fujikura Ventus Blue Velcore+", flex:"X-Stiff", length:"44.5\"", loft:"9°",
                trust:4, shape:"Fade (L→R)",        fearedMiss:"Snap hook left",
                note:"Grunt Fade — stock pressure shot; never throttle. Left is the danger side off the tee." },
  "3-hybrid": { brand:"TaylorMade", model:"Stealth",        shaft:"UST Proforce White/Yellow F5 85 V2", flex:"X-Stiff", length:"39.5\"", loft:"19°",
                trust:4, shape:"Slight fade / push", fearedMiss:"Right",
                note:"Underused for position off the tee — surface it when it leaves a full wedge. Not from sand." },
  "5-hybrid": { brand:"Sub70",      model:"939X Hybrid",    shaft:"UST Proforce White/Yellow F5 85 V2", flex:"X-Stiff", length:"38.5\"", loft:"24°",
                trust:4, shape:"Slight draw",        fearedMiss:"Push wide right",
                note:"Preferred long club over the 4i — the only drawing long club." },
  "4-iron":   { brand:"Sub70",      model:"699U Pro v3",    shaft:"Fujikura Ventus HB Black Velcore+", flex:"X-Stiff", length:"39\"", loft:"20°",
                trust:2, shape:"Slight fade / push", fearedMiss:"Right (widest scatter in the bag)",
                note:"Hate-but-keep. Caddie doesn't volunteer it; standing practice flag." },
  "6-iron":   { brand:"Sub70",      model:"699 v2 Utility", shaft:"UST Proforce White/Yellow F5 85 V2", flex:"X-Stiff", length:"37.5\"", loft:"26.5°", lie:"2° flat",
                trust:4, shape:"Slight fade / push", fearedMiss:"Push wide right",
                note:"Liked and trusted. Clean-contact fallback from fairway bunkers." },
  "7-iron":   { brand:"Sub70",      model:"699 Pro",        shaft:"KBS Tour 130 Steel", flex:"X-Stiff", length:"37\"", loft:"31°", lie:"1° flat",
                trust:4, shape:"Straight / baby draw", fearedMiss:"Overdraw left",
                note:"Trusted mid-iron. Bunker / recovery fallback." },
  "8-iron":   { brand:"Sub70",      model:"699 Pro",        shaft:"KBS Tour 130 Steel", flex:"X-Stiff", length:"36.5\"", loft:"35°", lie:"1° flat",
                trust:4, shape:"Straight / baby draw", fearedMiss:"Overdraw left",
                note:"Comfortable knockdown / into-wind club." },
  "9-iron":   { brand:"Sub70",      model:"699 Pro",        shaft:"KBS Tour 130 Steel", flex:"X-Stiff", length:"36\"", loft:"40°", lie:"1° flat",
                trust:5, shape:"Straight / baby draw", fearedMiss:"Mild right bias",
                note:"Owned knockdown / low-runner, 125–145 yds." },
  "PW":       { brand:"Sub70",      model:"699 Pro",        shaft:"KBS Tour 130 Steel", flex:"X-Stiff", length:"35.75\"", loft:"45°", lie:"1° flat",
                trust:5, shape:"Straight / baby draw", fearedMiss:"—",
                note:"Anchor — the blindfold club. Full conviction regardless of sample size." },
  "50° GW":   { brand:"Sub70",      model:"699 Pro",        shaft:"KBS Tour 130 Steel", flex:"X-Stiff", length:"35.5\"", loft:"50°", lie:"1° flat",
                trust:5, shape:"Straight / baby draw", fearedMiss:"Overdraw / pull",
                note:"Approach shots only — never used around the green." },
  "54° SW":   { brand:"Titleist",   model:"Vokey SM10",     shaft:"True Temper Dynamic Gold", flex:"X-Stiff", length:"35.25\"", loft:"54°", bounce:"14°", grind:"F",
                trust:5, shape:"Straight / baby draw", fearedMiss:"Overdraw / pull",
                note:"Favorite full number 105 (layup anchor); plays ~105 warm vs 96 measured. Check-and-stop." },
  "60° LW":   { brand:"Titleist",   model:"Vokey SM10",     shaft:"True Temper+ Dynamic Gold", flex:"X-Stiff", length:"35\"", loft:"60°", bounce:"12°", grind:"D",
                trust:4, shape:"Straight / baby draw", fearedMiss:"Fat / chunk (contact)",
                note:"The everything club around the green — most-used short-game tool." },
  "64° LW":   { brand:"Cleveland",  model:"RTX Full Face",  shaft:"True Temper Dynamic Gold", flex:"X-Stiff", length:"35\"", loft:"64°", bounce:"9°",
                trust:4, shape:"Straight / baby draw (right bias)", fearedMiss:"Off the toe (contact)",
                note:"Primary bunker club + rough inside 85. Never off tight lies." },
};

/**
 * Assemble the EQUIPMENT line. Base fields always show; bounce/grind append only
 * for clubs that carry them (wedges — and independently, since the 64° LW has
 * bounce but no grind), and lie appends only for irons. Joined with " · ".
 */
export function equipmentLine(d: ClubDossier): string {
  const parts = [`${d.brand} ${d.model}`, d.loft, d.shaft, d.flex, d.length];
  if (d.bounce) parts.push(`${d.bounce} bounce`);
  if (d.grind) parts.push(`${d.grind} grind`);
  if (d.lie) parts.push(`${d.lie} lie`);
  return parts.join(" · ");
}
