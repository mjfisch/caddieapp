import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@gai/api";
import HoleList, { type PlayHole } from "./HoleList";

// DB-backed, server-only. pg needs the Node runtime; never statically cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CourseRow {
  id: string;
  name: string;
}

interface HoleRow {
  number: number;
  par: number;
  yardage_white: number | null;
}

export default async function CoursePlayIndexPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const pool = getPool();

  const { rows: courses } = await pool.query<CourseRow>(
    "SELECT id, name FROM course WHERE id = $1",
    [courseId],
  );
  const course = courses[0];
  if (!course) notFound();

  const { rows: holeRows } = await pool.query<HoleRow>(
    `SELECT number, par, yardage_white
       FROM hole
      WHERE course_id = $1
      ORDER BY number`,
    [courseId],
  );

  const holes: PlayHole[] = holeRows.map((h) => ({
    number: h.number,
    par: h.par,
    yardageWhite: h.yardage_white,
  }));

  return (
    <main className="mb-index-page">
      <header className="mb-index-header">
        <Link href="/play" className="mono mb-index-back">
          ← courses
        </Link>
        <h1 className="mb-index-title">{course.name}</h1>
        <div className="mono mb-index-sub">Play a round</div>
      </header>

      {holes.length === 0 ? (
        <p className="mb-index-empty">No holes yet.</p>
      ) : (
        <HoleList courseId={courseId} holes={holes} />
      )}
    </main>
  );
}
