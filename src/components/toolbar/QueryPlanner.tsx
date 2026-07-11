import { planQuery } from "../../domain/query";
import type { Action } from "../../domain/reducer";
import type { QueryColumn, QueryOp, TableState } from "../../domain/types";

interface Props {
  state: TableState;
  dispatch: (action: Action) => void;
}

const COLUMNS: QueryColumn[] = ["order_id", "amount", "order_date"];
const OPS: QueryOp[] = ["=", ">", ">=", "<", "<="];

const PLACEHOLDER: Record<QueryColumn, string> = {
  order_id: "1050",
  amount: "500",
  order_date: "2026-02",
};

/** WHERE-clause builder that shows how a file's stored stats skip files at scan time. */
export function QueryPlanner({ state, dispatch }: Props) {
  const { q, qActive } = state;
  const isDate = q.col === "order_date";
  const canRun = q.val !== "";
  const active = qActive && q.val !== "";
  const result = planQuery(state);

  return (
    <div className="query">
      <span className="action__row">
        <span className="action__dot" />
        <span className="action__label">
          <span className="action__title">Query planner</span>
          <span className="action__desc">data skipping by stats</span>
        </span>
      </span>
      <span className="query__divider" />
      <span className="query__clause">
        <span>WHERE</span>
        <select
          className="query__select"
          value={q.col}
          aria-label="Filter column"
          onChange={(e) => dispatch({ type: "setQueryCol", col: e.target.value as QueryColumn })}
        >
          {COLUMNS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {isDate ? (
          <span className="query__eq">=</span>
        ) : (
          <select
            className="query__select"
            value={q.op}
            aria-label="Comparison operator"
            onChange={(e) => dispatch({ type: "setQueryOp", op: e.target.value as QueryOp })}
          >
            {OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          className="query__input"
          value={q.val}
          placeholder={PLACEHOLDER[q.col]}
          aria-label="Filter value"
          onChange={(e) => dispatch({ type: "setQueryVal", value: e.target.value })}
        />
      </span>
      <button
        type="button"
        className="query__run"
        disabled={!canRun}
        onClick={() => dispatch({ type: "runQuery" })}
      >
        Run
      </button>
      {active ? (
        <button
          type="button"
          className="query__clear"
          onClick={() => dispatch({ type: "clearQuery" })}
        >
          Clear
        </button>
      ) : null}
      {result ? (
        <span className="query__result">
          <b className="query__result-scan">
            {result.scanned}/{result.total}
          </b>
          &nbsp;scanned · <b className="query__result-pruned">{result.pruned}</b>
          &nbsp;skipped · <b>{result.rows}</b>&nbsp;rows
        </span>
      ) : null}
    </div>
  );
}
