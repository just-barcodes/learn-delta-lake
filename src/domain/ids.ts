// Deterministic, human-friendly identifiers derived from a commit's version number.
// Keeping these pure makes generated log JSON reproducible in tests.

/** A wall-clock "HH:MM" label that advances 7 minutes per commit. */
export function clock(version: number): string {
  const t = 600 + version * 7;
  const h = Math.floor(t / 60) % 24;
  const m = t % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** A stable epoch-millis timestamp for a commit. */
export function tsMs(version: number): number {
  return 1704067200000 + version * 420000;
}

/** The zero-padded log file name Delta writes for a commit, e.g. "...0002.json". */
export function logFileName(version: number): string {
  return String(version).padStart(20, "0") + ".json";
}

/** The checkpoint file name for a version, e.g. "...0010.checkpoint.parquet". */
export function checkpointFileName(version: number): string {
  return String(version).padStart(20, "0") + ".checkpoint.parquet";
}
