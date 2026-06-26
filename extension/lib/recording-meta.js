/**
 * Сборка RecordingMeta (контракт T0.1 + T1.1).
 * @param {{ recordingId: string; url: string; title: string; t0: number; userAgent?: string }} params
 */
export function createRecordingMeta({ recordingId, url, title, t0, userAgent = "" }) {
  return {
    recordingId,
    t0,
    url,
    title,
    durationMs: 0,
    userAgent,
    videoStartOffsetMs: 0,
    micStartOffsetMs: 0,
    videoDurationMs: 0,
    micDurationMs: 0,
  };
}

/**
 * @param {ReturnType<typeof createRecordingMeta>} meta
 * @param {{ videoStartOffsetMs: number; micStartOffsetMs: number }} offsets
 */
export function withTrackStartOffsets(meta, { videoStartOffsetMs, micStartOffsetMs }) {
  return {
    ...meta,
    videoStartOffsetMs,
    micStartOffsetMs,
  };
}

/**
 * @param {ReturnType<typeof createRecordingMeta>} meta
 * @param {number} endTime — Date.now() в момент остановки сессии
 * @param {{ videoEndOffsetMs: number; micEndOffsetMs: number }} trackEnds — смещения от t0
 */
export function finalizeRecordingMeta(meta, endTime, trackEnds) {
  const videoDurationMs = Math.max(
    0,
    trackEnds.videoEndOffsetMs - meta.videoStartOffsetMs,
  );
  const micDurationMs = Math.max(
    0,
    trackEnds.micEndOffsetMs - meta.micStartOffsetMs,
  );

  return {
    ...meta,
    durationMs: Math.max(0, endTime - meta.t0),
    videoDurationMs,
    micDurationMs,
  };
}

export function generateRecordingId() {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
