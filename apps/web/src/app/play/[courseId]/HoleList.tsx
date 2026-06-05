"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Client list of holes for the course play index. The hole data comes from the
// server (props); the saved score is read from localStorage (gai-play-scores),
// keyed by `${courseId}-${holeNumber}` — same convention as the Mode B view.

const SCORES_KEY = "gai-play-scores";

export interface PlayHole {
  number: number;
  par: number;
  yardageWhite: number | null;
}

export default function HoleList({
  courseId,
  holes,
}: {
  courseId: string;
  holes: PlayHole[];
}) {
  const [scores, setScores] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      setScores(JSON.parse(localStorage.getItem(SCORES_KEY) ?? "{}") ?? {});
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const firstHole = holes[0]?.number ?? 1;

  return (
    <>
      <Link href={`/play/${courseId}/holes/${firstHole}`} className="mb-start-btn mono">
        Start round →
      </Link>

      <ul className="mb-hole-list">
        {holes.map((h) => {
          const score = scores[`${courseId}-${h.number}`];
          const toPar = typeof score === "number" ? score - h.par : null;
          return (
            <li key={h.number}>
              <Link href={`/play/${courseId}/holes/${h.number}`} className="mb-hole-row">
                <span className="mb-hole-row-num mono">{h.number}</span>
                <span className="mb-hole-row-par mono">PAR {h.par}</span>
                <span className="mb-hole-row-yds mono">
                  {h.yardageWhite != null ? `${h.yardageWhite} yds` : "—"}
                </span>
                <span className="mb-hole-row-score mono">
                  {typeof score === "number" ? (
                    <span className="mb-score-pill">
                      {score}
                      {toPar != null && toPar !== 0 && (
                        <span className="mb-score-topar">
                          {toPar > 0 ? `+${toPar}` : toPar}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="mb-score-empty">—</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
