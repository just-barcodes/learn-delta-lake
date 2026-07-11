import type { DetailLevel } from "./types";

const RANK: Record<DetailLevel, number> = { simple: 0, medium: 1, advanced: 2 };

/** True when `level` is at or above `min` in the simple < medium < advanced order. */
export function atLeast(level: DetailLevel, min: DetailLevel): boolean {
  return RANK[level] >= RANK[min];
}
