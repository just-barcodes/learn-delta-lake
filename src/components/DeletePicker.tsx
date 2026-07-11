import type { Action } from "../domain/reducer";
import type { TableState } from "../domain/types";
import { buildPicker } from "../viewmodel/picker";
import { Modal } from "./Modal";
import "./picker.css";

interface Props {
  state: TableState;
  dispatch: (action: Action) => void;
}

/** Modal for choosing rows to delete (copy-on-write rewrite or deletion vector). */
export function DeletePicker({ state, dispatch }: Props) {
  const model = buildPicker(state);
  if (!model) return null;
  const cancel = () => dispatch({ type: "cancelPicker" });
  const canDelete = model.count > 0;
  const subtitle =
    state.deleteMode === "dv"
      ? "Pick rows to mask; a deletion vector will mark them (merge-on-read)"
      : "Pick rows to delete; the files holding them will be rewritten (copy-on-write)";

  return (
    <Modal onClose={cancel} width={560}>
      <div className="modal-head">
        <span className="pill node--remove">DELETE</span>
        <div className="modal-head__titles">
          <div className="modal-head__title">Delete rows</div>
          <div className="modal-head__subtitle">{subtitle}</div>
        </div>
        <button type="button" className="modal-close" aria-label="Close" onClick={cancel}>
          ×
        </button>
      </div>

      <div className="picker__cols">
        <span className="picker__check-col" />
        <span className="picker__id-col">id</span>
        <span className="picker__customer-col">customer</span>
        <span className="picker__amount-col">amount</span>
        <span className="picker__status-col">status</span>
        <span className="picker__file-col">file</span>
      </div>

      <div className="picker__rows">
        {model.rows.map((r) => (
          <div
            key={r.oid}
            className={"picker__row" + (r.checked ? " is-checked" : "")}
            onClick={() => dispatch({ type: "togglePick", oid: r.oid, file: r.file })}
          >
            <span className="picker__box">{r.checked ? "✓" : ""}</span>
            <span className="picker__id-col picker__mono">{r.oid}</span>
            <span className="picker__customer-col picker__ellipsis">{r.customer}</span>
            <span className="picker__amount-col picker__mono">{r.amount}</span>
            <span className="picker__status-col picker__muted">{r.status}</span>
            <span className="picker__file-col picker__file">{r.file}.parquet</span>
          </div>
        ))}
      </div>

      <div className="picker__footer">
        <div className="picker__random">
          <button
            type="button"
            className="picker__random-btn"
            onClick={() => dispatch({ type: "randomPick" })}
          >
            Select random
          </button>
          <input
            type="text"
            inputMode="numeric"
            className="picker__random-input"
            value={model.randomN}
            aria-label="Random count"
            onChange={(e) => dispatch({ type: "setRandomN", value: e.target.value })}
          />
          <span className="picker__of">of {model.liveCount}</span>
        </div>
        <span className="picker__count">
          <b>{model.count}</b> selected
        </span>
        <div className="picker__spacer" />
        <button type="button" className="picker__cancel" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className={"picker__confirm" + (canDelete ? " is-enabled" : "")}
          disabled={!canDelete}
          onClick={() => dispatch({ type: "confirmDelete" })}
        >
          {canDelete ? `Delete ${model.count} row${model.count === 1 ? "" : "s"}` : "Select rows"}
        </button>
      </div>
    </Modal>
  );
}
