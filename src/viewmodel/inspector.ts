import { tsMs } from "../domain/ids";
import { commitAt, liveFileIds, liveFilesAt, protocolAt, schemaIdAt } from "../domain/replay";
import { GEN_MONTH, TABLE_ID } from "../domain/schema";
import { fieldInSchema, SCHEMA_DEFS, type SchemaField } from "../domain/schemas";
import type { Action, FileStats, NodeKind, OrderRecord, TableState } from "../domain/types";

type Align = "left" | "right";

export interface GridCell {
  value: string;
  align: Align;
  mono: boolean;
}
export interface GridColumn {
  label: string;
  align: Align;
}
export interface GridRow {
  deleted: boolean;
  cells: GridCell[];
}

export interface Fact {
  k: string;
  v: string | number;
}
export interface JumpLink {
  label: string;
  kind: NodeKind;
  id: string | null;
}
export interface Summary {
  facts: Fact[];
  links: JumpLink[];
}

interface Base {
  open: true;
  pillKind: NodeKind;
  pill: string;
  title: string;
  subtitle: string;
}

export type InspectorModel =
  | { open: false }
  | (Base & {
      view: "grid";
      caption: string;
      cols: GridColumn[];
      rows: GridRow[];
      stats: string | null;
    })
  | (Base & {
      view: "json";
      caption: string;
      jsonText: string;
      summary: Summary | null;
      deletedList: string | null;
      /** Whether to show the raw JSON block (advanced only). */
      showRaw: boolean;
    });

/** A record paired with the schema version of the file it came from (for schema-on-read). */
interface TaggedRecord {
  rec: OrderRecord;
  schemaId: number;
}

/** Materialize a version's rows, tagged with each row's source-file schema version. */
function materializeTagged(
  state: TableState,
  version: number,
): { live: TaggedRecord[]; deleted: TaggedRecord[] } {
  const files = liveFilesAt(state, version);
  const live: TaggedRecord[] = [];
  const deleted: TaggedRecord[] = [];
  for (const [path, dvId] of files) {
    const f = state.dataFiles[path];
    if (!f) continue;
    const masked = dvId ? new Set(state.deletionVectors[dvId]?.deletedIds ?? []) : null;
    for (const r of f.records) {
      (masked && masked.has(r.order_id) ? deleted : live).push({ rec: r, schemaId: f.schemaId });
    }
  }
  return { live, deleted };
}

/** Grid header columns for a schema version's fields, in order. */
function gridCols(fields: SchemaField[]): GridColumn[] {
  return fields.map((f) => ({ label: f.name, align: f.align }));
}

/**
 * Project one record through the active schema. A field the record's source file
 * predates (added later) reads back as "null": Delta resolves files by column id, so
 * a rename just relabels the same column and an added column backfills null.
 */
function projectCells(t: TaggedRecord, fields: SchemaField[]): GridCell[] {
  return fields.map((f) => ({
    value: fieldInSchema(f.id, t.schemaId) ? String(t.rec[f.key]) : "null",
    align: f.align,
    mono: f.mono,
  }));
}

/** Sort tagged records by id, project through `fields`, and mark deleted rows. */
function gridRows(
  records: TaggedRecord[],
  deletedSet: Set<number> | null,
  fields: SchemaField[],
): GridRow[] {
  return records
    .slice()
    .sort((a, b) => a.rec.order_id - b.rec.order_id)
    .map((r) => ({
      deleted: !!(deletedSet && deletedSet.has(r.rec.order_id)),
      cells: projectCells(r, fields),
    }));
}

/** Delta's inline `stats` object as written into an `add` action. */
function statsObject(f: FileStats) {
  return {
    numRecords: f.numRecords,
    minValues: f.min,
    maxValues: f.max,
    nullCount: f.nullCount,
  };
}

