# Delta Lake Explorer — Implementation Plan

An interactive visualization of what happens _inside_ a Delta Lake table as you
run commits: append, delete, OPTIMIZE, VACUUM, and write a checkpoint, then watch
how the transaction log and data files rewire. Click any node to inspect it; click
a version to time-travel. Light/dark mode. Fully offline.

This mirrors the sibling project `learn-apache-iceberg` (the "Iceberg Explorer") in
architecture, stack, and teaching approach, but models **Delta Lake's transaction
log** instead of Iceberg's snapshot/manifest tree. The two share a mental frame
(commits rewire a metadata layer over immutable Parquet), so we reuse the whole
domain/viewmodel/presentation split and adapt the model underneath.

---

## 1. The core difference we are teaching

Iceberg's metadata is a **tree** rooted in a versioned `metadata.json`:

```
catalog → metadata.json(vN) → snapshot → manifest-list → manifests(avro) → data/delete files
```

Delta Lake's metadata is an **ordered log** of commits (`_delta_log/*.json`), and
table state at any version is the **replay** of every commit up to it:

```
_delta_log/
  00000000000000000000.json   ← commit 0: protocol, metaData, add, add
  00000000000000000001.json   ← commit 1: add
  00000000000000000002.json   ← commit 2: remove, add   (a DELETE)
  ...
  00000000000000000010.checkpoint.parquet   ← state snapshot every ~10 commits
  _last_checkpoint            ← pointer so readers skip replay-from-zero
```

Each commit file is a list of **actions**. The state of the table at version _N_ is
`(all add actions 0..N) − (all remove actions 0..N)`, read through the latest
`metaData`/`protocol`. That replay-and-subtract is the single most important idea
the app must make visible — it is the Delta analogue of Iceberg's "a snapshot
points at a set of files."

### Concept mapping (Iceberg reference → Delta port)

| Iceberg (reference)                        | Delta Lake (this project)                                                           | Notes                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog                                    | Table root + `_delta_log/`                                                          | The log _is_ the metadata.                                                                                                                     |
| `metadata.json` version chain              | **`metaData` + `protocol` actions** inside commits                                  | No separate version file; schema/partitioning/reader-writer versions live as actions (mostly in commit 0). The whole "meta" column disappears. |
| Snapshot (time-travel unit)                | **Version** = result of a commit                                                    | Time travel is `VERSION AS OF n` / timestamp.                                                                                                  |
| Manifest list + manifests (Avro)           | **Commit JSON file** = list of actions                                              | One flat commit file replaces the manifest tree.                                                                                               |
| Data file + column bounds                  | **`add` action** (path, partitionValues, size, `stats` min/max/nullCount) → Parquet | Delta's inline `stats` power data skipping — maps 1:1 to Iceberg bounds.                                                                       |
| Positional delete file (merge-on-read)     | **Deletion vector** referenced by an `add`                                          | Modern Delta MoR path.                                                                                                                         |
| (Iceberg has no copy-on-write in the demo) | **Copy-on-write DELETE** = `remove` old + `add` rewritten file                      | Classic Delta path; contrast with DVs.                                                                                                         |
| Append commit                              | INSERT → commit of `add` actions                                                    |                                                                                                                                                |
| Delete (MoR)                               | DELETE (COW by default, DV in advanced)                                             |                                                                                                                                                |
| Compaction                                 | **OPTIMIZE** (bin-packing) = `remove` smalls + `add` one big                        | Reader-transparent; old files linger until VACUUM.                                                                                             |
| Expire snapshots + GC                      | **VACUUM**                                                                          | Physically deletes tombstoned files past retention; ends time travel to versions needing them.                                                 |
| Partition evolution (metadata-only)        | **Write a checkpoint** (metadata-only)                                              | _Recommended_ 5th op — the signature Delta concept. Alternative: schema evolution (add column). See §12.                                       |

### Delta-only concepts this port teaches that Iceberg's did not

1. **The log as an ordered commit sequence** (versions, not a tree).
2. **Actions** as the atomic commit units (`add` / `remove` / `metaData` / `protocol` / `commitInfo`).
3. **State reconstruction by replay** (add − remove up to the selected version).
4. **Checkpoints** every N commits + the `_last_checkpoint` pointer, and how a
   reader uses `checkpoint + tail commits` instead of replaying from zero.
5. **Copy-on-write vs deletion-vector deletes** as a toggle — the same DELETE, two
   physical strategies, side by side.
6. **VACUUM** and its interaction with time travel (retention breaks old versions).

---

## 2. What we reuse vs. what changes

**Reuse wholesale** (same as reference, copy + adapt):

- Stack: React 18 + TypeScript + Vite; Vitest (unit) + Playwright (e2e); self-hosted
  IBM Plex Sans/Mono via `@fontsource`; fully offline bundle.
