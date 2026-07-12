import type { Action } from "../domain/reducer";
import type { TableState } from "../domain/types";
import { buildPicker } from "../viewmodel/picker";
import { Modal } from "./Modal";
import "./picker.css";

interface Props {
  state: TableState;
  dispatch: (action: Action) => void;
}

/** Modal for picking rows to DELETE or UPDATE (copy-on-write rewrite or deletion vector). */
export function DeletePicker({ state, dispatch }: Props) {
  const model = buildPicker(state);
  if (!model) return null;
  const cancel = () => dispatch({ type: "cancelPicker" });
  const update = model.mode === "update";
  const canApply = model.count > 0;
  const dv = state.deleteMode === "dv";
  const subtitle = update
    ? dv
      ? "Pick rows to update; a deletion vector masks the old rows and a small file holds the new ones"
      : "Pick rows to update; the files holding them will be rewritten with the new values (copy-on-write)"
    : dv
      ? "Pick rows to mask; a deletion vector will mark them (merge-on-read)"
      : "Pick rows to delete; the files holding them will be rewritten (copy-on-write)";
  const verb = update ? "Update" : "Delete";
  const confirm = () => dispatch({ type: update ? "confirmUpdate" : "confirmDelete" });

  return (
    <Modal onClose={cancel} width={560}>
      <div className="modal-head">
        <span className={"pill " + (update ? "node--data" : "node--remove")}>
          {verb.toUpperCase()}
        </span>
        <div className="modal-head__titles">
          <div className="modal-head__title">{verb} rows</div>
          <div className="modal-head__subtitle">{subtitle}</div>
        </div>
        <button type="button" className="modal-close" aria-label="Close" onClick={cancel}>
          ×
        </button>
      </div>

      <div className={"picker" + (update ? " picker--update" : "")}>
        <div className="picker__cols">
          <span className="picker__check-col" />
          <span className="picker__id-col">order_id</span>
          {model.cols.map((c) => (
            <span
              key={c.label}
              className={"picker__cell" + (c.align === "right" ? " picker__cell--right" : "")}
            >
              {c.label}
            </span>
          ))}
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
              {r.cells.map((cell, i) => (
                <span
                  key={i}
                  className={
                    "picker__cell" +
                    (cell.align === "right" ? " picker__cell--right" : "") +
                    (cell.mono ? " picker__mono" : " picker__ellipsis")
                  }
                >
                  {cell.value}
                </span>
              ))}
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
            className={"picker__confirm" + (canApply ? " is-enabled" : "")}
            disabled={!canApply}
            onClick={confirm}
          >
            {canApply ? `${verb} ${model.count} row${model.count === 1 ? "" : "s"}` : "Select rows"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
