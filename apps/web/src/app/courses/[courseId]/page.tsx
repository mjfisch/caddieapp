import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@gai/api";

// DB-backed, server-only. pg needs the Node runtime; never statically cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CourseRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

interface HoleCardRow {
  number: number;
  par: number;
  yardage_white: number | null;
  yardage_blue: number | null;
  yardage_red: number | null;
}

export default async function CoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const pool = getPool();

  const { rows: courses } = await pool.query<CourseRow>(
    "SELECT id, name, city, state FROM course WHERE id = $1",
    [courseId]
  );
  const course = courses[0];
  if (!course) notFound();

  const { rows: holes } = await pool.query<HoleCardRow>(
    `SELECT number, par, yardage_white, yardage_blue, yardage_red
       FROM hole
      WHERE course_id = $1
      ORDER BY number`,
    [courseId]
  );

  const location = [course.city, course.state].filter(Boolean).join(", ");
  const totalPar = holes.reduce((sum, h) => sum + h.par, 0);

  return (
    <main
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "32px 24px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {course.name}
        </h1>
        <div className="mono" style={{ fontSize: 13, color: "var(--muted)" }}>
          {location && <span>{location}</span>}
          {location && holes.length > 0 && <span style={{ color: "var(--faint)" }}> · </span>}
          {holes.length > 0 && (
            <span>
              {holes.length} holes · par {totalPar}
            </span>
          )}
        </div>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 12,
        }}
      >
        {holes.map((h) => (
          <Link
            key={h.number}
            href={`/courses/${courseId}/holes/${h.number}`}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              color: "var(--text)",
              textDecoration: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 24, fontWeight: 600 }}>{h.number}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                PAR {h.par}
              </span>
            </div>
            <div className="mono" style={{ fontSize: 13, color: "var(--green)" }}>
              {h.yardage_white != null ? `${h.yardage_white} yds` : "—"}
            </div>
          </Link>
        ))}
      </section>

      <footer style={{ fontSize: 12, color: "var(--faint)" }}>Built by Back Tee Partners</footer>
    </main>
  );
}
