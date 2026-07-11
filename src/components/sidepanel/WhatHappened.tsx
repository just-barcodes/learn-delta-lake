import type { DetailLevel, LastStep } from "../../domain/types";
import { ACCENT_VAR } from "../../viewmodel/panels";

interface Props {
  lastStep: LastStep;
  level: DetailLevel;
}

/** The "What just happened" explainer card that narrates the most recent commit. */
export function WhatHappened({ lastStep, level }: Props) {
  const accent = ACCENT_VAR[lastStep.op];
  // Simple keeps just the narrative; the mechanistic bullets appear from medium on.
  const showBullets = level !== "simple" && lastStep.bullets.length > 0;
  return (
    <div className="whathappened" style={{ ["--accent" as string]: accent }}>
      <div className="whathappened__eyebrow">
        <span className="whathappened__dot" />
        <span>What just happened</span>
      </div>
      <div className="whathappened__title">{lastStep.title}</div>
      <div className="whathappened__body">{lastStep.body}</div>
      {showBullets ? (
        <ul className="whathappened__bullets">
          {lastStep.bullets.map((b, i) => (
            <li key={i}>
              <span className="whathappened__bullet-mark">·</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
