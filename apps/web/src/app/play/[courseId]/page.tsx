import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool, listRounds, runMigrations } from "@gai/api";
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

  // Past rounds (Phase 5) — persisted in Neon, newest first.
  await runMigrations();
  const pastRounds = await listRounds(courseId);

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

      {pastRounds.length > 0 && (
        <section className="mb-past">
          <div className="mb-past-label mono">Past rounds</div>
          <ul className="mb-past-list">
            {pastRounds.map((r) => {
              const label = r.vsPar === 0 ? "E" : r.vsPar > 0 ? `+${r.vsPar}` : `${r.vsPar}`;
              const cls = r.vsPar < 0 ? "rc-green" : r.vsPar === 0 ? "rc-text" : "rc-amber";
              return (
                <li key={r.id}>
                  <Link href={`/play/${courseId}/recap/${r.id}`} className="mb-past-row">
                    <span className="mb-past-date mono">{formatPlayedDate(r.playedDate)}</span>
                    <span className="mb-past-strokes mono">{r.totalStrokes} strokes</span>
                    <span className={`mb-past-vspar mono ${cls}`}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

// "2026-06-05" → "Jun 5" (parsed as plain parts; no Date tz shift).
function formatPlayedDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1] ?? ""} ${Number(d)}`;
}
