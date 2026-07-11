import type { CSSProperties } from "react";
import type { LogEntry } from "../../domain/types";
import { ACCENT_VAR } from "../../viewmodel/panels";

interface Props {
  log: LogEntry[];
}

/** Chronological list of commits, newest first, colour-coded by operation. */
export function CommitLog({ log }: Props) {
  return (
    <div className="panel-card panel-card--grow">
      <div className="panel-card__head">Commit log</div>
      <div className="commit-log">
        {log.map((e, i) => (
          <div key={i} className="commit-log__row">
            <span
              className="commit-log__badge"
              style={{ background: ACCENT_VAR[e.op] } as CSSProperties}
            >
              v{e.v}
            </span>
            <span className="commit-log__text">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
