import { atLeast } from "../domain/levels";
import { liveFileIds, liveRowCount } from "../domain/replay";
import type { DetailLevel, NodeKind, Operation, TableState } from "../domain/types";

/** CSS variable holding the accent color for each operation (cards, logs, explainer). */
export const ACCENT_VAR: Record<Operation, string> = {
  append: "var(--data-line)",
  delete: "var(--remove-line)",
  update: "var(--data-line)",
  optimize: "var(--meta-line)",
  vacuum: "var(--accent-gray)",
  checkpoint: "var(--checkpoint-line)",
  schema: "var(--meta-line)",
};

export interface StatCard {
  value: number;
  label: string;
  colorVar: string;
}

interface StatDef extends StatCard {
  /** Lowest detail level at which this card is shown. */
  min: DetailLevel;
}

/**
 * The headline counts for the side panel's stat grid, filtered by detail level:
 * the core counts show everywhere; internal-structure counts (live files, DVs,
 * checkpoints) appear from medium on.
 */
export function buildStats(state: TableState): StatCard[] {
  const defs: StatDef[] = [
    {
      value: state.commits.length,
      label: "versions",
      colorVar: "var(--version-line)",
      min: "simple",
    },
    {
      value: liveRowCount(state, state.current),
      label: "live rows (current)",
      colorVar: "var(--version-line)",
      min: "simple",
    },
    {
      value: Object.keys(state.dataFiles).length,
      label: "data files on disk",
      colorVar: "var(--data-line)",
      min: "simple",
    },
    {
      value: liveFileIds(state, state.current).size,
      label: "live files (current)",
      colorVar: "var(--data-line)",
      min: "medium",
    },
    {
      value: Object.keys(state.deletionVectors).length,
      label: "deletion vectors",
      colorVar: "var(--dv-line)",
      min: "medium",
    },
    {
      value: state.checkpoints.length,
      label: "checkpoints",
      colorVar: "var(--checkpoint-line)",
      min: "medium",
    },
    {
      value: state.schemaId,
      label: "schema version",
      colorVar: "var(--meta-line)",
      min: "advanced",
    },
  ];
  return defs.filter((d) => atLeast(state.level, d.min)).map(({ min, ...card }) => card);
}

export interface LegendEntry {
  kind: NodeKind;
  name: string;
  desc: string;
}

interface LegendDef extends LegendEntry {
  /** Lowest detail level at which this entry's concept is on screen. */
  min: DetailLevel;
}

const LEGEND_DEFS: LegendDef[] = [
  { kind: "version", name: "Version", desc: "a commit; point-in-time file set", min: "simple" },
  { kind: "add", name: "Add", desc: "adds a data file", min: "medium" },
  { kind: "remove", name: "Remove", desc: "tombstones a data file", min: "medium" },
  { kind: "meta", name: "Protocol / metaData", desc: "schema, features", min: "medium" },
  { kind: "data", name: "Data file", desc: "parquet rows + stats", min: "simple" },
  { kind: "dv", name: "Deletion vector", desc: "merge-on-read deletes", min: "medium" },
  { kind: "checkpoint", name: "Checkpoint", desc: "state snapshot", min: "medium" },
];

/** Legend entries for the concepts actually visible at the given detail level. */
export function legendFor(level: DetailLevel): LegendEntry[] {
  return LEGEND_DEFS.filter((l) => atLeast(level, l.min)).map(({ min, ...entry }) => entry);
}
