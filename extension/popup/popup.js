import { MSG } from "../lib/messages.js";

const idleSection = document.getElementById("idleSection");
const activeSection = document.getElementById("activeSection");
const readySection = document.getElementById("readySection");
const errorSection = document.getElementById("errorSection");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const openEditorBtn = document.getElementById("openEditorBtn");
const newRecordingBtn = document.getElementById("newRecordingBtn");
const retryBtn = document.getElementById("retryBtn");
const deleteBtn = document.getElementById("deleteBtn");
const consentCheckbox = document.getElementById("consentCheckbox");
const consentPanel = document.getElementById("consentPanel");
const keepVideoCheckbox = document.getElementById("keepVideoCheckbox");
const backendUrlInput = document.getElementById("backendUrlInput");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const recordingHint = document.getElementById("recordingHint");
const processingHint = document.getElementById("processingHint");

if (
  !(idleSection instanceof HTMLElement) ||
  !(activeSection instanceof HTMLElement) ||
  !(readySection instanceof HTMLElement) ||
  !(errorSection instanceof HTMLElement) ||
  !(startBtn instanceof HTMLButtonElement) ||
  !(stopBtn instanceof HTMLButtonElement) ||
  !(openEditorBtn instanceof HTMLButtonElement) ||
  !(newRecordingBtn instanceof HTMLButtonElement) ||
  !(retryBtn instanceof HTMLButtonElement) ||
  !(deleteBtn instanceof HTMLButtonElement) ||
  !(consentCheckbox instanceof HTMLInputElement) ||
  !(consentPanel instanceof HTMLElement) ||
  !(keepVideoCheckbox instanceof HTMLInputElement) ||
  !(backendUrlInput instanceof HTMLInputElement) ||
  !(statusEl instanceof HTMLParagraphElement) ||
  !(errorEl instanceof HTMLParagraphElement) ||
  !(progressWrap instanceof HTMLElement) ||
  !(progressFill instanceof HTMLElement) ||
  !(progressLabel instanceof HTMLParagraphElement) ||
  !(recordingHint instanceof HTMLParagraphElement) ||
  !(processingHint instanceof HTMLParagraphElement)
) {
  throw new Error("Popup markup is invalid");
}

const DEFAULT_BACKEND_URL = "https://training-recorder-production.up.railway.app";

/** @type {string | null} */
let editorUrl = null;

function setError(message) {
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = message;
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

function showProgress(progress, label) {
  progressWrap.hidden = false;
  progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  progressLabel.textContent = label;
}

function hideProgress() {
  progressWrap.hidden = true;
  progressFill.style.width = "0%";
  progressLabel.textContent = "";
}

/** @param {import("../lib/workflow-state.js").WorkflowState} workflow */
function renderWorkflow(workflow) {
  idleSection.classList.add("hidden");
  activeSection.classList.add("hidden");
  readySection.classList.add("hidden");
  errorSection.classList.add("hidden");
  deleteBtn.hidden = true;

  statusEl.textContent = workflow.statusText || "Готов к записи";
  setError(workflow.error || "");

  if (
    workflow.phase === "uploading" ||
    workflow.phase === "processing" ||
    workflow.phase === "stopping"
  ) {
    showProgress(workflow.progress ?? 0, workflow.statusText || "Обработка…");
  } else {
    hideProgress();
  }

  switch (workflow.phase) {
    case "idle":
      idleSection.classList.remove("hidden");
      startBtn.disabled = !consentCheckbox.checked;
      break;
    case "requesting_permissions":
      idleSection.classList.remove("hidden");
      startBtn.disabled = true;
      showProgress(workflow.progress ?? 5, workflow.statusText || "Запрос доступа…");
      break;
    case "recording":
      activeSection.classList.remove("hidden");
      recordingHint.hidden = false;
      processingHint.hidden = true;
      break;
    case "stopping":
    case "uploading":
    case "processing":
      activeSection.classList.remove("hidden");
      recordingHint.hidden = true;
      processingHint.hidden = false;
      stopBtn.disabled = true;
      break;
    case "ready":
      readySection.classList.remove("hidden");
      editorUrl = workflow.editorUrl ?? editorUrl;
      deleteBtn.hidden = false;
      break;
    case "error":
      errorSection.classList.remove("hidden");
      idleSection.classList.remove("hidden");
      startBtn.disabled = !consentCheckbox.checked;
      break;
    default:
      idleSection.classList.remove("hidden");
  }
}

async function refreshWorkflow() {
  const storageData = await chrome.storage.local.get(["backendBaseUrl", "lastEditorUrl"]);
  if (typeof storageData.backendBaseUrl === "string") {
    backendUrlInput.value = storageData.backendBaseUrl;
  }
  if (typeof storageData.lastEditorUrl === "string") {
    editorUrl = storageData.lastEditorUrl;
  }

  const response = await chrome.runtime.sendMessage({ type: MSG.RECORDING_STATE });
  if (response?.ok && response.workflow) {
    renderWorkflow(response.workflow);
  }
}

async function preauthorizeMicrophone() {
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } finally {
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  }
}

startBtn.addEventListener("click", () => {
  void (async () => {
    setError("");
    if (!consentCheckbox.checked) {
      setError("Нужно согласие перед началом записи");
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setError("Не найдена активная вкладка");
      return;
    }

    startBtn.disabled = true;
    statusEl.textContent = "Разрешите микрофон в Chrome…";

    try {
      await persistBackendUrl();
      await preauthorizeMicrophone();
      const response = await chrome.runtime.sendMessage({
        type: MSG.START_RECORDING,
        keepVideo: keepVideoCheckbox.checked,
        tabId: tab.id,
      });
      if (!response?.ok) {
        throw new Error(response?.error ?? "Не удалось начать запись");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      await refreshWorkflow();
    }
  })();
});

stopBtn.addEventListener("click", () => {
  void (async () => {
    stopBtn.disabled = true;
    setError("");
    try {
      const response = await chrome.runtime.sendMessage({ type: MSG.STOP_AND_PROCESS });
      if (!response?.ok) {
        throw new Error(response?.error ?? "Не удалось остановить запись");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      await refreshWorkflow();
      stopBtn.disabled = false;
    }
  })();
});

openEditorBtn.addEventListener("click", () => {
  if (editorUrl) {
    chrome.tabs.create({ url: editorUrl });
  }
});

newRecordingBtn.addEventListener("click", () => {
  void (async () => {
    await chrome.runtime.sendMessage({ type: MSG.RESET_WORKFLOW });
    await refreshWorkflow();
  })();
});

retryBtn.addEventListener("click", () => {
  void (async () => {
    await chrome.runtime.sendMessage({ type: MSG.RESET_WORKFLOW });
    await refreshWorkflow();
  })();
});

deleteBtn.addEventListener("click", () => {
  void (async () => {
    deleteBtn.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: MSG.DELETE_RECORDING });
      if (!response?.ok) {
        throw new Error(response?.error ?? "Не удалось удалить");
      }
      editorUrl = null;
      statusEl.textContent = "Запись удалена";
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      deleteBtn.disabled = false;
      await refreshWorkflow();
    }
  })();
});

consentCheckbox.addEventListener("change", () => {
  startBtn.disabled = !consentCheckbox.checked;
});

backendUrlInput.addEventListener("change", () => {
  void persistBackendUrl();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.trWorkflow) {
    void refreshWorkflow();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MSG.RECORDING_DONE && message.editorUrl) {
    editorUrl = message.editorUrl;
    void refreshWorkflow();
  }
});

refreshWorkflow();
