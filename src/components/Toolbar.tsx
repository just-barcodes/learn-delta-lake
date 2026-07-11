import type { Action } from "../domain/reducer";
import type { TableState } from "../domain/types";
import { ActionButton } from "./toolbar/ActionButton";
import { AppendControl } from "./toolbar/AppendControl";
import { DeleteModeToggle } from "./toolbar/DeleteModeToggle";
import { QueryPlanner } from "./toolbar/QueryPlanner";
import { ViewBadge } from "./toolbar/ViewBadge";
import "./toolbar.css";

interface Props {
  state: TableState;
  dispatch: (action: Action) => void;
}

export function Toolbar({ state, dispatch }: Props) {
  const { level } = state;
  const showStructural = level !== "simple";
  const showAdvanced = level === "advanced";
  const deleteDesc =
    state.deleteMode === "dv" ? "deletion vector (MoR)" : "rewrite files (copy-on-write)";

  return (
    <div className="toolbar">
      <div className="toolbar__actions">
        <AppendControl state={state} dispatch={dispatch} />
        <ActionButton
          accent="var(--remove-line)"
          title="Delete rows"
          desc={deleteDesc}
          onClick={() => dispatch({ type: "openDelete" })}
        />
        {showStructural ? (
          <ActionButton
            accent="var(--meta-line)"
            title="Optimize"
            desc="bin-pack small files → one"
            onClick={() => dispatch({ type: "optimize" })}
          />
        ) : null}
        {showStructural ? (
          <ActionButton
            accent="var(--accent-gray)"
            title="Vacuum"
            desc="delete tombstoned files"
            onClick={() => dispatch({ type: "vacuum" })}
          />
        ) : null}
        {showStructural ? (
          <ActionButton
            accent="var(--checkpoint-line)"
            title="Checkpoint"
            desc="snapshot log → reader shortcut"
            onClick={() => dispatch({ type: "checkpoint" })}
          />
        ) : null}
        {showAdvanced ? <DeleteModeToggle state={state} dispatch={dispatch} /> : null}
        {showAdvanced ? <QueryPlanner state={state} dispatch={dispatch} /> : null}
      </div>
      <div className="toolbar__spacer" />
      <ViewBadge state={state} dispatch={dispatch} />
    </div>
  );
}
