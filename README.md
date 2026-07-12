# Delta Lake Explorer

An interactive visualization of what happens _inside_ a Delta Lake table as you
run commits. Append, delete or update (copy-on-write or deletion vectors),
OPTIMIZE, VACUUM, evolve the schema, and write a checkpoint, then watch how the
transaction log and data files rewire.
Click any node to inspect it; click a version to time-travel. Supports light and
dark mode.

It is the sibling of [`learn-apache-iceberg`](https://github.com/just-barcodes/learn-apache-iceberg): same
architecture and teaching approach, but it models **Delta Lake's transaction log**
instead of Iceberg's snapshot/manifest tree.

## The core idea

Delta's metadata is an ordered **log** of JSON commits in `_delta_log/`. Each
commit is a list of _actions_ (`add`, `remove`, `metaData`, `protocol`,
`commitInfo`). The table's state at any version is the **replay** of every commit
up to it:

> live files at version _N_ = (all `add`s 0..N) − (all `remove`s 0..N)

Making that replay-and-subtract visible is the point of the app. Every ~10 commits
Delta also writes a **checkpoint** (a Parquet snapshot of the live-file set) and
updates `_last_checkpoint`, so readers start from the checkpoint and replay only
the tail — the app draws that shortcut too.

## Detail levels

A header control tiers the interface by how much of the Delta model it reveals, so
each level teaches one layer:

- **Simple** — the core mental model: Table → Version → live data files, with just
  Append/Delete. The commit actions, checkpoints, raw JSON, and deletion vectors
  are hidden, and DELETE is copy-on-write. This is the _reader's_ view: a version
  points at a set of files.
- **Medium** — the _writer's_ view: the **actions** column (a commit records only
  its delta), OPTIMIZE / VACUUM / Checkpoint, checkpoint cards on the log spine,
  and more panel detail.
- **Advanced** — the physical/optimization layer: the copy-on-write ↔ deletion-
  vector delete toggle, schema evolution (add / rename / drop / widen columns,
  resolved by column-mapping id), the data-skipping query planner, per-column
  `add.stats`, and the raw commit / deletion-vector / checkpoint JSON.

## Getting started

```sh
npm install
npm run dev          # http://localhost:5173
```

```sh
npm run build        # type-check + production bundle in dist/
npm run preview      # serve the production build
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end smoke tests (Playwright)
npm run typecheck    # tsc, no emit
npm run lint         # eslint
```

Everything is bundled locally (React and the IBM Plex fonts are self-hosted), so
the app runs fully offline.

## How it is structured

The code separates a pure, framework-free **domain core** from the React
**presentation**, so the Delta simulation is understandable and unit-testable on
its own.

```
src/
  domain/       Pure Delta model — no React, no DOM
    types.ts          TableState, Commit, Action union, Checkpoint, DeletionVector
    records.ts        Deterministic order-record generation
    ids.ts, schema.ts Stable clocks/log-file names, generated partition column, protocol
    schemas.ts        Schema versions + column-mapping id resolution (schema evolution)
    initialState.ts   The table's starting point (commit 0)
    replay.ts         The heart: reconstruct any version by replaying add − remove
    stats.ts          Per-column min/max/nullCount (Delta's inline add.stats)
    query.ts          Data-skipping file pruning (reads stored stats)
    operations.ts     Each operation as a pure state transition
    reducer.ts        Action union → operations
  viewmodel/    Pure state → view data (no JSX)
    graph.ts          Node cards + connector edges (log spine, actions, files)
    panels.ts         Stat cards, legend, operation accents
    inspector.ts      Inspector contents per node kind
    picker.ts         Delete-picker rows
  state/        useTableModel — useReducer wrapper
  theme/        Token-based light/dark theming + useTheme + toggle
  components/   Header, Toolbar, graph/, sidepanel/, Inspector, DeletePicker
  styles/       Layout and base CSS
```

### Domain model

A `TableState` holds the `commits` (the log), `checkpoints`, `dataFiles`, and
`deletionVectors` that make up the table, plus the current/selected version and UI
state. Every operation is a pure function `TableState → TableState`, dispatched
through a reducer. The UI is a pure projection of this state.

The seven operations map to Delta commands:

| Operation      | What it does                                                                     |
| -------------- | ------------------------------------------------------------------------------- |
| **Append**     | INSERT: new Parquet files + one commit of `add` actions → a new version.        |
| **Delete**     | Copy-on-write (`remove` + rewritten `add`) or a deletion vector (mask).         |
| **Update**     | Same file mechanics as delete, but rows change: CoW rewrite, or DV mask + a small new file. This is the mechanism `MERGE` uses for matched rows. |
| **Optimize**   | Bin-pack small files per partition (`dataChange: false`); old files linger.     |
| **Vacuum**     | Physically delete tombstoned files. No new version; ends stale time travel.     |
| **Schema**     | Evolve columns via a `metaData` commit; rename/drop need column mapping.        |
| **Checkpoint** | Snapshot the live-file set; readers then skip replay-from-zero.                 |

The table uses classic partitioning (a generated `order_month` column). Delta's newer
**liquid clustering** — which replaces partitioning rather than complementing it, and
so cannot be applied to this already-partitioned demo table — is intentionally not
modelled.

### Theming

All colors are CSS custom properties in [`src/theme/tokens.css`](./src/theme/tokens.css).
Dark mode follows the OS by default (a pre-JS media-query fallback) and is pinned
by a header toggle that writes `data-theme` and persists to `localStorage`. SVG
connectors re-resolve their token colors when the theme changes.