- Architecture split: pure framework-free **domain core** → pure **viewmodel** →
  React **presentation**. UI is a pure projection of one `TableState`.
- `useReducer` domain wrapper (`useTableModel`), discriminated-union `Action`, one
  pure `Operation → TableState → TableState` function per commit.
- Token-based light/dark theming (`theme/tokens.css`, `useTheme`, `data-theme` +
  `localStorage`, OS media-query fallback, SVG connectors re-resolving tokens).
- Three-tier **detail levels** (Simple / Medium / Advanced) that progressively
  disclose layers.
- The graph canvas: columns of node cards + SVG connectors, a side panel (stat
  grid, legend, commit log, "what just happened"), an inspector modal, and a
  delete-picker modal.
- The **data-skipping query planner** (Iceberg's file pruning → Delta's data
  skipping on `add.stats`); functionally identical, renamed.

**Changes** (the Delta model):

- Drop the **metadata-version column** entirely; schema/protocol become actions.
- Replace **snapshot** with **version**, and **manifest tree** with a flat
  **actions** list per commit.
- New graph column layout (§8).
- New operations: `optimize`, `vacuum`, `checkpoint`; delete gains a COW/DV mode.
- New inspector node kinds: `commit` (a log entry, showing its action list),
  `action` (add/remove/metaData/protocol), `checkpoint`, `dv` (deletion vector).

---

## 3. Domain model (`src/domain/types.ts`)

Central `TableState` — everything the UI renders derives from this.

```ts
type Op = "append" | "delete" | "optimize" | "vacuum" | "checkpoint";
type ActionKind = "protocol" | "metaData" | "add" | "remove" | "commitInfo";
type DeleteMode = "cow" | "dv"; // copy-on-write vs deletion vector

interface DataFile {
  // an immutable Parquet file
  id: string; // "part-0001"
  records: OrderRecord[];
  size: number; // MB
  partition: string; // partitionValues, e.g. "2026-01"
  born: number; // version that first `add`ed it
  stats: FileStats; // min/max/nullCount per column
  dv?: string | null; // deletion-vector id if rows masked
  optimized?: boolean;
}

interface DeletionVector {
  // masks row positions in one data file
  id: string;
  target: string;
  deletedIds: number[];
  size: number;
  born: number;
}

interface Action {
  // one entry inside a commit file
  kind: ActionKind;
  // add/remove → dataFileId; metaData/protocol → payload; dv info if present
  ref?: string;
  dataChange: boolean;
}

interface Commit {
  // one _delta_log/NNN.json file
  version: number; // 0,1,2,...
  op: Op;
  ts: string;
  actions: Action[]; // ordered add/remove/metaData/...
  // convenience: ids added/removed at this version (derived, cached for speed)
  adds: string[];
  removes: string[];
  blockedByCheckpoint?: boolean; // covered by a later checkpoint
}

interface Checkpoint {
  // NNN.checkpoint.parquet
  version: number; // the version it snapshots through
  liveFiles: string[]; // materialized add-set at that version
  size: number;
}

interface Protocol {
  minReader: number;
  minWriter: number;
  features: string[];
}
interface Metadata {
  schemaCols: string[];
  partitionBy: string[];
}

interface TableState {
  commits: Commit[]; // the ordered log
  checkpoints: Checkpoint[]; // written checkpoints (+ _last_checkpoint = last)
  dataFiles: Record<string, DataFile>;
  deletionVectors: Record<string, DeletionVector>;
  protocol: Protocol;
  metadata: Metadata;
  current: number; // latest committed version
  selected: number; // version being viewed (time travel)
  deleteMode: DeleteMode; // advanced toggle
  // UI: inspect, picker, appendRows, query (col/op/val), qActive, level, log, lastStep, counters
}
```

**Initial state** = commit 0 (`protocol` + `metaData` + two `add`s → two data
files), `current = selected = 0`, no checkpoints. Mirrors the reference's "table
created at s1," but as version 0 with real actions.

---

## 4. The replay selector — the heart of the app (`src/domain/replay.ts`)

Pure functions computing table state at any version by log replay:

