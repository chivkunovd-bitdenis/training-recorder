/**
 * @param {number} aMs
 * @param {number} bMs
 * @param {number} [toleranceMs=300]
 */
export function durationsWithinTolerance(aMs, bMs, toleranceMs = 300) {
  return Math.abs(aMs - bMs) <= toleranceMs;
}

/**
 * @param {{ videoDurationMs: number; micDurationMs: number }} meta
 * @param {number} [toleranceMs=300]
 */
export function recordingTracksAligned(meta, toleranceMs = 300) {
  return durationsWithinTolerance(
    meta.videoDurationMs,
    meta.micDurationMs,
    toleranceMs,
  );
}
