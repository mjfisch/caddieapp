# Handicap → Default Dispersion Seeding Table

*Layer 4 of the caddie context, and the cold-start solution. This gives a brand-new user (or you, before a club is mapped) usable dispersion ellipses and a strokes-gained baseline on the very first hole — honestly labeled as benchmark estimates until real data replaces them per club.*

---

## The model

Dispersion is modeled as an **ellipse** around the intended target:

- **Lateral spread** (left/right) — the wider axis, the one that matters most for target choice.
- **Distance spread** (short/long) — the shorter axis.

Both scale with the shot's carry distance, expressed as a one-directional standard deviation (SD) as a **percent of carry**. The percent gets larger as handicap rises (worse players are less consistent), and is roughly constant across clubs within a tier — a reasonable first approximation that you then overwrite with real data.

**Drawing the visual:** the on-screen "shot pattern" ellipse is drawn at **2 SD** on each axis (captures ~95% of shots — the "your realistic miss" boundary you plan around). For a tighter DECADE-style 1-SD pattern, halve it. Make the multiplier configurable.

```
lateral_SD_yards   = carry_yards * lateral_pct[tier]
distance_SD_yards  = carry_yards * distance_pct[tier]

ellipse_half_width  = 2 * lateral_SD_yards     // each side, left & right
ellipse_half_depth  = 2 * distance_SD_yards    // short & long
```

---

## Tier constants

| Handicap tier | Lateral SD (% of carry) | Distance SD (% of carry) |
|---------------|------------------------:|-------------------------:|
| Scratch / + (your tier) | 5.5% | 4.0% |
| 5 | 7.0% | 5.0% |
| 10 | 9.0% | 6.0% |
| 15 | 11.0% | 7.5% |
| 20 | 13.5% | 9.0% |

**Sanity checks (2-SD full pattern width):**
- Scratch driver, 265 carry → lateral SD 14.6 yds → pattern ~58 yds wide. (Matches the DECADE rule of thumb that even tour driver patterns run ~60–65 yds wide.)
- Scratch 7-iron, 160 → lateral SD 8.8 → ~35 yds wide.
- 15-hcp 7-iron, 140 → lateral SD 15.4 → ~62 yds wide.

These are **defensible starting constants, not gospel.** The constant-percent model slightly over-tightens wedges (good wedge players beat it) and is generous to drivers. Calibrate against a real dispersion-by-handicap source (Arccos / Shot Scope aggregate data, or Broadie) before you ship to anyone but yourself.

---

## Default carries by tier (the spine; interpolate the rest)

| Club | Scratch (you) | 5 | 10 | 15 | 20 |
|------|--------------:|---:|---:|---:|---:|
| Driver (carry) | **~265 (est, PENDING)** | 250 | 235 | 220 | 205 |
| 7-iron | **160** | 158 | 150 | 140 | 130 |
| PW | **121** | 118 | 110 | 100 | 92 |

Your scratch-row carries are your **measured** Trackman numbers; the full bag is in the JSON below. Driver is an estimate flagged PENDING until you map it.

---

## Your anchor row (measured) vs. seeded

Your tier IS the scratch/+ row, so for you the seeding table mostly serves the **driver** (no data) and any future new club. The important calibration honesty:

- **Carries: measured.** Use them directly — they're your real Trackman numbers.
- **Lateral/distance dispersion: still seeded**, even for clubs with a measured carry, because your Trackman "dispersion score" is an **ordinal consistency rating (1–9), not lateral yards.** It tells you the 7i and 64° are your tightest and the 4i is your loosest, but it can't be drawn as an ellipse.
- **To replace the seed with real ellipses:** pull the shot-by-shot offline (side) and carry values from `MJF Golf Bag and Yardages 2026.xlsx`, compute the SD of offline distance and the SD of carry per club, and write those in as `measured`. That single step converts your whole mapped bag from `seeded` to `measured` dispersion and silences the caddie's hedging.

---

## Override logic

```
For each club, the caddie uses, in order:
  1. measured personal dispersion (real shot-by-shot SD)         -> confidence: measured
  2. partial personal dispersion (small sample, < ~20 shots)     -> confidence: partial
  3. tier-seeded dispersion from this table                      -> confidence: seeded

Carry and dispersion are resolved INDEPENDENTLY. You can have a measured carry but a
seeded dispersion (this is your current state for most clubs). Flag each separately so
the caddie knows it can trust the number but not yet the spread.

As soon as a club crosses ~20 logged shots, promote partial -> measured and recompute SD.
```

