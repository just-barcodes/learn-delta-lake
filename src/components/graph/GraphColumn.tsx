import type { ReactNode } from "react";

interface Props {
  title: string;
  count?: number;
  children: ReactNode;
}

/** A titled vertical column of nodes, with an optional count chip. */
export function GraphColumn({ title, count, children }: Props) {
  return (
    <div className="graph-col">
      <div className="graph-col__head">
        {title}
        {count != null ? <span className="graph-col__count">{count}</span> : null}
      </div>
      <div className="graph-col__nodes">{children}</div>
    </div>
  );
}
