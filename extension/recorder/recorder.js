import { MSG } from "../lib/messages.js";
import {
  formatMediaPermissionError,
  requestCapturePermissionsSequential,
} from "../lib/media-permissions.js";
import { RecordingEngine } from "../lib/recording-engine.js";
import { generateRecordingId } from "../lib/recording-meta.js";
import {
  base64ToBlob,
  buildEditorUrl,
  uploadRecording,
} from "../lib/upload-recording.js";

const RECORDER_TARGET = "recorder";
const DEFAULT_BACKEND_URL = "https://training-recorder-production.up.railway.app";

const params = new URLSearchParams(window.location.search);
const configuredTabId = Number(params.get("tabId"));
const keepVideo = params.get("keepVideo") === "1";
const autostart = params.get("autostart") === "1";

const timerEl = document.getElementById("timer");
const statusEl = document.getElementById("status");
const stopBtn = document.getElementById("stopBtn");
const recordingSection = document.getElementById("recordingSection");
const uploadingSection = document.getElementById("uploadingSection");
const doneSection = document.getElementById("doneSection");
const errorSection = document.getElementById("errorSection");
const errorEl = document.getElementById("error");
const openEditorBtn = document.getElementById("openEditorBtn");
const closeBtn = document.getElementById("closeBtn");
const retryBtn = document.getElementById("retryBtn");

if (
  !(timerEl instanceof HTMLParagraphElement) ||
  !(statusEl instanceof HTMLParagraphElement) ||
  !(stopBtn instanceof HTMLButtonElement) ||
  !(recordingSection instanceof HTMLElement) ||
  !(uploadingSection instanceof HTMLElement) ||
  !(doneSection instanceof HTMLElement) ||
  !(errorSection instanceof HTMLElement) ||
  !(errorEl instanceof HTMLParagraphElement) ||
  !(openEditorBtn instanceof HTMLButtonElement) ||
  !(closeBtn instanceof HTMLButtonElement) ||
  !(retryBtn instanceof HTMLButtonElement)
) {
  throw new Error("Recorder markup is invalid");
}

const engine = new RecordingEngine();
/** @type {number | null} */
let timerInterval = null;
/** @type {number} */
let elapsedSeconds = 0;
/** @type {string | null} */
let lastEditorUrl = null;

function showSection(name) {
  recordingSection.classList.toggle("hidden", name !== "recording");
  uploadingSection.classList.toggle("hidden", name !== "uploading");
  doneSection.classList.toggle("hidden", name !== "done");
  errorSection.classList.toggle("hidden", name !== "error");
}

function setStatus(text) {
  statusEl.textContent = text;
}

