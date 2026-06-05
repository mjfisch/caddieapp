import { notFound } from "next/navigation";
import { getPool } from "@gai/api";
import HoleView from "./HoleView";

// DB-backed, server-only. pg needs the Node runtime; never statically cache.
// force-dynamic also means navigating to a sibling hole remounts HoleView, so its
// auto-fire effect streams a fresh caddie read for each hole (Step 2 / Step 3 nav).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HoleRow {
  number: number;
  par: number;
  stroke_index: number | null;
}

// Phase 1: one course (Fox Bend), so the image set lives at a fixed slug — mirrors
// the Mode A page. Phase 2 will carry a per-course slug on the course row.
const IMAGE_SLUG = "fox-bend";

export default async function PlayHolePage({
  params,
}: {
  params: Promise<{ courseId: string; holeNumber: string }>;
}) {
  const { courseId, holeNumber } = await params;
  const number = Number.parseInt(holeNumber, 10);
  if (!Number.isInteger(number)) notFound();

  const pool = getPool();

  const { rows: holes } = await pool.query<HoleRow>(
    `SELECT number, par, stroke_index
       FROM hole
      WHERE course_id = $1 AND number = $2`,
    [courseId, number],
  );
  const hole = holes[0];
  if (!hole) notFound();

  const { rows: counts } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::int AS count FROM hole WHERE course_id = $1",
    [courseId],
  );
  const totalHoles = Number(counts[0]?.count ?? 18) || 18;

  const padded = String(hole.number).padStart(2, "0");
  const imageSrc = `/courses/${IMAGE_SLUG}/images/hole-${padded}.png`;

  return (
    <HoleView
      courseId={courseId}
      holeNumber={hole.number}
      par={hole.par}
      strokeIndex={hole.stroke_index}
      imageSrc={imageSrc}
      totalHoles={totalHoles}
    />
  );
}
