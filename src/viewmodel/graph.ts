import { prunedSet } from "../domain/query";
import type { Action } from "../domain/reducer";
import { commitAt, liveFilesAt, replayPath } from "../domain/replay";
import type { NodeKind, TableState } from "../domain/types";

/** A single card in the graph. Pure data — styling is entirely CSS. */
export interface GraphNodeVM {
  /** Stable ref id used to anchor connector lines, e.g. "df-d1", "ver-2". */
  id: string;
  kind: NodeKind;
  pill: string;
  name: string;
  sub?: string | null;
  note?: string | null;
  /** Right-aligned metadata (used by data files: "6 rows · 4 MB"). */
  meta?: string | null;
  tag?: string | null;
  /** "kind" tints the tag with the node color; "neutral" is the muted skipped tag. */
  tagVariant?: "kind" | "neutral";
  /** Green "click again for details" affordance on the selected version. */
  hint?: string | null;
  inactive?: boolean;
  pruned?: boolean;
  scanned?: boolean;
  current?: boolean;
  action: Action;
}

export interface GraphModel {
  tableNode: GraphNodeVM;
  /** Version nodes with any checkpoint cards interleaved after the version they cover. */
  logNodes: GraphNodeVM[];
  actionNodes: GraphNodeVM[];
  fileNodes: GraphNodeVM[];
  counts: { version: number; action: number; file: number };
}

const byIdNumeric = (a: { id: string }, b: { id: string }) =>
  a.id.localeCompare(b.id, undefined, { numeric: true });

/** Build every graph card from the current state and the selected version's replay. */
export function buildGraph(state: TableState): GraphModel {
  const simple = state.level === "simple";
  const liveMap = liveFilesAt(state, state.selected);
  const liveIds = new Set(liveMap.keys());
  const activeDvs = new Set([...liveMap.values()].filter((dv): dv is string => !!dv));
  const prunedIds = prunedSet(state);
  const hasCheckpoint = (v: number) => state.checkpoints.some((cp) => cp.version === v);

  const tableNode: GraphNodeVM = {
    id: "table",
    kind: "table",
    pill: "TABLE",
    name: "orders",
    sub: "delta table",
    note: simple ? null : "_delta_log/ + parquet",
    action: { type: "openInspect", kind: "table", id: null },
  };

  // Checkpoint cards appear from medium on; the highest-version one is _last_checkpoint.
  const showCheckpoints = !simple;
  const lastCkptVersion = state.checkpoints.reduce((m, cp) => Math.max(m, cp.version), -1);

  // Version nodes, with a checkpoint card interleaved after any version it snapshots.
  const logNodes: GraphNodeVM[] = [];
  for (const cmt of state.commits) {
    const isSel = cmt.version === state.selected;
    const current = cmt.version === state.current;
    logNodes.push({
      id: "ver-" + cmt.version,
      kind: "version",
      pill: "VERSION",
      name: "v" + cmt.version,
      sub: cmt.op + " · " + cmt.ts,
      note: simple ? null : "…" + String(cmt.version).padStart(4, "0") + ".json",
      tag: current ? "CURRENT" : hasCheckpoint(cmt.version) ? "✓ ckpt" : null,
      tagVariant: current ? "kind" : "neutral",
      hint: isSel ? "click again for details" : null,
      inactive: !(isSel || current),
      current,
      action: isSel
        ? { type: "openInspect", kind: "version", id: String(cmt.version) }
        : { type: "selectVersion", version: cmt.version },
    });
    const cp = showCheckpoints ? state.checkpoints.find((c) => c.version === cmt.version) : null;
    if (cp) {
      logNodes.push({
        id: "ckpt-" + cp.version,
        kind: "checkpoint",
        pill: "CHECKPOINT",
        name: "…" + String(cp.version).padStart(4, "0") + ".checkpoint",
        sub: "snapshot @ v" + cp.version,
        note: cp.version === lastCkptVersion ? "_last_checkpoint →" : null,
        tag: cp.liveFiles.length + " file(s)",
        tagVariant: "kind",
        action: { type: "openInspect", kind: "checkpoint", id: String(cp.version) },
      });
    }
  }

  // The actions of the selected commit (its delta). commitInfo is shown in the
  // version inspector, not as a card.
  const selCommit = commitAt(state, state.selected);
  const actionNodes: GraphNodeVM[] = [];
  if (selCommit) {
    selCommit.actions.forEach((a, i) => {
      const id = "act-" + state.selected + "-" + i;
      if (a.kind === "protocol") {
        actionNodes.push({
          id,
          kind: "meta",
          pill: "PROTOCOL",
          name: "protocol",
          sub: "reader " + a.minReader + " · writer " + a.minWriter,
          note: a.features.length ? a.features.join(", ") : "no reader/writer features",
          action: { type: "openInspect", kind: "version", id: String(state.selected) },
        });
      } else if (a.kind === "metaData") {
        actionNodes.push({
          id,
          kind: "meta",
          pill: "METADATA",
          name: "metaData",
          sub: "schema · " + a.schema.length + " cols",
          note: "partitionBy " + (a.partitionBy.join(", ") || "(none)"),
          action: { type: "openInspect", kind: "version", id: String(state.selected) },
        });
      } else if (a.kind === "add") {
        actionNodes.push({
          id,
          kind: "add",
          pill: "ADD",
          name: a.path + ".parquet",
          sub: a.dv ? "add + deletion vector" : "add file",
          note: simple ? null : a.dataChange ? "dataChange: true" : "dataChange: false",
          action: { type: "openInspect", kind: "data", id: a.path },
        });
      } else if (a.kind === "remove") {
        actionNodes.push({
          id,
          kind: "remove",
          pill: "REMOVE",
          name: a.path + ".parquet",
          sub: "tombstone",
          note: simple ? null : a.dataChange ? "dataChange: true" : "dataChange: false",
          action: { type: "openInspect", kind: "data", id: a.path },
        });
      }
    });
  }

  const fileNodes: GraphNodeVM[] = [];
  Object.values(state.dataFiles)
    .sort(byIdNumeric)
    .forEach((f) => {
      const active = liveIds.has(f.id);
      const pruned = !!(prunedIds && prunedIds.has(f.id));
      fileNodes.push({
        id: "df-" + f.id,
        kind: "data",
        pill: "PARQUET",
        name: f.id + ".parquet",
        meta: f.records.length + " rows · " + f.size + " MB",
        tag: pruned ? "skipped ✕" : "part=" + f.partition,
        tagVariant: pruned ? "neutral" : "kind",
        inactive: !active,
        pruned,
        scanned: !!(prunedIds && active && !pruned),
        action: { type: "openInspect", kind: "data", id: f.id },
      });
    });
  Object.values(state.deletionVectors)
    .sort(byIdNumeric)
    .forEach((dv) => {
      fileNodes.push({
        id: "dv-" + dv.id,
        kind: "dv",
        pill: "DV",
        name: dv.id + ".bin",
        sub: "masks " + dv.deletedIds.length + " row(s)",
        note: simple ? null : "→ " + dv.target,
        tag: "MoR",
        inactive: !activeDvs.has(dv.id),
        action: { type: "openInspect", kind: "dv", id: dv.id },
      });
    });

  return {
    tableNode,
    logNodes,
    actionNodes,
    fileNodes,
    counts: {
      version: state.commits.length,
      action: actionNodes.length,
      file: Object.keys(state.dataFiles).length + Object.keys(state.deletionVectors).length,
    },
  };
}