function startTimer() {
  elapsedSeconds = 0;
  timerEl.hidden = false;
  timerEl.textContent = "00:00";
  timerInterval = window.setInterval(() => {
    elapsedSeconds += 1;
    const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
    const seconds = String(elapsedSeconds % 60).padStart(2, "0");
    timerEl.textContent = `${minutes}:${seconds}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval != null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function resolveTargetTab() {
  if (Number.isFinite(configuredTabId) && configuredTabId > 0) {
    return chrome.tabs.get(configuredTabId);
  }
  throw new Error(
    "Не указана вкладка. Закройте окно и нажмите «Запись» в иконке расширения на нужном сайте.",
  );
}

async function getBackendBaseUrl() {
  const data = await chrome.storage.local.get(["backendBaseUrl"]);
  if (typeof data.backendBaseUrl === "string" && data.backendBaseUrl.trim()) {
    return data.backendBaseUrl.trim().replace(/\/$/, "");
  }
  return DEFAULT_BACKEND_URL;
}

async function startRecordingFlow() {
  showSection("recording");
  stopBtn.hidden = true;
  setStatus("Разрешите доступ в диалогах Chrome: сначала вкладка/экран, затем микрофон…");

  let micStream = null;
  let displayStream = null;

  try {
    ({ micStream, displayStream } = await requestCapturePermissionsSequential());

    const tab = await resolveTargetTab();
    const recordingId = generateRecordingId();

    const { t0, displaySurface } = await engine.startFromStreams({
      recordingId,
      url: tab.url ?? "",
      title: tab.title ?? "",
      keepVideo,
      displayStream,
      micStream,
    });

    const sessionResponse = await chrome.runtime.sendMessage({
      type: MSG.SESSION_BEGIN,
      tabId: tab.id,
      recordingId,
      t0,
      displaySurface,
    });

    if (!sessionResponse?.ok) {
      throw new Error(sessionResponse?.error ?? "Не удалось начать сбор действий на странице");
    }

    const videoTrack = displayStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        void stopAndUpload();
      };
    }

    stopBtn.hidden = false;
    startTimer();
    setStatus("Идёт запись. Работайте на сайте, затем нажмите «Остановить».");
  } catch (error) {
    try {
      await engine.stop();
    } catch {
      if (micStream) {
        for (const track of micStream.getTracks()) {
          track.stop();
        }
      }
      if (displayStream) {
        for (const track of displayStream.getTracks()) {
          track.stop();
        }
      }
    }
    showError(error);
  }
}

function showError(error) {
  stopTimer();
  timerEl.hidden = true;
  showSection("error");
  errorEl.textContent =
    error instanceof Error ? error.message : formatMediaPermissionError(error);
  setStatus("Ошибка");
}

async function stopAndUpload() {
  if (!engine.isRecording && !timerInterval) {
    return;
  }

  stopBtn.disabled = true;
  stopTimer();
  timerEl.hidden = true;
  showSection("uploading");
  setStatus("Отправляем на сервер…");

  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.STOP_RECORDING });
    if (!response?.ok) {
      throw new Error(response?.error ?? "Не удалось остановить запись");
    }

    const micBlob = base64ToBlob(response.micBase64, "audio/webm");
    const videoBlob = response.videoBase64
      ? base64ToBlob(response.videoBase64, "video/webm")
      : null;

    if (micBlob.size === 0) {
      throw new Error("Получен пустой файл микрофона");
    }

    const timeline = response.timeline ?? {
      meta: response.meta,
      events: response.events ?? [],
      screenshots: response.screenshots ?? [],
    };

    const baseUrl = await getBackendBaseUrl();
    setStatus("Загружаем аудио и скрины на сервер…");

    const uploadResult = await uploadRecording({
      baseUrl,
      micBlob,
      videoBlob,
      timeline,
      screenshotImages: response.screenshotImages ?? {},
    });

    lastEditorUrl = buildEditorUrl(baseUrl, uploadResult.recordingId);
    await chrome.storage.local.set({
      backendBaseUrl: baseUrl,
      lastEditorUrl,
      lastRecording: {
        recordingId: uploadResult.recordingId,
        meta: timeline.meta,
        events: timeline.events ?? [],
        screenshots: timeline.screenshots ?? [],
        uploaded: true,
        savedAt: Date.now(),
      },
    });

    chrome.runtime
      .sendMessage({
        type: MSG.RECORDING_DONE,
        recordingId: uploadResult.recordingId,
        editorUrl: lastEditorUrl,
      })
      .catch(() => undefined);

    chrome.tabs.create({ url: lastEditorUrl });
    showSection("done");
    setStatus("Whisper расшифрует голос — редактор уже открывается в новой вкладке.");
  } catch (error) {
    showError(error);
  } finally {
    stopBtn.disabled = false;
  }
}

stopBtn.addEventListener("click", () => {
  void stopAndUpload();
});

openEditorBtn.addEventListener("click", () => {
  if (lastEditorUrl) {
    chrome.tabs.create({ url: lastEditorUrl });
  }
});

closeBtn.addEventListener("click", () => {
  window.close();
});

retryBtn.addEventListener("click", () => {
  const url = new URL(window.location.href);
  url.searchParams.set("autostart", "1");
  window.location.href = url.toString();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== RECORDER_TARGET) {
    return false;
  }

  if (message.type === MSG.OFFSCREEN_CAPTURE_FRAMES) {
    engine
      .captureFrames(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === MSG.OFFSCREEN_STOP) {
    engine
      .stop()
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  return false;
});

async function init() {
  const state = await chrome.runtime.sendMessage({ type: MSG.RECORDING_STATE });
  if (state?.ok && state.isRecording) {
    showSection("recording");
    stopBtn.hidden = false;
    startTimer();
    setStatus("Идёт запись…");
    return;
  }

  if (autostart) {
    void startRecordingFlow();
    return;
  }

  setStatus("Закройте окно и нажмите «Запись» в иконке расширения.");
}

init();
