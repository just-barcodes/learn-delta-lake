import * as ops from "./operations";
import type { DeleteMode, DetailLevel, NodeKind, QueryColumn, QueryOp, TableState } from "./types";

/** Every way the table state can change, as a discriminated union. */
export type Action =
  | { type: "append" }
  | { type: "openDelete" }
  | { type: "openUpdate" }
  | { type: "confirmUpdate" }
  | { type: "togglePick"; oid: number; file: string }
  | { type: "setRandomN"; value: string }
  | { type: "randomPick" }
  | { type: "cancelPicker" }
  | { type: "confirmDelete" }
  | { type: "optimize" }
  | { type: "vacuum" }
  | { type: "checkpoint" }
  | { type: "evolveSchema" }
  | { type: "reset" }
  | { type: "setLevel"; level: DetailLevel }
  | { type: "setDeleteMode"; mode: DeleteMode }
  | { type: "jumpCurrent" }
  | { type: "selectVersion"; version: number }
  | { type: "openInspect"; kind: NodeKind; id: string | null }
  | { type: "closeInspect" }
  | { type: "rowsInc" }
  | { type: "rowsDec" }
  | { type: "rowsInput"; value: string }
  | { type: "setQueryCol"; col: QueryColumn }
  | { type: "setQueryOp"; op: QueryOp }
  | { type: "setQueryVal"; value: string }
  | { type: "runQuery" }
  | { type: "clearQuery" };

export function reducer(state: TableState, action: Action): TableState {
  switch (action.type) {
    case "append":
      return ops.append(state);
    case "openDelete":
      return ops.openDelete(state);
    case "openUpdate":
      return ops.openUpdate(state);
    case "confirmUpdate":
      return ops.confirmUpdate(state);
    case "togglePick":
      return ops.togglePick(state, action.oid, action.file);
    case "setRandomN":
      return ops.setRandomN(state, action.value);
    case "randomPick":
      return ops.randomPick(state);
    case "cancelPicker":
      return ops.cancelPicker(state);
    case "confirmDelete":
      return ops.confirmDelete(state);
    case "optimize":
      return ops.optimize(state);
    case "vacuum":
      return ops.vacuum(state);
    case "checkpoint":
      return ops.checkpoint(state);
    case "evolveSchema":
      return ops.evolveSchema(state);
    case "reset":
      return ops.reset(state);
    case "setLevel":
      return ops.setLevel(state, action.level);
    case "setDeleteMode":
      return ops.setDeleteMode(state, action.mode);
    case "jumpCurrent":
      return ops.jumpCurrent(state);
    case "selectVersion":
      return ops.selectVersion(state, action.version);
    case "openInspect":
      return ops.openInspect(state, action.kind, action.id);
    case "closeInspect":
      return ops.closeInspect(state);
    case "rowsInc":
      return ops.rowsInc(state);
    case "rowsDec":
      return ops.rowsDec(state);
    case "rowsInput":
      return ops.rowsInput(state, action.value);
    case "setQueryCol":
      return ops.setQueryCol(state, action.col);
    case "setQueryOp":
      return ops.setQueryOp(state, action.op);
    case "setQueryVal":
      return ops.setQueryVal(state, action.value);
    case "runQuery":
      return ops.runQuery(state);
    case "clearQuery":
      return ops.clearQuery(state);
  }
}