/** The on-disk JSON shape of one commit action (one line of the _delta_log file). */
function actionObject(a: Action, state: TableState): object {
  switch (a.kind) {
    case "protocol":
      return {
        protocol: {
          minReaderVersion: a.minReader,
          minWriterVersion: a.minWriter,
          ...(a.features.length ? { readerFeatures: a.features, writerFeatures: a.features } : {}),
        },
      };
    case "metaData": {
      const def = SCHEMA_DEFS[a.schemaId];
      const cm = !!protocolAt(state, state.selected)?.features.includes("columnMapping");
      const field = (
        id: number,
        name: string,
        type: string,
        nullable: boolean,
        generated?: string,
      ) => ({
        name,
        type,
        nullable,
        metadata: {
          ...(generated ? { "delta.generationExpression": generated } : {}),
          ...(cm
            ? { "delta.columnMapping.id": id, "delta.columnMapping.physicalName": "col-" + id }
            : {}),
        },
      });
      return {
        metaData: {
          id: TABLE_ID,
          format: { provider: "parquet", options: {} },
          schemaString: JSON.stringify({
            type: "struct",
            fields: [
              ...def.fields.map((f) => field(f.id, f.name, f.type, f.nullable)),
              field(
                def.maxColumnId + 1,
                GEN_MONTH.name,
                GEN_MONTH.type,
                GEN_MONTH.nullable,
                GEN_MONTH.generated,
              ),
            ],
          }),
          partitionColumns: a.partitionBy,
          configuration: cm
            ? {
                "delta.columnMapping.mode": "name",
                "delta.columnMapping.maxColumnId": String(def.maxColumnId),
              }
            : {},
        },
      };
    }
    case "add": {
      const f = state.dataFiles[a.path];
      return {
        add: {
          path: a.path + ".parquet",
          partitionValues: { order_month: f?.partition ?? "" },
          size: (f?.size ?? 1) * 100000,
          modificationTime: tsMs(f?.born ?? 0),
          dataChange: a.dataChange,
          ...(f ? { stats: JSON.stringify(statsObject(f.stats)) } : {}),
          ...(a.dv
            ? {
                deletionVector: {
                  storageType: "u",
                  pathOrInlineDv: a.dv + ".bin",
                  cardinality: state.deletionVectors[a.dv]?.deletedIds.length ?? 0,
                },
              }
            : {}),
        },
      };
    }
    case "remove":
      return {
        remove: {
          path: a.path + ".parquet",
          deletionTimestamp: tsMs(state.current),
          dataChange: a.dataChange,
        },
      };
    case "commitInfo":
      return {
        commitInfo: {
          timestamp: tsMs(state.selected),
          operation: a.operation,
          operationMetrics: a.metrics,
        },
      };
  }
}