---

## Strokes-gained baseline (the other half of the predictor)

The dispersion ellipse tells you *where the ball goes*; the SG baseline tells you *what each landing spot is worth*. Use **Mark Broadie's expected-strokes-to-hole-out** benchmark (from *Every Shot Counts*; the USGA publishes an equivalent grid). A few anchor values for the scratch/tour baseline:

| Situation | Expected strokes to hole out |
|-----------|-----------------------------:|
| Tee, par-4 ~400 yds | ~3.99 |
| Fairway, 150 yds | ~2.98 |
| Fairway, 100 yds | ~2.80 |
| Rough, 150 yds | ~3.15 (≈ +0.17 vs fairway) |
| Sand, 50 yds | ~2.95 |
| Recovery / trees | +1.0 or more vs fairway at same distance |
| Penalty | +1 stroke + the value of the drop spot |
| Green, 20 ft | ~1.87 |
| Green, 8 ft | ~1.50 |

**How the predictor uses it:** sample N points from a club's dispersion ellipse → classify each point's lie from the course polygons → look up expected strokes for that lie+distance → average across the sample → that's the expected strokes for that club/target. Compare clubs/targets; recommend the lowest expected-strokes (highest SG) option whose realistic miss stays acceptable.

**Benchmark vs. personal:** for *relative* comparisons (driver vs. iron on this hole), the scratch baseline is fine — you're comparing two options under the same yardstick, so the absolute level cancels out. Only when you want true personal SG totals do you need a baseline matched to your ability. Like Shot Pattern, let the user set a **target-handicap benchmark** for that.

---

## Machine-readable seed (drop into your app)

```json
{
  "model": {
    "ellipse_sd_multiplier": 2.0,
    "tiers": {
      "scratch": { "lateral_pct": 0.055, "distance_pct": 0.040 },
      "5":       { "lateral_pct": 0.070, "distance_pct": 0.050 },
      "10":      { "lateral_pct": 0.090, "distance_pct": 0.060 },
      "15":      { "lateral_pct": 0.110, "distance_pct": 0.075 },
      "20":      { "lateral_pct": 0.135, "distance_pct": 0.090 }
    }
  },
  "default_carries_yards": {
    "scratch": { "driver": 265, "3w": 245, "5w": 230, "4i": 200, "7i": 160, "PW": 121 },
    "5":       { "driver": 250, "3w": 232, "5w": 218, "4i": 190, "7i": 158, "PW": 118 },
    "10":      { "driver": 235, "3w": 218, "5w": 205, "4i": 178, "7i": 150, "PW": 110 },
    "15":      { "driver": 220, "3w": 205, "5w": 192, "4i": 165, "7i": 140, "PW": 100 },
    "20":      { "driver": 205, "3w": 190, "5w": 178, "4i": 150, "7i": 130, "PW": 92 }
  },
  "player_michael_measured_carries_yards": {
    "driver": null,
    "3h": 195, "4i": 183, "5h": 185, "6i": 174, "7i": 160,
    "8i": 151, "9i": 138, "PW": 121, "GW50": 107, "SW54": 96,
    "LW60": 80, "LW64": 76
  },
  "player_michael_tier": "scratch",
  "player_michael_dispersion_confidence": "seeded_pending_raw_trackman_side_data",
  "sg_baseline_source": "Broadie Every Shot Counts / USGA expected-strokes grid",
  "sg_baseline_anchors": {
    "tee_par4_400": 3.99,
    "fairway_150": 2.98,
    "fairway_100": 2.80,
    "rough_150": 3.15,
    "green_20ft": 1.87,
    "green_8ft": 1.50
  }
}
```

---

## Calibration TODO (highest leverage first)

1. **Map the driver** (separate Trackman bay) — it's the biggest data hole and the highest-variance club. Until then it's `seeded` and the caddie must say so.
2. **Pull raw shot-by-shot side/carry values** from the bag file and compute real per-club SD → promotes your mapped bag from `seeded` to `measured` dispersion.
3. **Replace the tier constants** with a published dispersion-by-handicap source before opening the app to anyone but you.
4. **Load Broadie's full expected-strokes grid**, not just the anchors above, so the predictor interpolates cleanly at every distance/lie.
