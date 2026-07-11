import type { DetailLevel } from "../../domain/types";
import { legendFor } from "../../viewmodel/panels";

interface Props {
  level: DetailLevel;
}

/** Colour key for the entity kinds visible at this level, plus the time-travel pointer. */
export function Legend({ level }: Props) {
  return (
    <div className="panel-card">
      <div className="panel-card__head">Legend</div>
      <div className="legend">
        {legendFor(level).map((l) => (
          <div key={l.kind} className="legend__row">
            <span className={`legend__swatch node--${l.kind}`} />
            <span className="legend__text">
              <b>{l.name}</b>: {l.desc}
            </span>
          </div>
        ))}
        <div className="legend__row">
          <span className="legend__swatch legend__swatch--pointer" />
          <span className="legend__text">
            <b>Current pointer</b>: while time-travelling
          </span>
        </div>
      </div>
    </div>
  );
}
