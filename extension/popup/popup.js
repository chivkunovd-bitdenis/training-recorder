import { MSG } from "../lib/messages.js";
import { uploadAndOpenEditor } from "../lib/upload-recording.js";

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const deleteBtn = document.getElementById("deleteBtn");
const editorBtn = document.getElementById("editorBtn");
const consentCheckbox = document.getElementById("consentCheckbox");
const consentPanel = document.getElementById("consentPanel");
const keepVideoCheckbox = document.getElementById("keepVideoCheckbox");
const backendUrlInput = document.getElementById("backendUrlInput");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");

if (
  !(startBtn instanceof HTMLButtonElement) ||
  !(stopBtn instanceof HTMLButtonElement) ||
  !(deleteBtn instanceof HTMLButtonElement) ||
  !(editorBtn instanceof HTMLButtonElement) ||
  !(consentCheckbox instanceof HTMLInputElement) ||
  !(consentPanel instanceof HTMLElement) ||
  !(keepVideoCheckbox instanceof HTMLInputElement) ||
  !(backendUrlInput instanceof HTMLInputElement) ||
  !(statusEl instanceof HTMLParagraphElement) ||
  !(errorEl instanceof HTMLParagraphElement)
) {
  throw new Error("Popup markup is invalid");
}

const DEFAULT_BACKEND_URL = "https://training-recorder-production.up.railway.app";

/** @type {boolean} */
let isRecording = false;
/** @type {boolean} */
let hasLastRecording = false;
/** @type {{
 *   micBlob: Blob;
 *   videoBlob: Blob;
 *   timeline: object;
 *   screenshotImages: Record<string, string>;
 * } | null} */
let pendingArtifacts = null;

function setError(message) {
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function updateControls() {
  const consentGiven = consentCheckbox.checked;
  startBtn.disabled = isRecording || !consentGiven;
  stopBtn.disabled = !isRecording;
  deleteBtn.hidden = isRecording || !hasLastRecording;
  editorBtn.hidden = isRecording || !pendingArtifacts;
  consentPanel.hidden = isRecording;
}

function setRecordingUi(recording) {
  isRecording = recording;
  statusEl.textContent = recording ? "Идёт запись…" : "Готов к записи";
  updateControls();
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function normalizeBackendUrl(value) {
  const trimmed = value.trim();
  return trimmed || DEFAULT_BACKEND_URL;
}

async function persistBackendUrl() {
  const backendBaseUrl = normalizeBackendUrl(backendUrlInput.value);
  backendUrlInput.value = backendBaseUrl;
  await chrome.storage.local.set({ backendBaseUrl });
}

async function refreshState() {
  const state = await chrome.runtime.sendMessage({ type: MSG.RECORDING_STATE });
  const storageData = await chrome.storage.local.get(["backendBaseUrl"]);
  if (typeof storageData.backendBaseUrl === "string") {
    backendUrlInput.value = storageData.backendBaseUrl;
  }

  if (state?.ok) {
    isRecording = Boolean(state.isRecording);
    hasLastRecording = Boolean(state.hasLastRecording);
    statusEl.textContent = isRecording ? "Идёт запись…" : "Готов к записи";
    updateControls();
  }
}

consentCheckbox.addEventListener("change", () => {
  updateControls();
});

backendUrlInput.addEventListener("change", () => {
  void persistBackendUrl();
});

startBtn.addEventListener("click", async () => {
  setError("");

  if (!consentCheckbox.checked) {
    setError("Нужно согласие перед началом записи");
    return;
  }

  startBtn.disabled = true;
  pendingArtifacts = null;

  try {
    const response = await chrome.runtime.sendMessage({
      type: MSG.START_RECORDING,
      keepVideo: keepVideoCheckbox.checked,
    });

    if (!response?.ok) {
      throw new Error(response?.error ?? "Не удалось начать запись");
    }

    hasLastRecording = false;
    setRecordingUi(true);

    if (response.displaySurface && response.displaySurface !== "browser") {
      setError(
        "Похоже, выбрана не вкладка, а окно или весь экран. " +
          "Скриншоты и подсветка элементов могут не совпасть с действиями — " +
          "для лучшего результата остановите и выберите текущую вкладку.",
      );
    }
  } catch (error) {
    setRecordingUi(false);
    const raw = error instanceof Error ? error.message : String(error);
    if (raw.includes("Receiving end does not exist")) {
      setError(
        "Расширение не успело подготовиться. Обновите его на chrome://extensions/ (кнопка ↻) и попробуйте снова.",
      );
      return;
    }
    if (raw.includes("Permission dismissed") || raw.includes("NotAllowedError")) {
      setError("Нужно разрешить захват вкладки и микрофон в диалоге Chrome.");
      return;
    }
    setError(raw);
  }
});

stopBtn.addEventListener("click", async () => {
  setError("");
  stopBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: MSG.STOP_RECORDING,
    });

    if (!response?.ok) {
      throw new Error(response?.error ?? "Не удалось остановить запись");
    }

    const videoBlob = response.videoBase64
      ? base64ToBlob(response.videoBase64, "video/webm")
      : null;
    const micBlob = base64ToBlob(response.micBase64, "audio/webm");

    if (videoBlob && videoBlob.size === 0) {
      throw new Error("Получен пустой video.webm");
    }
    if (micBlob.size === 0) {
      throw new Error("Получен пустой mic.webm");
    }

    const meta = response.meta;
    if (!meta?.t0 || typeof meta.t0 !== "number") {
      throw new Error("В meta отсутствует t0");
    }
    if (
      typeof meta.videoDurationMs !== "number" ||
      typeof meta.micDurationMs !== "number"
    ) {
      throw new Error("В meta отсутствуют длительности дорожек");
    }

    if (videoBlob) {
      downloadBlob(videoBlob, "video.webm");
    }
    downloadBlob(micBlob, "mic.webm");
    downloadBlob(
      new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" }),
      "meta.json",
    );

    const timeline = response.timeline ?? {
      meta,
      events: response.events ?? [],
      screenshots: response.screenshots ?? [],
    };
    downloadBlob(
      new Blob([JSON.stringify(timeline, null, 2)], { type: "application/json" }),
      "timeline.json",
    );

    const screenshotImages = response.screenshotImages ?? {};
    for (const shot of timeline.screenshots ?? []) {
      const imageBase64 = screenshotImages[shot.id];
      if (!imageBase64) {
        continue;
      }
      downloadBlob(base64ToBlob(imageBase64, "image/jpeg"), `${shot.id}.jpg`);
    }

    pendingArtifacts = {
      micBlob,
      videoBlob,
      timeline,
      screenshotImages,
    };

    hasLastRecording = true;
    setRecordingUi(false);

    const eventCount = timeline.events?.length ?? 0;
    const screenshotCount = timeline.screenshots?.length ?? 0;
    const videoPart = videoBlob
      ? `видео ${(videoBlob.size / 1024).toFixed(1)} КБ, `
      : "";
    statusEl.textContent = `Сохранено: ${videoPart}mic ${(micBlob.size / 1024).toFixed(1)} КБ, событий ${eventCount}, скринов ${screenshotCount}`;
  } catch (error) {
    setRecordingUi(false);
    setError(error instanceof Error ? error.message : String(error));
  }
});

