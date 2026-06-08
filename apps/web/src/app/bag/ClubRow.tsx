"use client";

import { useState } from "react";
import {
  type BagClubView,
  clubDisplayName,
  carryConfidenceLine,
  dispersionBand,
  isDispersionEstimated,
  formatSessionDate,
} from "./bagView";
import { CLUB_DOSSIER, equipmentLine } from "./clubDossier";

// Mission 3c — one ALL CLUBS row, now expandable into a club dossier. CLIENT
// island (useState for open/closed) — the page stays a server component. The
// row's carry / dispersion / confidence rendering is UNCHANGED from 3a; this
// only adds the chevron + the inline dossier card below. Display only: no SG
// compute, no LLM, no API key (invariant #1 / #3).

function ConfidenceDot({ color }: { color: string }) {
  return <span className="bag-dot" style={{ background: color }} aria-hidden />;
}

/** Trust as a 1–5 pip row; `value` pips filled. Labelled for screen readers. */
function TrustPips({ value }: { value: number }) {
  return (
    <span className="bag-pips" role="img" aria-label={`Trust ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= value ? "bag-pip on" : "bag-pip"} aria-hidden />
      ))}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "bag-chev open" : "bag-chev"}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ClubRow({ c }: { c: BagClubView }) {
  const [open, setOpen] = useState(false);
  const name = clubDisplayName(c.club);
  const band = dispersionBand(c.lateralSdYards);
  const estimated = isDispersionEstimated(c);
  const dossier = CLUB_DOSSIER[name];

  return (
    <li className="bag-item">
      <button
        type="button"
        className="bag-row"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="bag-row-id">
          <span className="bag-club">{name}</span>
          <span className="bag-carry-conf">{carryConfidenceLine(c)}</span>
        </div>

        <div className="bag-carry">
          <span className="bag-carry-num">{c.carryYards}</span>
          <span className="bag-carry-unit">yd</span>
        </div>

        <div className={estimated ? "bag-disp is-est" : "bag-disp"}>
          <div className="bag-disp-head">
            <ConfidenceDot color={band.color} />
            <span className="bag-disp-word" style={{ color: band.color }}>
              {band.word}
            </span>
            <span className="bag-disp-val">
              ±{c.lateralSdYards} yd{estimated ? " est." : ""}
            </span>
          </div>
          <div className="bag-bar">
            <span
              className="bag-bar-fill"
              style={{ width: `${Math.round(band.fill * 100)}%`, background: band.color }}
            />
          </div>
        </div>

        <Chevron open={open} />
      </button>

      {open ? (
        <div className="bag-dossier">
          {dossier ? (
            <>
              <div className="bag-doss-sec">
                <span className="bag-doss-lbl">Equipment</span>
                <p className="bag-doss-eq">{equipmentLine(dossier)}</p>
              </div>

              <div className="bag-doss-sec">
                <span className="bag-doss-lbl">Feel &amp; tendencies</span>
                <dl className="bag-doss-feel">
                  <div className="bag-doss-line">
                    <dt>Trust</dt>
                    <dd>
                      <TrustPips value={dossier.trust} />
                    </dd>
                  </div>
                  <div className="bag-doss-line">
                    <dt>Shape</dt>
                    <dd>{dossier.shape}</dd>
                  </div>
                  <div className="bag-doss-line">
                    <dt>Feared miss</dt>
                    <dd>{dossier.fearedMiss}</dd>
                  </div>
                </dl>
              </div>
            </>
          ) : null}

          <div className="bag-doss-sec">
            <span className="bag-doss-lbl">Sample</span>
            <p className="bag-doss-sample">
              Based on {c.shotCount} shots
              {c.lastSession ? <> · captured {formatSessionDate(c.lastSession)}</> : null}
            </p>
          </div>

          {dossier ? <p className="bag-doss-note">{dossier.note}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
