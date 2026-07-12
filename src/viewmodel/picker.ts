import { liveFilesAt } from "../domain/replay";
import { fieldInSchema, SCHEMA_DEFS } from "../domain/schemas";
import type { OrderRecord, TableState } from "../domain/types";

export interface PickerCell {
  value: string;
  align: "left" | "right";
  mono: boolean;
}

export interface PickerRow {
  oid: number;
  /** Non-id column values, projected through the current schema (order matches `cols`). */
  cells: PickerCell[];
  file: string;
  checked: boolean;
}

export interface PickerModel {
  mode: "delete" | "update";
  /** Non-id column headers, from the current schema (order_id is always the first, fixed column). */
  cols: { label: string; align: "left" | "right" }[];
  rows: PickerRow[];
  liveCount: number;
  count: number;
  randomN: number | "";
}

/** The list of live rows offered in the picker, or null when it is closed. */
export function buildPicker(state: TableState): PickerModel | null {
  if (!state.picker) return null;
  const files = liveFilesAt(state, state.current);
  // Project through the table's current schema, minus order_id (rendered as a fixed column).
  const fields = SCHEMA_DEFS[state.schemaId].fields.filter((f) => f.key !== "order_id");
  const cols = fields.map((f) => ({ label: f.name, align: f.align }));
  const raw: { rec: OrderRecord; schemaId: number; file: string }[] = [];
  for (const [fid, dvId] of files) {
    const f = state.dataFiles[fid];
    if (!f) continue;
    const masked = dvId ? new Set(state.deletionVectors[dvId]?.deletedIds ?? []) : null;
    for (const r of f.records) {
      if (!(masked && masked.has(r.order_id))) raw.push({ rec: r, schemaId: f.schemaId, file: fid });
    }
  }
  raw.sort((a, b) => a.rec.order_id - b.rec.order_id);
  const sel = state.picker.selected;
  return {
    mode: state.picker.mode,
    cols,
    rows: raw.map(({ rec, schemaId, file }) => ({
      oid: rec.order_id,
      file,
      checked: !!sel[rec.order_id],
      cells: fields.map((f) => ({
        value: fieldInSchema(f.id, schemaId) ? String(rec[f.key]) : "null",
        align: f.align,
        mono: f.mono,
      })),
    })),
    liveCount: raw.length,
    count: Object.keys(sel).length,
    randomN: state.picker.n === "" ? "" : state.picker.n || 3,
  };
}