editorBtn.addEventListener("click", async () => {
  if (!pendingArtifacts) {
    setError("Нет артефактов для отправки — сначала остановите запись");
    return;
  }

  setError("");
  editorBtn.disabled = true;

  try {
    await persistBackendUrl();
    const baseUrl = normalizeBackendUrl(backendUrlInput.value);

    const result = await uploadAndOpenEditor({
      baseUrl,
      micBlob: pendingArtifacts.micBlob,
      videoBlob: pendingArtifacts.videoBlob,
      timeline: pendingArtifacts.timeline,
      screenshotImages: pendingArtifacts.screenshotImages,
      openEditor: (url) => {
        chrome.tabs.create({ url });
      },
    });

    await chrome.storage.local.set({
      backendBaseUrl: baseUrl,
      lastRecording: {
        recordingId: result.recordingId,
        meta: pendingArtifacts.timeline.meta,
        events: pendingArtifacts.timeline.events ?? [],
        screenshots: pendingArtifacts.timeline.screenshots ?? [],
        uploaded: true,
        savedAt: Date.now(),
      },
    });

    hasLastRecording = true;
    statusEl.textContent = `Отправлено на сервер. Редактор: ${result.recordingId}`;
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    editorBtn.disabled = false;
    updateControls();
  }
});

deleteBtn.addEventListener("click", async () => {
  setError("");
  deleteBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: MSG.DELETE_RECORDING,
    });

    if (!response?.ok) {
      throw new Error(response?.error ?? "Не удалось удалить запись");
    }

    hasLastRecording = false;
    pendingArtifacts = null;
    updateControls();
    statusEl.textContent = response.deleted
      ? "Локальная запись удалена"
      : "Нечего удалять";
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    deleteBtn.disabled = false;
  }
});

refreshState();