/** A connector between two node cards. `colorVar` names the CSS token for its stroke. */
export interface Edge {
  from: string;
  to: string;
  colorVar: string;
  faint?: boolean;
  dash?: boolean;
}

const LINE_VAR: Record<NodeKind, string> = {
  table: "--table-line",
  version: "--version-line",
  checkpoint: "--checkpoint-line",
  add: "--add-line",
  remove: "--remove-line",
  meta: "--meta-line",
  data: "--data-line",
  dv: "--dv-line",
};

/**
 * Edges for the selected version. Simple shows the reader view (version → live
 * files). Medium+ shows the writer view (version → delta actions → touched files),
 * teaching that a commit records only the delta, not the whole file set.
 */
export function computeEdges(state: TableState): Edge[] {
  const sel = commitAt(state, state.selected);
  if (!sel) return [];
  const edges: Edge[] = [];
  const pruned = prunedSet(state);
  const selId = "ver-" + state.selected;

  edges.push({ from: "table", to: selId, colorVar: LINE_VAR.version });

  if (state.level === "simple") {
    // Reader view: the version points directly at every live data file.
    for (const path of liveFilesAt(state, state.selected).keys()) {
      const faint = !!(pruned && pruned.has(path));
      edges.push({ from: selId, to: "df-" + path, colorVar: LINE_VAR.data, faint });
    }
    if (state.current !== state.selected) {
      edges.push({
        from: "table",
        to: "ver-" + state.current,
        colorVar: LINE_VAR.version,
        dash: true,
      });
    }
    return edges;
  }

  // Writer view: version → each action of its commit → the file each action touches.
  sel.actions.forEach((a, i) => {
    const actId = "act-" + state.selected + "-" + i;
    if (a.kind === "add") {
      edges.push({ from: selId, to: actId, colorVar: LINE_VAR.add });
      const faint = !!(pruned && pruned.has(a.path));
      edges.push({ from: actId, to: "df-" + a.path, colorVar: LINE_VAR.data, faint });
      if (a.dv) edges.push({ from: actId, to: "dv-" + a.dv, colorVar: LINE_VAR.dv });
    } else if (a.kind === "remove") {
      edges.push({ from: selId, to: actId, colorVar: LINE_VAR.remove });
      edges.push({ from: actId, to: "df-" + a.path, colorVar: LINE_VAR.remove, faint: true });
    } else if (a.kind === "protocol" || a.kind === "metaData") {
      edges.push({ from: selId, to: actId, colorVar: LINE_VAR.meta });
    }
  });

  // Reader shortcut: if a checkpoint covers the selected version, the reader starts
  // there and replays only the tail commits, instead of replaying the whole log.
  const rp = replayPath(state, state.selected);
  if (rp.checkpoint) {
    edges.push({
      from: "ckpt-" + rp.checkpoint.version,
      to: selId,
      colorVar: LINE_VAR.checkpoint,
      dash: true,
    });
  }

  if (state.current !== state.selected) {
    edges.push({
      from: "table",
      to: "ver-" + state.current,
      colorVar: LINE_VAR.version,
      dash: true,
    });
  }
  return edges;
}
