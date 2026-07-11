import { deletedIdsAt, liveFilesAt } from "../domain/replay";
import type { TableState } from "../domain/types";

export interface PickerRow {
  oid: number;
  customer: string;
  amount: string;
  status: string;
  file: string;
  checked: boolean;
}

export interface PickerModel {
  rows: PickerRow[];
  liveCount: number;
  count: number;
  randomN: number | "";
}

/** The list of live rows offered in the delete picker, or null when it is closed. */
export function buildPicker(state: TableState): PickerModel | null {
  if (!state.picker) return null;
  const files = liveFilesAt(state, state.current);
  const del = deletedIdsAt(state, state.current);
  const raw: { oid: number; customer: string; amount: string; status: string; file: string }[] = [];
  for (const fid of files.keys()) {
    for (const r of state.dataFiles[fid]?.records ?? []) {
      if (!del.has(r.order_id)) {
        raw.push({
          oid: r.order_id,
          customer: r.customer,
          amount: r.amount,
          status: r.status,
          file: fid,
        });
      }
    }
  }
  raw.sort((a, b) => a.oid - b.oid);
  const sel = state.picker.selected;
  return {
    rows: raw.map((r) => ({ ...r, checked: !!sel[r.oid] })),
    liveCount: raw.length,
    count: Object.keys(sel).length,
    randomN: state.picker.n === "" ? "" : state.picker.n || 3,
  };
}
