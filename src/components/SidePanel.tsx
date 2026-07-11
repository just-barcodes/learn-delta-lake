import type { TableState } from "../domain/types";
import { CommitLog } from "./sidepanel/CommitLog";
import { Legend } from "./sidepanel/Legend";
import { StatGrid } from "./sidepanel/StatGrid";
import { WhatHappened } from "./sidepanel/WhatHappened";
import "./sidepanel.css";

interface Props {
  state: TableState;
}

export function SidePanel({ state }: Props) {
  return (
    <aside className="sidepanel">
      <WhatHappened lastStep={state.lastStep} level={state.level} />
      <StatGrid state={state} />
      <Legend level={state.level} />
      <CommitLog log={state.log} />
    </aside>
  );
}
