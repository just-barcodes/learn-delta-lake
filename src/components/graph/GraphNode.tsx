import type { Action } from "../../domain/reducer";
import type { GraphNodeVM } from "../../viewmodel/graph";
import { useRegisterNode } from "./nodeRegistry";

interface Props {
  node: GraphNodeVM;
  dispatch: (action: Action) => void;
}

/** One card in the graph. Color comes from `node--{kind}`; state from modifier classes. */
export function GraphNode({ node, dispatch }: Props) {
  const register = useRegisterNode();
  const className = [
    "node",
    `node--${node.kind}`,
    node.inactive && "is-inactive",
    node.pruned && "is-pruned",
    node.scanned && "is-scanned",
    node.current && "is-current",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      ref={register(node.id)}
      className={className}
      onClick={() => dispatch(node.action)}
    >
      <div className="node__head">
        <span className="pill">{node.pill}</span>
        {node.tag ? (
          <span className={node.tagVariant === "neutral" ? "tag tag--neutral" : "tag"}>
            {node.tag}
          </span>
        ) : null}
      </div>
      <div className="node__name-row">
        <span className="node__name">{node.name}</span>
        {node.meta ? <span className="node__meta">{node.meta}</span> : null}
      </div>
      {node.sub ? <div className="node__sub">{node.sub}</div> : null}
      {node.note ? <div className="node__note">{node.note}</div> : null}
      {node.hint ? <div className="node__hint">{node.hint} ↵</div> : null}
    </button>
  );
}
