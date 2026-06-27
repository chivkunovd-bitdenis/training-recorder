import {
  base64ToBlob,
  buildEditorUrl,
  uploadRecording,
} from "./upload-recording.js";

const DEFAULT_BACKEND_URL = "https://training-recorder-production.up.railway.app";

export async function getBackendBaseUrl() {
  const data = await chrome.storage.local.get(["backendBaseUrl"]);
  if (typeof data.backendBaseUrl === "string" && data.backendBaseUrl.trim()) {
    return data.backendBaseUrl.trim().replace(/\/$/, "");
  }
  return DEFAULT_BACKEND_URL;
}

/**
 * @param {object} stopResponse
 * @param {string} baseUrl
 */
export async function uploadStopResponse(stopResponse, baseUrl) {
  const micBlob = base64ToBlob(stopResponse.micBase64, "audio/webm");
  const videoBlob = stopResponse.videoBase64
    ? base64ToBlob(stopResponse.videoBase64, "video/webm")
    : null;

  if (micBlob.size === 0) {
    throw new Error("Получен пустой файл микрофона");
  }

  const timeline = stopResponse.timeline ?? {
    meta: stopResponse.meta,
    events: stopResponse.events ?? [],
    screenshots: stopResponse.screenshots ?? [],
  };

  return uploadRecording({
    baseUrl,
    micBlob,
    videoBlob,
    timeline,
    screenshotImages: stopResponse.screenshotImages ?? {},
  });
}

/**
 * @param {string} baseUrl
 * @param {string} recordingId
 */
export async function generateDocumentOnServer(baseUrl, recordingId) {
  const response = await fetch(
    `${baseUrl}/recording/${encodeURIComponent(recordingId)}/generate`,
    { method: "POST" },
  );
  if (!response.ok) {
    let detail = `Генерация вернула ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.detail) {
        detail = String(payload.detail);
      }
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return response.json();
}

/**
 * @param {object} stopResponse
 */
export async function runFullPipeline(stopResponse, onProgress) {
  const baseUrl = await getBackendBaseUrl();
  onProgress?.(15, "Загружаем запись на сервер…");

  const uploadResult = await uploadStopResponse(stopResponse, baseUrl);
  onProgress?.(45, "Расшифровываем голос (Whisper)…");

  await generateDocumentOnServer(baseUrl, uploadResult.recordingId);
  onProgress?.(100, "Инструкция готова");

  const editorUrl = buildEditorUrl(baseUrl, uploadResult.recordingId);
  const timeline = stopResponse.timeline ?? {
    meta: stopResponse.meta,
    events: stopResponse.events ?? [],
    screenshots: stopResponse.screenshots ?? [],
  };

  await chrome.storage.local.set({
    backendBaseUrl: baseUrl,
    lastEditorUrl: editorUrl,
    lastRecording: {
      recordingId: uploadResult.recordingId,
      meta: timeline.meta,
      events: timeline.events ?? [],
      screenshots: timeline.screenshots ?? [],
      uploaded: true,
      savedAt: Date.now(),
    },
  });

  return {
    recordingId: uploadResult.recordingId,
    editorUrl,
  };
}
