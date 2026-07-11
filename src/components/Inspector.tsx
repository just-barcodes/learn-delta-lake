import type { Action } from "../domain/reducer";
import type { TableState } from "../domain/types";
import {
  buildInspector,
  type GridColumn,
  type GridRow,
  type Summary,
} from "../viewmodel/inspector";
import { Modal, ModalHeader } from "./Modal";
import "./inspector.css";

interface Props {
  state: TableState;
  dispatch: (action: Action) => void;
}

/** The node inspector modal. Renders a row grid or a JSON view by node kind. */
export function Inspector({ state, dispatch }: Props) {
  const m = buildInspector(state);
  if (!m.open) return null;
  const close = () => dispatch({ type: "closeInspect" });

  return (
    <Modal onClose={close} width={640}>
      <ModalHeader
        pillKind={m.pillKind}
        pill={m.pill}
        title={m.title}
        subtitle={m.subtitle}
        mono
        onClose={close}
      />
      <div className="modal-body">
        {m.view === "grid" ? (
          <GridView caption={m.caption} cols={m.cols} rows={m.rows} stats={m.stats} />
        ) : (
          <JsonView
            caption={m.caption}
            jsonText={m.jsonText}
            summary={m.summary}
            deletedList={m.deletedList}
            showRaw={m.showRaw}
            dispatch={dispatch}
          />
        )}
      </div>
    </Modal>
  );
}

function GridView({
  caption,
  cols,
  rows,
  stats,
}: {
  caption: string;
  cols: GridColumn[];
  rows: GridRow[];
  stats: string | null;
}) {
  return (
    <>
      <div className="inspector-caption">{caption}</div>
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.label} className={`grid__th grid__th--${c.align}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.deleted ? "grid__row--deleted" : undefined}>
                {r.cells.map((cell, j) => (
                  <td
                    key={j}
                    className={[
                      "grid__td",
                      `grid__td--${cell.align}`,
                      cell.mono && "grid__td--mono",
                      r.deleted && "grid__td--struck",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {cell.value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {stats ? <div className="inspector-stats">{stats}</div> : null}
    </>
  );
}

/** The shared "At a glance" facts + jump-to links block. */
function SummarySection({
  summary,
  dispatch,
}: {
  summary: Summary | null;
  dispatch: (action: Action) => void;
}) {
  if (!summary) return null;
  return (
    <>
      <div className="inspector-section">At a glance</div>
      <div className="facts">
        {summary.facts.map((f) => (
          <div key={f.k} className="fact">
            <div className="fact__k">{f.k}</div>
            <div className="fact__v">{f.v}</div>
          </div>
        ))}
      </div>
      {summary.links.length > 0 ? (
        <div className="jump-links">
          <span className="jump-links__label">Jump to</span>
          {summary.links.map((l, i) => (
            <button
              key={i}
              type="button"
              className={`jump-link node--${l.kind}`}
              onClick={() => dispatch({ type: "openInspect", kind: l.kind, id: l.id })}
            >
              {l.label} <span className="jump-link__arrow">→</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function JsonView({
  caption,
  jsonText,
  summary,
  deletedList,
  showRaw,
  dispatch,
}: {
  caption: string;
  jsonText: string;
  summary: Summary | null;
  deletedList: string | null;
  showRaw: boolean;
  dispatch: (action: Action) => void;
}) {
  return (
    <>
      <SummarySection summary={summary} dispatch={dispatch} />
      {summary && showRaw ? <div className="inspector-section">Raw file</div> : null}
      {showRaw || !summary ? <div className="inspector-caption">{caption}</div> : null}
      {showRaw ? <pre className="json">{jsonText}</pre> : null}
      {deletedList ? (
        <div className="inspector-deleted">
          Masks order_id → <span className="inspector-deleted__ids">{deletedList}</span>
        </div>
      ) : null}
    </>
  );
}
