/**
 * @param {{ local: { get: (keys: string | string[]) => Promise<Record<string, unknown>>; remove: (keys: string | string[]) => Promise<void> } }} storage
 */
export async function deleteLocalRecording(storage) {
  await storage.local.remove(["lastRecording"]);
}

/**
 * @param {{ baseUrl: string; recordingId: string; fetchFn?: typeof fetch }} params
 */
export async function deleteRemoteRecording({
  baseUrl,
  recordingId,
  fetchFn = fetch,
}) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  if (!normalizedBase || !recordingId) {
    return { skipped: true, reason: "missing-config" };
  }

  const response = await fetchFn(
    `${normalizedBase}/recording/${encodeURIComponent(recordingId)}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    throw new Error(`DELETE /recording/${recordingId} вернул ${response.status}`);
  }

  return { ok: true, skipped: false };
}

/**
 * @param {{
 *   storage: { local: { get: (keys: string | string[]) => Promise<Record<string, unknown>>; remove: (keys: string | string[]) => Promise<void> } };
 *   getBackendBaseUrl?: () => Promise<string | null | undefined>;
 *   fetchFn?: typeof fetch;
 * }} params
 */
export async function deleteAllRecordingArtifacts({
  storage,
  getBackendBaseUrl = async () => null,
  fetchFn = fetch,
}) {
  const data = await storage.local.get(["lastRecording"]);
  const lastRecording = data.lastRecording;

  if (!lastRecording || typeof lastRecording !== "object") {
    return { ok: true, deleted: false };
  }

  const recording =
    /** @type {{ meta?: { recordingId?: string }; recordingId?: string; uploaded?: boolean }} */ (
      lastRecording
    );

  const recordingId =
    recording.meta?.recordingId ?? recording.recordingId ?? null;

  if (recording.uploaded && recordingId) {
    const backendBaseUrl = await getBackendBaseUrl();
    if (backendBaseUrl) {
      await deleteRemoteRecording({
        baseUrl: backendBaseUrl,
        recordingId,
        fetchFn,
      });
    }
  }

  await deleteLocalRecording(storage);

  return {
    ok: true,
    deleted: true,
    recordingId,
  };
}

/**
 * @param {unknown} lastRecording
 */
export function hasStoredRecording(lastRecording) {
  return Boolean(lastRecording && typeof lastRecording === "object");
}
