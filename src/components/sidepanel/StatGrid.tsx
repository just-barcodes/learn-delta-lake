import type { CSSProperties } from "react";
import type { TableState } from "../../domain/types";
import { buildStats } from "../../viewmodel/panels";

interface Props {
  state: TableState;
}

/** The 2-column grid of headline table counts. */
export function StatGrid({ state }: Props) {
  const stats = buildStats(state);
  return (
    <div className="stat-grid">
      {stats.map((s) => (
        <div key={s.label} className="stat">
          <div className="stat__value" style={{ color: s.colorVar } as CSSProperties}>
            {s.value}
          </div>
          <div className="stat__label">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
