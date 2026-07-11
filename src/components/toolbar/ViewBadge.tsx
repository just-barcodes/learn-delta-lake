import type { Action } from "../../domain/reducer";
import type { TableState } from "../../domain/types";

interface Props {
  state: TableState;
  dispatch: (action: Action) => void;
}

/** Shows whether you are viewing the current version or time-travelling to an old one. */
export function ViewBadge({ state, dispatch }: Props) {
  const isViewingOld = state.selected !== state.current;
  return (
    <div className={"view-badge" + (isViewingOld ? " view-badge--old" : "")}>
      <span className="view-badge__label">{isViewingOld ? "TIME TRAVEL" : "VIEWING"}</span>
      <span className="view-badge__value">v{state.selected}</span>
      {isViewingOld ? (
        <button
          type="button"
          className="view-badge__jump"
          onClick={() => dispatch({ type: "jumpCurrent" })}
        >
          jump to current →
        </button>
      ) : null}
    </div>
  );
}
