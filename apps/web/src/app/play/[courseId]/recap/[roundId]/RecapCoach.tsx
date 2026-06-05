"use client";

import { useRef, useState } from "react";

// Step 4E — the optional, load-on-demand caddie round recap. CLIENT code: it talks
// to the server only over fetch to /api/rounds/[roundId]/recap and NEVER imports
// @gai/api or references the Anthropic key (invariant #3). The page is fully useful
// without it — nothing here blocks the recap render.

const PERSONA_KEY = "gai-caddie-persona";
const DEFAULT_PERSONA = "rain_man";

interface SseEvent {
  event: string;
  data: unknown;
}

/** Parse one raw SSE frame (`event: x\ndata: {...}`) into {event, data}. */
function parseFrame(raw: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export default function RecapCoach({ roundId }: { roundId: string }) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function getRecap() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setText("");
    setDone(false);

    let persona = DEFAULT_PERSONA;
    try {
      persona = localStorage.getItem(PERSONA_KEY) || DEFAULT_PERSONA;
    } catch {
      /* localStorage unavailable — default persona */
    }

    try {
      const res = await fetch(`/api/rounds/${roundId}/recap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "Could not get a recap.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = parseFrame(buf.slice(0, sep));
          buf = buf.slice(sep + 2);
          if (!frame) continue;
          if (frame.event === "delta") {
            acc += (frame.data as { text: string }).text;
            setText(acc);
          } else if (frame.event === "done") {
            setDone(true);
          } else if (frame.event === "error") {
            setError((frame.data as { error: string }).error);
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }

  return (
    <section className="rc-coach">
      {!text && !loading && (
        <button type="button" className="rc-coach-btn mono" onClick={getRecap}>
          Get round recap →
        </button>
      )}
      {(text || loading) && (
        <div className="rc-coach-body">
          <p className="rc-coach-text" aria-live="polite" aria-busy={loading}>
            {text || "The caddie is looking over your card…"}
          </p>
          {done && !loading && (
            <button type="button" className="rc-coach-again mono" onClick={getRecap}>
              ↻ again
            </button>
          )}
        </div>
      )}
      {error && <p className="rc-coach-err">{error}</p>}
    </section>
  );
}
