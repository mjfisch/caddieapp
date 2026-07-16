"use client";

import { useCallback, useEffect, useState } from "react";

// Club Confidence panel (Mission CC) — relocated verbatim from the Practice tab
// to the bottom of the Bag tab, where it belongs per Practice spec §7 / D26: it
// describes what the clubs DO. CLIENT island so the Bag page stays a server
// component — it talks to the server only over fetch (/api/practice/confidence)
// and never imports @gai/api or the Anthropic key (invariant #3). The two
// confidence axes (data = objective shot count, feel = editable 1–4) and their
// semantic colors (green / amber / faint grey) are unchanged (invariant #2).

type ClubConf = {
  club: string;
  dataConfidence: "measured" | "partial" | "seeded" | null;
  feelLevel: number | null;
  note: string | null;
};

const CONFIDENCE_COLOR: Record<string, string> = {
  measured: "var(--green)",
  partial: "var(--amber)",
  seeded: "var(--faint)",
};

export function ClubConfidence() {
  const [clubs, setClubs] = useState<ClubConf[]>([]);

  const loadConfidence = useCallback(async () => {
    try {
      const res = await fetch("/api/practice/confidence");
      if (!res.ok) return;
      const j = (await res.json()) as { clubs: ClubConf[] };
      setClubs(j.clubs ?? []);
    } catch {
      /* leave panel empty on failure */
    }
  }, []);

  useEffect(() => {
    void loadConfidence();
  }, [loadConfidence]);

  // Tap a feel segment — optimistic, reconcile on failure.
  async function setFeel(club: string, level: number) {
    setClubs((prev) => prev.map((c) => (c.club === club ? { ...c, feelLevel: level } : c)));
    try {
      await fetch("/api/practice/confidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ club, feel_level: level }),
      });
    } catch {
      void loadConfidence();
    }
  }

  return (
    <section className="bag-confidence">
      <div className="pr-label">
        <span>Club confidence</span>
        <span className="pr-t" style={{ fontFamily: "var(--font-mono), monospace", fontSize: 10 }}>
          DATA · FEEL
        </span>
      </div>
      <p className="pr-conf-help">
        Data confidence is objective (shot count). Feel confidence is yours to set.
      </p>
      <div className="pr-conf">
        {clubs.map((c) => {
          const feel = c.feelLevel ?? 0;
          const lvlClass = feel <= 1 ? "lo" : feel <= 2 ? "mid" : "";
          const flab = feel === 0 ? "—" : feel <= 1 ? "LOW" : feel <= 2 ? "MED" : "HIGH";
          const dc = c.dataConfidence;
          return (
            <div className="pr-conf-card" key={c.club}>
              {feel >= 1 && feel <= 2 && <span className="pr-lowdot" aria-label="low trust" />}
              <div className="pr-conf-top">
                <span className="pr-conf-club">{c.club}</span>
                {dc && (
                  <span className="pr-dc" style={{ color: CONFIDENCE_COLOR[dc] }}>
                    {dc}
                  </span>
                )}
              </div>
              <div className="pr-feel">
                {[1, 2, 3, 4].map((i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`set feel ${i}`}
                    className={`pr-bar${i <= feel ? ` fill ${lvlClass}` : ""}`}
                    onClick={() => setFeel(c.club, i)}
                  />
                ))}
                <span className="pr-flab">{flab}</span>
              </div>
            </div>
          );
        })}
        {clubs.length === 0 && <p className="pr-empty">Loading the bag…</p>}
      </div>
    </section>
  );
}
