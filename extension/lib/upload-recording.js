/**
 * @param {string} base64
 * @param {string} mimeType
 */
export function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * @param {string} baseUrl
 * @param {string} recordingId
 */
export function buildEditorUrl(baseUrl, recordingId) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  return `${normalizedBase}/editor/recording/${encodeURIComponent(recordingId)}`;
}

/**
 * @param {{
 *   baseUrl: string;
 *   micBlob: Blob;
 *   timeline: object;
 *   screenshotImages?: Record<string, string>;
 *   videoBlob?: Blob | null;
 *   fetchFn?: typeof fetch;
 * }} params
 */
export async function uploadRecording({
  baseUrl,
  micBlob,
  timeline,
  screenshotImages = {},
  videoBlob = null,
  fetchFn = fetch,
}) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  if (!normalizedBase) {
    throw new Error("Не указан адрес сервера");
  }

  const formData = new FormData();
  formData.append("mic", micBlob, "mic.webm");
  formData.append(
    "timeline",
    new Blob([JSON.stringify(timeline)], { type: "application/json" }),
    "timeline.json",
  );

  if (videoBlob && videoBlob.size > 0) {
    formData.append("video", videoBlob, "video.webm");
  }

  for (const shot of timeline.screenshots ?? []) {
    const imageBase64 = screenshotImages[shot.id];
    if (!imageBase64) {
      continue;
    }
    formData.append(
      "screenshots",
      base64ToBlob(imageBase64, "image/jpeg"),
      `${shot.id}.jpg`,
    );
  }

  const response = await fetchFn(`${normalizedBase}/process`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let detail = `POST /process вернул ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.detail) {
        detail = String(payload.detail);
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  const payload = await response.json();
  if (!payload?.recordingId) {
    throw new Error("Сервер не вернул recordingId");
  }

  return {
    recordingId: String(payload.recordingId),
    jobId: payload.jobId ? String(payload.jobId) : null,
    status: payload.status ? String(payload.status) : "received",
  };
}

/**
 * @param {{
 *   baseUrl: string;
 *   micBlob: Blob;
 *   timeline: object;
 *   screenshotImages?: Record<string, string>;
 *   videoBlob?: Blob | null;
 *   openEditor?: (url: string) => void;
 *   fetchFn?: typeof fetch;
 * }} params
 */
export async function uploadAndOpenEditor({
  baseUrl,
  micBlob,
  timeline,
  screenshotImages = {},
  videoBlob = null,
  openEditor = (url) => {
    if (typeof window !== "undefined" && window.open) {
      window.open(url, "_blank");
    }
  },
  fetchFn = fetch,
}) {
  const uploadResult = await uploadRecording({
    baseUrl,
    micBlob,
    timeline,
    screenshotImages,
    videoBlob,
    fetchFn,
  });

  const editorUrl = buildEditorUrl(baseUrl, uploadResult.recordingId);
  openEditor(editorUrl);

  return {
    ...uploadResult,
    editorUrl,
  };
}
