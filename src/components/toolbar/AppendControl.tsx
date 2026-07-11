import type { Action } from "../../domain/reducer";
import type { TableState } from "../../domain/types";

interface Props {
  state: TableState;
  dispatch: (action: Action) => void;
}

/** Append action fused with a numeric row-count stepper. */
export function AppendControl({ state, dispatch }: Props) {
  return (
    <div className="append">
      <button type="button" className="append__main" onClick={() => dispatch({ type: "append" })}>
        <span className="action__dot" />
        <span className="action__label">
          <span className="action__title">
            Append <span className="append__count">{state.appendRows}</span> rows
          </span>
          <span className="action__desc">INSERT → new files + version</span>
        </span>
      </button>
      <div className="append__stepper">
        <input
          type="text"
          inputMode="numeric"
          className="append__input"
          value={state.appendRows}
          aria-label="Rows to append"
          onChange={(e) => dispatch({ type: "rowsInput", value: e.target.value })}
        />
        <div className="append__step-btns">
          <button
            type="button"
            className="append__step"
            aria-label="Fewer rows"
            onClick={() => dispatch({ type: "rowsDec" })}
          >
            −
          </button>
          <span className="append__step-divider" />
          <button
            type="button"
            className="append__step"
            aria-label="More rows"
            onClick={() => dispatch({ type: "rowsInc" })}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
