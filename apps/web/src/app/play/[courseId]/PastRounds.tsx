"use client";

import { useState } from "react";
import Link from "next/link";
import { reconcileDeletedRound } from "../roundStorage";

// Mission 2 — the past-rounds list with per-round delete + "mark as test" affordances.
// CLIENT component (was a server-rendered list): delete must also purge the round's
// localStorage footprint (Step 3) or the on-course view re-syncs and resurrects it.
// It talks to the server only over fetch — never imports @gai/api (invariant #3).

export interface PastRound {
  id: string;
  playedDate: string;
  totalStrokes: number;
  vsPar: number;
  isTest: boolean;
}

function vsParLabel(vsPar: number): string {
  if (vsPar === 0) return "E";
  return vsPar > 0 ? `+${vsPar}` : `${vsPar}`;
}
function vsParClass(vsPar: number): string {
  if (vsPar < 0) return "rc-green";
  if (vsPar === 0) return "rc-text";
  return "rc-amber";
}

// "2026-06-05" → "Jun 5" (parsed as plain parts; no Date tz shift).
function formatPlayedDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1] ?? ""} ${Number(d)}`;
}

export default function PastRounds({
  courseId,
  initialRounds,
}: {
  courseId: string;
  initialRounds: PastRound[];
}) {
  const [rounds, setRounds] = useState<PastRound[]>(initialRounds);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/rounds/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "Could not delete the round.");
        return;
      }
      // Step 3: clear the deleted round from localStorage so it can't re-sync.
      try {
        reconcileDeletedRound(window.localStorage, courseId, id);
      } catch {
        /* localStorage unavailable — server delete already succeeded */
      }
      setRounds((prev) => prev.filter((r) => r.id !== id));
      setConfirmId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTest(id: string, next: boolean) {
    setBusyId(id);
    setError(null);
    // Optimistic — flip immediately, reconcile on failure.
    setRounds((prev) => prev.map((r) => (r.id === id ? { ...r, isTest: next } : r)));
    try {
      const res = await fetch(`/api/rounds/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isTest: next }),
      });
      if (!res.ok) {
        setRounds((prev) => prev.map((r) => (r.id === id ? { ...r, isTest: !next } : r)));
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "Could not update the round.");
      }
    } catch (err) {
      setRounds((prev) => prev.map((r) => (r.id === id ? { ...r, isTest: !next } : r)));
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusyId(null);
    }
  }

  if (rounds.length === 0) return null;

  return (
    <section className="mb-past">
      <div className="mb-past-label mono">Past rounds</div>
      {error && <p className="mb-past-err">{error}</p>}
      <ul className="mb-past-list">
        {rounds.map((r) => {
          const confirming = confirmId === r.id;
          const busy = busyId === r.id;
          return (
            <li key={r.id} className="mb-past-item">
              <div className="mb-past-row">
                <Link href={`/play/${courseId}/recap/${r.id}`} className="mb-past-link">
                  <span className="mb-past-date mono">{formatPlayedDate(r.playedDate)}</span>
                  <span className="mb-past-strokes mono">{r.totalStrokes} strokes</span>
                  {r.isTest && <span className="mb-past-testtag mono">TEST</span>}
                  <span className={`mb-past-vspar mono ${vsParClass(r.vsPar)}`}>{vsParLabel(r.vsPar)}</span>
                </Link>
                <div className="mb-past-actions">
                  <button
                    type="button"
                    className={`mb-past-test mono${r.isTest ? " on" : ""}`}
                    onClick={() => toggleTest(r.id, !r.isTest)}
                    disabled={busy}
                    aria-pressed={r.isTest}
                    title="Exclude from scoring signals (keeps the round)"
                  >
                    {r.isTest ? "✓ test" : "test"}
                  </button>
                  <button
                    type="button"
                    className="mb-past-del mono"
                    onClick={() => setConfirmId(confirming ? null : r.id)}
                    disabled={busy}
                    aria-label="Delete round"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {confirming && (
                <div className="mb-past-confirm">
                  <span className="mb-past-confirm-tx">Delete this round permanently?</span>
                  <div className="mb-past-confirm-btns">
                    <button
                      type="button"
                      className="mb-past-confirm-no mono"
                      onClick={() => setConfirmId(null)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mb-past-confirm-yes mono"
                      onClick={() => handleDelete(r.id)}
                      disabled={busy}
                    >
                      {busy ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
