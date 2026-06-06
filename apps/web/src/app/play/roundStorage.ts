// Mission 2 / Step 3 — the localStorage reconciliation gotcha.
//
// Rounds sync localStorage → Neon fire-and-forget (no pending-push queue): each
// hole score POSTs to /api/rounds/[roundId]/holes the moment it's tapped, and the
// active round is pinned in localStorage. So deleting a round on the server is not
// enough — if its localStorage footprint survives, the next on-course visit reuses
// the (now-deleted) round id and re-pushes the scores, resurrecting it.
//
// This module is the single source of truth for that cleanup. It's PURE: it takes a
// Storage-like object and mutates only the three round keys, so it can be unit-tested
// in Node with a fake store and reused by any client that deletes a round.

// Keys mirror HoleView.tsx (the on-course view that writes them).
export const ROUND_ID_KEY = "gai-play-round-id";
export const SCORES_KEY = "gai-play-scores";
export const PUTTS_KEY = "gai-play-putts";

/** The minimal slice of the Web Storage API we use (so tests can pass a fake). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readMap(store: StorageLike, key: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(store.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Purge the localStorage footprint of a deleted round so it can't re-sync.
 *
 * Scores/putts are keyed by course (not round), so they only describe whichever
 * round is currently ACTIVE for that course. We therefore clear them only when the
 * deleted round IS that active round (its id sits in gai-play-round-id[courseId]).
 * Deleting an older, already-finished round leaves the active round's local entry
 * intact. Returns whether anything was cleared (purely for callers that want to log).
 */
export function reconcileDeletedRound(
  store: StorageLike,
  courseId: string,
  roundId: string,
): boolean {
  const idMap = readMap(store, ROUND_ID_KEY);
  const entry = idMap[courseId] as { roundId?: string } | undefined;
  if (!entry || entry.roundId !== roundId) {
    // The deleted round isn't the active one for this course — nothing local to clear.
    return false;
  }

  // Drop the active-round pointer so the course no longer reuses this dead id.
  delete idMap[courseId];
  store.setItem(ROUND_ID_KEY, JSON.stringify(idMap));

  // Clear this course's per-hole scores + putts (keyed `${courseId}-${holeNumber}`)
  // so the stale numbers can't be re-pushed and don't linger in the hole list.
  const prefix = `${courseId}-`;
  for (const key of [SCORES_KEY, PUTTS_KEY]) {
    const map = readMap(store, key);
    let changed = false;
    for (const k of Object.keys(map)) {
      if (k.startsWith(prefix)) {
        delete map[k];
        changed = true;
      }
    }
    if (changed) store.setItem(key, JSON.stringify(map));
  }
  return true;
}