- `liveFilesAt(state, version)` → walk commits `0..version` (starting from the
  latest checkpoint ≤ version when one exists, to _show_ the reader's shortcut):
  add on `add`, drop on `remove`. Returns the live `Set<dataFileId>`.
- `deletedIdsAt(state, version)` → union of deletion-vector `deletedIds` for live
  files (DV mode); COW deletes are already reflected in which files are live.
- `liveRecords(state, version)` → materialize rows, split live vs. masked.
- `protocolAt` / `metadataAt` → latest such action at ≤ version.
- `replayPath(state, version)` → the ordered list of `(checkpoint?, commits[])` a
  reader would touch, so the UI can highlight "checkpoint 10 + commits 11–13"
  instead of "0–13." This is the checkpoint lesson, made visual.

This replaces Iceberg's `referencedFiles`/`deletedSetFor`. Same downstream shape
(a live-file set + a deleted-id set), different derivation. Everything visual keys
off these two outputs, exactly as the reference does.

---

## 5. Operations (`src/domain/operations.ts`, dispatched via `reducer.ts`)

Each is a pure `TableState → TableState` appending exactly one commit (except
VACUUM/checkpoint, which are log-mutating but not new-version — see notes).

1. **append** — generate rows → 1–3 new Parquet `add` actions with computed
   `stats` → new commit `v+1`. (Directly ports Iceberg `append`.)
2. **delete** (opens the same random/manual picker):
   - **COW mode** (default): for each affected file, `add` a rewritten file with the
     surviving rows + `remove` the original → new commit. Teaches write
     amplification.
   - **DV mode** (advanced): write a deletion vector, `add`-with-DV replaces the
     file's entry (`remove` old add + `add` same file + DV) → new commit. Teaches
     merge-on-read.
   - A toolbar toggle (advanced level) switches modes; the "what happened"
     explainer differs per mode.
3. **optimize** — bin-pack all small live files: `remove` them + `add` one
   compacted file (deletes baked in) → new commit. Reader-transparent.
4. **vacuum** — physically delete data files that are tombstoned (removed and not
   live at `current`) beyond a (demo) retention of 0; garbage-collect orphaned
   DVs. Reports what was GC'd and that time travel to versions needing those files
   now breaks. Ports Iceberg `expire`. _Does not add a version_ (VACUUM is not a
   commit in Delta).
5. **checkpoint** — write a `Checkpoint` snapshotting `liveFilesAt(current)`, set
   `_last_checkpoint`. _Does not add a version._ Explains that readers now start
   from here instead of commit 0. (This is the recommended 5th op; see §12.)

Plus UI/state ops ported 1:1: `reset`, `setLevel`, `jumpCurrent`, `selectVersion`,
`openInspect`/`closeInspect`, append-rows field, query-planner field, and the
delete-picker set (`openDelete`, `togglePick`, `setRandomN`, `randomPick`,
`cancelPicker`, `confirmDelete`). New: `setDeleteMode`.

---

## 6. Detail levels (progressive disclosure)

- **Simple** — the core mental model: Table → Version → live data files, with just
  Append/Delete and essential counts. The log-internals (actions, checkpoints),
  raw JSON, and deletion vectors are hidden. Delete uses COW silently.
- **Medium** — reveal how the pointer is stored: the **commit / actions** column,
  OPTIMIZE + Checkpoint, checkpoint markers on the version spine, more panel detail.
- **Advanced** — the physical/optimization layer: the data-skipping query planner,
  the COW↔DV **delete-mode toggle** + deletion-vector nodes, VACUUM, per-column
  min/max/nullCount stats, `protocol`/`metaData` action bodies, and raw commit
  JSON / `_last_checkpoint` JSON.

Reuse the reference's `levels.ts` (`atLeast(level, min)`) unchanged.

---

## 7. Viewmodel (`src/viewmodel/`)

- `graph.ts` — build node cards + connector edges from `TableState` + the selected
  version's replay. **Columns:**
  1. **Table** (`orders`, delta table)
  2. **`_delta_log`** — one card per **version** (v0, v1, …), current tagged,
     selected highlighted, checkpoint markers shown at medium+. This is the
     time-travel spine (Iceberg's snapshot column).
  3. **Actions** — the actions of the _selected_ commit (`add`/`remove`/`metaData`/
     `protocol`), shown at medium+ (Iceberg's manifest column).
  4. **Files** — data-file cards (live vs. inactive vs. pruned/skipped) +
     deletion-vector cards (advanced).
  - Edges: Simple wires Table → version → live files directly. Medium+ wires
    Table → version → actions → files, with a dashed edge to `current` while
    time-traveling and a distinct edge from the checkpoint node into the version it
    covers. Faint edges for query-skipped files (ports the pruned-edge logic).
- `panels.ts` — stat cards (versions, live files, total files, rows, DVs),
  operation-accent colors, legend rows.
- `inspector.ts` — per-kind inspector content: **table**, **commit** (its action
  list + `commitInfo`), **action** (add/remove/metaData/protocol JSON), **data**
  (row grid + stats), **dv** (masked rows + target), **checkpoint** (materialized
  live-file list + `_last_checkpoint`).
- `picker.ts` — delete-picker rows (ported 1:1).

---

## 8. Query planner (data skipping) — `src/domain/query.ts` + `stats.ts`

Straight port. Delta's `add.stats` (min/max/nullCount) is the pruning input, same
as Iceberg bounds. `prunedSet(state)` returns files skippable for the active
predicate over `order_id | amount | order_date`. The graph faints skipped files
and their edges; the inspector shows "scanned N of M files." Rename "bounds" →
"stats" to match Delta terminology.

---

## 9. Presentation (`src/components/`) and theme

Port the component tree, renaming for the Delta model:

- `Header` (title, detail-level control, theme toggle) — reuse.
- `Toolbar` — Append (rows stepper), Delete (opens picker), OPTIMIZE, VACUUM,
  Checkpoint, Reset; at advanced: delete-mode toggle + query planner.
- `GraphCanvas` / `GraphColumn` / `GraphNode` / `Connectors` — reuse mechanics;
  new column set and node kinds.
- `SidePanel` (StatGrid, Legend, CommitLog, WhatHappened) — reuse.
- `Inspector`, `DeletePicker`, `Modal` — reuse; new inspector views.
- `theme/tokens.css` — reuse tokens; add color tokens for the new node kinds
  (version/commit, action-add green, action-remove red, checkpoint, DV) and update
  the legend. Keep the light/dark system and SVG token re-resolution.

---

## 10. Testing

- **Unit (Vitest)** — port the reference's domain test suites and rewrite for
  Delta semantics:
  - `replay.test.ts` — live-file set / deleted-ids at each version across a scripted
    sequence (append, COW delete, DV delete, optimize); checkpoint doesn't change
    replay output; replay path uses the checkpoint shortcut.
  - `operations.test.ts` — each op's commit shape (actions added, files added/
    removed), COW vs DV divergence, VACUUM GC counts + time-travel breakage,
    checkpoint materialization.
  - `query.test.ts`, `stats.test.ts` — data-skipping pruning (ported).
  - `initialState.test.ts`, `records.test.ts`, `selectors.test.ts` — ported.
- **E2E (Playwright)** — smoke: load; append; delete (both modes at advanced);
  optimize; checkpoint; vacuum; time-travel by clicking an old version; open
  inspector on a commit/action/data node; run a data-skipping query; toggle detail
  levels; toggle theme.

---

## 11. Build phases (incremental, TDD-aligned; each ends green + a commit)

Mirrors the reference's git history order.

1. **Scaffold** → verify: `npm run dev` serves a blank app; `npm run build` +
   `typecheck` pass. (Vite/TS/ESLint/Prettier, offline fonts, gitignore.)
2. **Domain foundation** — `types.ts`, `records.ts`, `ids.ts`, `stats.ts`,
   `initialState.ts` → verify: `initialState`/`records`/`stats` unit tests pass.
3. **Replay + selectors** — `replay.ts` → verify: replay tests pass on a hand-built
   log.
4. **Operations + reducer** — all five ops + UI ops → verify: `operations.test.ts`
   green (COW+DV+optimize+vacuum+checkpoint).
5. **Query planner** — `query.ts` → verify: pruning tests pass.
6. **Theme tokens + app frame** — tokens, `useTheme`, layout → verify: dev app
   renders header/toolbar shell in both themes.
7. **Graph viewmodel + canvas** — columns, nodes, connectors → verify: clicking a
   version time-travels; live/inactive files render correctly per version.
8. **Toolbar + side panel** — all commit buttons, stat grid, commit log, "what
   happened" → verify: full commit sequence works end-to-end in the browser.
9. **Inspector + delete picker** — node inspection + delete flow (COW/DV) → verify:
   inspector renders every node kind; delete picker commits.
10. **Detail levels + checkpoint/DV polish** — progressive disclosure, checkpoint
    spine markers, `_last_checkpoint`, deletion-vector nodes → verify: each level
    shows/hides the right layers.
11. **E2E + README** — Playwright smoke suite + a README modeled on the reference →
    verify: `npm test` and `npm run test:e2e` green.

---

## 12. Decisions (confirmed)

1. **5th operation = Write a checkpoint.** The signature Delta concept; replaces
   Iceberg's "partition evolution" and pairs with the log-replay story and the
   `_last_checkpoint` reader shortcut.
2. **Default delete semantics = copy-on-write.** Classic Delta (`remove` old +
   `add` rewritten file); the clearest contrast to Iceberg's merge-on-read
   reference. Deletion vectors are the advanced-level toggle.
3. **Scaffolding = copy the reference repo and adapt.** Clone the proven Vite /
   theme / test setup and offline font bundle from `learn-apache-iceberg`, then
   rewrite the domain and rename the model.

Naming: package `delta-explorer`, app title **"Delta Lake Explorer."**