/** Build the inspector modal's contents for whatever node is being inspected. */
export function buildInspector(state: TableState): InspectorModel {
  if (!state.inspect) return { open: false };
  const { kind, id } = state.inspect;
  const advanced = state.level === "advanced";
  // Grids project through the schema in effect at the version being viewed (schema-on-read).
  const selSchemaId = schemaIdAt(state, state.selected);
  const fields = SCHEMA_DEFS[selSchemaId].fields;
  const cols = gridCols(fields);

  if (kind === "table") {
    const { live, deleted } = materializeTagged(state, state.selected);
    const all = [...live, ...deleted];
    const dset = new Set(deleted.map((t) => t.rec.order_id));
    const dfCount = liveFileIds(state, state.selected).size;
    return {
      open: true,
      pillKind: "version",
      pill: "TABLE",
      title: "orders",
      subtitle: "materialized table @ v" + state.selected + " · schema-v" + selSchemaId,
      view: "grid",
      cols,
      rows: gridRows(all, dset, fields),
      caption: deleted.length
        ? live.length +
          " live rows. " +
          deleted.length +
          " row(s) are masked by deletion vectors (shown struck through); this happens at read time."
        : live.length + " live rows, materialized from " + dfCount + " data file(s).",
      stats: null,
    };
  }

  if (kind === "version") {
    const cmt = commitAt(state, Number(id));
    if (!cmt) return { open: false };
    const adds = cmt.actions.filter((a) => a.kind === "add");
    const removes = cmt.actions.filter((a) => a.kind === "remove");
    const obj = cmt.actions.map((a) => actionObject(a, state));
    const links: JumpLink[] = [];
    for (const a of cmt.actions) {
      if (a.kind === "add" || a.kind === "remove") {
        links.push({ label: a.path + ".parquet", kind: "data", id: a.path });
      }
    }
    links.push({ label: "orders table", kind: "table", id: null });
    return {
      open: true,
      pillKind: "version",
      pill: "JSON",
      title: String(cmt.version).padStart(20, "0") + ".json",
      subtitle: "commit " + cmt.version + " · " + cmt.op,
      view: "json",
      caption:
        "One commit file in _delta_log/. It lists the actions applied at this version — the delta on top of the previous version, not the full table.",
      jsonText: JSON.stringify(obj, null, 2),
      summary: {
        facts: [
          { k: "operation", v: cmt.op },
          { k: "version", v: cmt.version },
          { k: "actions", v: cmt.actions.length },
          { k: "adds", v: adds.length },
          { k: "removes", v: removes.length },
        ],
        links,
      },
      deletedList: null,
      showRaw: advanced,
    };
  }

  if (kind === "data") {
    const f = id ? state.dataFiles[id] : undefined;
    if (!f) return { open: false };
    const activeDv = liveFilesAt(state, state.selected).get(f.id);
    const masked = activeDv ? new Set(state.deletionVectors[activeDv]?.deletedIds ?? []) : null;
    const tagged = f.records.map((r) => ({ rec: r, schemaId: f.schemaId }));
    const olderSchema = f.schemaId < selSchemaId;
    return {
      open: true,
      pillKind: "data",
      pill: "PARQUET",
      title: f.id + ".parquet",
      subtitle:
        f.records.length +
        " rows · " +
        f.size +
        " MB · part=" +
        f.partition +
        " · schema-v" +
        f.schemaId +
        (f.optimized ? " · optimized" : "") +
        (activeDv ? " · DV " + activeDv : ""),
      view: "grid",
      cols,
      rows: gridRows(tagged, masked, fields),
      caption: olderSchema
        ? "This file was written under schema-v" +
          f.schemaId +
          ", before the version you are viewing. It is never rewritten: Delta resolves it by column id, so columns added since read back as null and a rename just relabels the same column."
        : activeDv
          ? "Raw contents of this immutable Parquet file. Rows struck through are masked by deletion vector " +
            activeDv +
            " and dropped at read time — the file itself is never edited."
          : "Raw contents of this immutable Parquet file. Delta never edits a data file; deletes rewrite it (copy-on-write) or mask it with a deletion vector.",
      stats: advanced
        ? "add.stats · order_id min " +
          f.stats.min.order_id +
          " max " +
          f.stats.max.order_id +
          " · amount min " +
          f.stats.min.amount +
          " max " +
          f.stats.max.amount +
          " · " +
          f.stats.numRecords +
          " records"
        : null,
    };
  }

  if (kind === "dv") {
    const dv = id ? state.deletionVectors[id] : undefined;
    if (!dv) return { open: false };
    const obj = {
      deletionVector: {
        storageType: "u",
        pathOrInlineDv: dv.id + ".bin",
        offset: 1,
        sizeInBytes: dv.size * 34,
        cardinality: dv.deletedIds.length,
      },
      referencedDataFile: dv.target + ".parquet",
      maskedOrderIds: dv.deletedIds,
    };
    return {
      open: true,
      pillKind: "dv",
      pill: "BIN",
      title: dv.id + ".bin",
      subtitle: "deletion vector → " + dv.target + ".parquet",
      view: "json",
      caption:
        "A deletion vector is a compact bitmap of deleted row positions in one Parquet file. Readers of that file drop these rows on the fly (merge-on-read) — no rewrite needed.",
      jsonText: JSON.stringify(obj, null, 2),
      summary: {
        facts: [
          { k: "masks", v: dv.deletedIds.length + " rows" },
          { k: "target", v: dv.target },
          { k: "born", v: "v" + dv.born },
          { k: "cardinality", v: dv.deletedIds.length },
        ],
        links: [{ label: dv.target + ".parquet", kind: "data", id: dv.target }],
      },
      deletedList: dv.deletedIds.join(", "),
      showRaw: advanced,
    };
  }

  if (kind === "checkpoint") {
    const cp = state.checkpoints.find((c) => c.version === Number(id));
    if (!cp) return { open: false };
    const obj = {
      _last_checkpoint: { version: cp.version, size: cp.size, parts: 1 },
      checkpoint: cp.liveFiles.map((f) => ({
        add: {
          path: f.path + ".parquet",
          ...(f.dv ? { deletionVector: { pathOrInlineDv: f.dv + ".bin" } } : {}),
        },
      })),
    };
    return {
      open: true,
      pillKind: "checkpoint",
      pill: "PARQUET",
      title: String(cp.version).padStart(20, "0") + ".checkpoint.parquet",
      subtitle: "state snapshot @ v" + cp.version,
      view: "json",
      caption:
        "A checkpoint is a Parquet snapshot of all live add actions through this version. _last_checkpoint points here so readers replay only the commits after it, instead of the whole log.",
      jsonText: JSON.stringify(obj, null, 2),
      summary: {
        facts: [
          { k: "version", v: cp.version },
          { k: "live files", v: cp.liveFiles.length },
          { k: "reader start", v: "v" + cp.version },
        ],
        links: cp.liveFiles.map((f) => ({
          label: f.path + ".parquet",
          kind: "data" as const,
          id: f.path,
        })),
      },
      deletedList: null,
      showRaw: advanced,
    };
  }

  return { open: false };
}
