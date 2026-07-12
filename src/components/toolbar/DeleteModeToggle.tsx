import type { Action } from "../../domain/reducer";
import type { DeleteMode, TableState } from "../../domain/types";

interface Props {
  state: TableState;
  dispatch: (action: Action) => void;
}

const MODES: { key: DeleteMode; label: string }[] = [
  { key: "cow", label: "copy-on-write" },
  { key: "dv", label: "deletion vectors" },
];

/** Advanced toggle for the physical DELETE strategy (copy-on-write vs. deletion vectors). */
export function DeleteModeToggle({ state, dispatch }: Props) {
  return (
    <div className="delete-mode">
      <span className="delete-mode__label">DELETE / UPDATE writes</span>
      <div className="delete-mode__seg" role="group" aria-label="Delete mode">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={"delete-mode__btn" + (state.deleteMode === m.key ? " is-active" : "")}
            aria-pressed={state.deleteMode === m.key}
            onClick={() => dispatch({ type: "setDeleteMode", mode: m.key })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <span className="delete-mode__note" title="Historically Delta defaulted to copy-on-write; recent versions increasingly enable deletion vectors by default.">
        modern Delta increasingly defaults to DVs
      </span>
    </div>
  );
}
