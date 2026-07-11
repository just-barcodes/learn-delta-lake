import { useCallback, useMemo, useRef } from "react";
import type { Action } from "../../domain/reducer";
import type { TableState } from "../../domain/types";
import { buildGraph } from "../../viewmodel/graph";
import { Connectors } from "./Connectors";
import { GraphColumn } from "./GraphColumn";
import { GraphNode } from "./GraphNode";
import { NodeRegistryContext, type RegisterNode } from "./nodeRegistry";
import "./graph.css";

interface Props {
  state: TableState;
  dispatch: (action: Action) => void;
  themeKey: string;
}

/** The scrollable node graph: Table → transaction log → actions → files, wired by SVG connectors. */
export function GraphCanvas({ state, dispatch, themeKey }: Props) {
  const mapRef = useRef<Map<string, HTMLElement>>(new Map());
  const innerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const register = useCallback<RegisterNode>(
    (id) => (el) => {
      if (el) mapRef.current.set(id, el);
      else mapRef.current.delete(id);
    },
    [],
  );

  const g = useMemo(() => buildGraph(state), [state]);
  // Simple hides the delta-actions layer to teach the "version = a set of files" model first.
  const showActions = state.level !== "simple";

  return (
    <div className="graph-scroll">
      <div className="graph-inner" ref={innerRef}>
        <svg className="graph-lines" ref={svgRef} aria-hidden="true" />
        <NodeRegistryContext.Provider value={register}>
          <GraphColumn title="Table">
            <GraphNode node={g.tableNode} dispatch={dispatch} />
          </GraphColumn>
          <GraphColumn title="Transaction log" count={g.counts.version}>
            {g.logNodes.map((n) => (
              <GraphNode key={n.id} node={n} dispatch={dispatch} />
            ))}
          </GraphColumn>
          {showActions ? (
            <GraphColumn title="Actions" count={g.counts.action}>
              {g.actionNodes.map((n) => (
                <GraphNode key={n.id} node={n} dispatch={dispatch} />
              ))}
            </GraphColumn>
          ) : null}
          <GraphColumn title="Data files & DVs" count={g.counts.file}>
            {g.fileNodes.map((n) => (
              <GraphNode key={n.id} node={n} dispatch={dispatch} />
            ))}
          </GraphColumn>
        </NodeRegistryContext.Provider>
      </div>
      <Connectors
        state={state}
        themeKey={themeKey}
        mapRef={mapRef}
        innerRef={innerRef}
        svgRef={svgRef}
      />
    </div>
  );
}
