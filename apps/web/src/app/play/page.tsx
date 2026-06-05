import Link from "next/link";
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

export default async function PlayIndexPage() {
  const pool = getPool();
  const { rows: courses } = await pool.query<CourseRow>(
    "SELECT id, name, city, state FROM course ORDER BY name",
  );

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
        <Link href="/" className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
          ← home
        </Link>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Play a round
        </h1>
        <div className="mono" style={{ fontSize: 13, color: "var(--muted)" }}>
          {courses.length} {courses.length === 1 ? "course" : "courses"}
        </div>
      </header>

      {courses.length === 0 ? (
        <p style={{ color: "var(--faint)" }}>No courses yet.</p>
      ) : (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {courses.map((c) => {
            const location = [c.city, c.state].filter(Boolean).join(", ");
            return (
              <Link
                key={c.id}
                href={`/play/${c.id}`}
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  padding: "18px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  color: "var(--text)",
                  textDecoration: "none",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 20, fontWeight: 600 }}>{c.name}</span>
                  {location && (
                    <span className="mono" style={{ fontSize: 13, color: "var(--muted)" }}>
                      {location}
                    </span>
                  )}
                </span>
                <span className="mono" style={{ fontSize: 15, color: "var(--green)" }}>
                  Play →
                </span>
              </Link>
            );
          })}
        </section>
      )}

      <footer style={{ fontSize: 12, color: "var(--faint)" }}>Built by Back Tee Partners</footer>
    </main>
  );
}
