import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@gai/api";
import StrategyPanel from "./StrategyPanel";

// DB-backed, server-only. pg needs the Node runtime; never statically cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HoleRow {
  id: string;
  number: number;
  par: number;
  stroke_index: number | null;
  yardage_white: number | null;
  yardage_blue: number | null;
  yardage_red: number | null;
  notes: string | null;
}

interface FeatureRow {
  id: string;
  kind: string;
  side: string | null;
  distance_from_tee: number | null;
  carry_to_clear: number | null;
  note: string | null;
}

// Phase 1: one course (Fox Bend), so the image set lives at a fixed slug. Phase 2
// will carry a per-course slug on the course row to map to its own image folder.
const IMAGE_SLUG = "fox-bend";

// Hazards read as caution; the green complex as the recommended/safe accent;
// everything else stays neutral. Mirrors the semantic color model (invariant #2).
const KIND_ACCENT: Record<string, string> = {
  water: "var(--red)",
  ob: "var(--red)",
  forced_carry: "var(--red)",
  bunker: "var(--amber)",
  tree_line: "var(--amber)",
  green_complex: "var(--green)",
};

const KIND_LABEL: Record<string, string> = {
  water: "water",
  ob: "OB",
  forced_carry: "forced carry",
  bunker: "bunker",
  tree_line: "tree line",
  green_complex: "green",
};

export default async function HolePage({
  params,
}: {
  params: Promise<{ courseId: string; holeNumber: string }>;
}) {
  const { courseId, holeNumber } = await params;
  const number = Number.parseInt(holeNumber, 10);
  if (!Number.isInteger(number)) notFound();

  const pool = getPool();

  const { rows: holes } = await pool.query<HoleRow>(
    `SELECT id, number, par, stroke_index,
            yardage_white, yardage_blue, yardage_red, notes
       FROM hole
      WHERE course_id = $1 AND number = $2`,
    [courseId, number]
  );
  const hole = holes[0];
  if (!hole) notFound();

  const { rows: features } = await pool.query<FeatureRow>(
    `SELECT id, kind, side, distance_from_tee, carry_to_clear, note
       FROM hole_feature
      WHERE hole_id = $1
      ORDER BY distance_from_tee NULLS LAST, kind`,
    [hole.id]
  );

  const padded = String(hole.number).padStart(2, "0");
  const imageSrc = `/courses/${IMAGE_SLUG}/images/hole-${padded}.png`;

  const yardages: { label: string; value: number | null }[] = [
    { label: "White", value: hole.yardage_white },
    { label: "Blue", value: hole.yardage_blue },
    { label: "Red", value: hole.yardage_red },
  ];

  const prev = hole.number > 1 ? hole.number - 1 : null;
  const next = hole.number < 18 ? hole.number + 1 : null;

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "32px 24px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Breadcrumb / nav back to the course index */}
      <Link
        href={`/courses/${courseId}`}
        className="mono"
        style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--muted)" }}
      >
        ← all holes
      </Link>

      {/* Header: hole number · par · stroke index */}
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Hole {hole.number}
        </h1>
        <span className="mono" style={{ fontSize: 14, color: "var(--muted)" }}>
          PAR {hole.par}
        </span>
        {hole.stroke_index != null && (
          <span className="mono" style={{ fontSize: 14, color: "var(--faint)" }}>
            SI {hole.stroke_index}
          </span>
        )}
      </header>

      {/* Satellite image */}
      <div
        style={{
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid var(--line)",
          background: "var(--bg2)",
        }}
      >
        {/* Raw <img>: static asset from public/, no Next image optimization needed here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt={`Hole ${hole.number} satellite view`}
          className="hole-image"
        />
      </div>

      {/* Yardages by tee */}
      <section style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {yardages.map(({ label, value }) => (
          <div
            key={label}
            style={{
              flex: "1 1 120px",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--faint)",
              }}
            >
              {label}
            </div>
            <div className="mono" style={{ fontSize: 26, color: "var(--text)", marginTop: 4 }}>
              {value != null ? value : "—"}
              {value != null && (
                <span style={{ fontSize: 13, color: "var(--muted)" }}> yds</span>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* Feature chips */}
      {features.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--faint)",
            }}
          >
            Features
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {features.map((f) => {
              const accent = KIND_ACCENT[f.kind] ?? "var(--muted)";
              return (
                <span
                  key={f.id}
                  title={f.note ?? undefined}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    background: "var(--panel)",
                    border: "1px solid var(--line2)",
                    borderRadius: 999,
                    padding: "6px 12px",
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: accent,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ color: "var(--text)" }}>{KIND_LABEL[f.kind] ?? f.kind}</span>
                  {f.side && <span style={{ color: "var(--muted)" }}>· {f.side}</span>}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* Notes */}
      {hole.notes && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--faint)",
            }}
          >
            Notes
          </div>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "var(--text)" }}>
            {hole.notes}
          </p>
        </section>
      )}

      {/* Strategy — the caddie's read (Phase 3B). Client component; streams from
          /api/strategy. Engine numbers render above the streamed caddie voice. */}
      <StrategyPanel courseId={courseId} holeNumber={hole.number} />

      {/* Prev / next hole nav */}
      <nav style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        {prev != null ? (
          <Link href={`/courses/${courseId}/holes/${prev}`} className="mono" style={{ fontSize: 13 }}>
            ← Hole {prev}
          </Link>
        ) : (
          <span />
        )}
        {next != null ? (
          <Link href={`/courses/${courseId}/holes/${next}`} className="mono" style={{ fontSize: 13 }}>
            Hole {next} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
