// Port of the usage-progress helpers in lib/utils.ts (getUsagePercent /
// getProgressTier). These drive the card's usage window rendering: the exact
// ratio classifies the tier, while the display rounds separately.

/** Usage ratio at which the progress bar turns warning (>=). */
export const PROGRESS_WARNING_THRESHOLD = 70;
/** Usage ratio above which the progress bar turns danger (>). */
export const PROGRESS_DANGER_THRESHOLD = 90;

export type ProgressTier = "normal" | "warning" | "danger";

/**
 * Compute the exact used/total ratio (0-100, unrounded). Returns null when the
 * ratio cannot be computed (missing/non-finite/zero-or-negative total), so the
 * caller can fall back to plain numbers instead of a misleading "0%".
 * A current value at or above the total is clamped to 100.
 */
export function getAmountPercent(
  current: number | null | undefined,
  total: number | null | undefined
): number | null {
  if (
    current == null ||
    total == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return null;
  }
  if (current <= 0) return 0;
  return Math.min(100, (current / total) * 100);
}

/**
 * Compute the exact usage ratio (0-100, unrounded) from used/limit values.
 * Returns null when the ratio cannot be computed (missing/zero/invalid limit,
 * or non-numeric used), so the caller can fall back to plain numbers instead of
 * rendering a misleading "0%".
 */
export function getUsagePercent(
  used: string | undefined,
  limit: string | undefined
): number | null {
  if (
    used == null ||
    limit == null ||
    used.trim() === "" ||
    limit.trim() === ""
  ) {
    return null;
  }
  return getAmountPercent(Number(used), Number(limit));
}

/** Map an exact usage ratio to a visual tier: normal, warning, danger. */
export function getProgressTier(percent: number): ProgressTier {
  if (percent > PROGRESS_DANGER_THRESHOLD) return "danger";
  if (percent >= PROGRESS_WARNING_THRESHOLD) return "warning";
  return "normal";
}
