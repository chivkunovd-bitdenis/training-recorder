import { MSG } from "./lib/messages.js";
import { generateRecordingId } from "./lib/recording-meta.js";
import { runFullPipeline } from "./lib/process-pipeline.js";
import {
  deleteAllRecordingArtifacts,
  hasStoredRecording,
} from "./lib/recording-artifacts.js";
import {
  getWorkflow,
  resetWorkflow,
  setWorkflow,
} from "./lib/workflow-state.js";

const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");
const OFFSCREEN_TARGET = "offscreen";

/** @type {Promise<void> | null} */
let offscreenCreating = null;
/** @type {Promise<void> | null} */
let pipelineRunning = null;

/** @type {{ recordingId: string; tabId: number; t0: number | null } | null} */
let activeSession = null;

async function hasOffscreenDocument() {
  if (chrome.offscreen.hasDocument) {
    return chrome.offscreen.hasDocument();
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    await waitForOffscreenReady();
    return;
  }

  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["USER_MEDIA", "DISPLAY_MEDIA"],
        justification: "Запись вкладки и микрофона для обучающей документации",
      })
      .finally(() => {
        offscreenCreating = null;
      });
  }

  await offscreenCreating;
  await waitForOffscreenReady();
}

async function waitForOffscreenReady() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MSG.OFFSCREEN_PING,
        target: OFFSCREEN_TARGET,
      });
      if (response?.ok) {
        return;
      }
    } catch {
      // offscreen ещё грузится
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error("Offscreen не ответил — перезагрузите расширение (↻)");
}

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    ...message,
    target: OFFSCREEN_TARGET,
  });
  if (response === undefined) {
    throw new Error("Offscreen не ответил");
  }
  return response;
}

function setRecordingBadge(active) {
  if (active) {
    chrome.action.setBadgeText({ text: "REC" });
    chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
    return;
  }
  chrome.action.setBadgeText({ text: "" });
}

const bufferKeys = (recordingId) => [
  `tr_buffer_${recordingId}`,
  `tr_buffer_img_${recordingId}`,
];

async function readBufferedArtifacts(recordingId) {
  const [eventsKey, imagesKey] = bufferKeys(recordingId);
  const data = await chrome.storage.local.get([eventsKey, imagesKey]);
  const buffered = data[eventsKey];
  const images = data[imagesKey];
  return {
    events: Array.isArray(buffered?.events) ? buffered.events : [],
    screenshots: Array.isArray(buffered?.screenshots) ? buffered.screenshots : [],
    screenshotImages: images && typeof images === "object" ? images : {},
  };
}

async function clearBufferedArtifacts(recordingId) {
  try {
    await chrome.storage.local.remove(bufferKeys(recordingId));
  } catch {
    // ignore
  }
}

function isRestrictedTabUrl(url) {
  if (!url) {
    return true;
  }
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("https://chrome.google.com/webstore")
  );
}

async function resolveRecordingTab(tabId) {
  if (typeof tabId === "number") {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.id) {
      throw new Error("Вкладка для записи не найдена");
    }
    if (isRestrictedTabUrl(tab.url)) {
      throw new Error(
        "Нельзя записывать эту страницу. Откройте обычный сайт и нажмите «Запись» снова.",
      );
    }
    return tab;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("Не найдена активная вкладка");
  }
  if (isRestrictedTabUrl(tab.url)) {
    throw new Error(
      "Нельзя записывать эту страницу. Откройте обычный сайт и нажмите «Запись» снова.",
    );
  }
  return tab;
}

async function injectContentRecorder(tabId, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "content/bridge.js",
      "content/masking.js",
      "content/dom-context.js",
      "lib/annotation-geometry.js",
      "content/stabilizer.js",
      "content/overlay.js",
      "content/content.js",
    ],
  });

  const contentStart = await chrome.tabs.sendMessage(tabId, {
    type: MSG.CONTENT_START,
    payload,
  });

  if (contentStart?.ok) {
    await chrome.tabs.sendMessage(tabId, {
      type: MSG.CONTENT_OVERLAY_START,
      payload: { t0: payload.t0 },
    });
  }

  return contentStart;
}

async function hideRecordingOverlay(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: MSG.CONTENT_OVERLAY_STOP });
  } catch {
    // ignore
  }
}

async function collectContentArtifacts(tabId, recordingId) {
  const buffered = await readBufferedArtifacts(recordingId);
  if (buffered.events.length || buffered.screenshots.length) {
    return buffered;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: MSG.CONTENT_GET_EVENTS,
    });
    if (response?.ok) {
      return {
        events: Array.isArray(response.events) ? response.events : [],
        screenshots: Array.isArray(response.screenshots) ? response.screenshots : [],
        screenshotImages:
          response.screenshotImages && typeof response.screenshotImages === "object"
            ? response.screenshotImages
            : {},
      };
    }
  } catch {
    return buffered;
  }
  return buffered;
}

async function stopContentRecorder(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: MSG.CONTENT_STOP });
  } catch {
    // ignore
  }
  await hideRecordingOverlay(tabId);
}

async function startRecording({ keepVideo = false, tabId = null } = {}) {
  const workflow = await getWorkflow();
  if (workflow.phase === "recording" || activeSession) {
    throw new Error("Запись уже идёт");
  }
  if (pipelineRunning) {
    throw new Error("Идёт обработка предыдущей записи — дождитесь завершения");
  }

  await setWorkflow({
    phase: "requesting_permissions",
    progress: 5,
    statusText: "Разрешите микрофон в Chrome…",
    error: "",
    keepVideo,
  });

  const tab = await resolveRecordingTab(tabId);
  const recordingId = generateRecordingId();

  let tabStreamId;
  try {
    tabStreamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (error) {
    await setWorkflow({
      phase: "error",
      progress: 0,
      statusText: "Не удалось получить вкладку",
      error: "Обновите страницу и попробуйте снова.",
    });
    throw error instanceof Error ? error : new Error(String(error));
  }

  await ensureOffscreenDocument();

  const startResponse = await sendToOffscreen({
    type: MSG.OFFSCREEN_START,
    payload: {
      recordingId,
      url: tab.url ?? "",
      title: tab.title ?? "",
      keepVideo,
      tabStreamId,
    },
  });

  if (!startResponse?.ok || !startResponse.t0) {
    await closeOffscreenDocument();
    const errorText = startResponse?.error ?? "Не удалось начать запись";
    await setWorkflow({
      phase: "error",
      progress: 0,
      statusText: "Ошибка старта",
      error: errorText,
    });
    throw new Error(errorText);
  }

  try {
    const contentStart = await injectContentRecorder(tab.id, {
      t0: startResponse.t0,
      recordingId,
    });
    if (!contentStart?.ok) {
      throw new Error(contentStart?.error ?? "Content script не стартовал");
    }
  } catch (error) {
    await sendToOffscreen({ type: MSG.OFFSCREEN_STOP }).catch(() => undefined);
    await closeOffscreenDocument();
    setRecordingBadge(false);
    const message = error instanceof Error ? error.message : String(error);
    await setWorkflow({
      phase: "error",
      progress: 0,
      statusText: "Не удалось начать запись на странице",
      error: message,
    });
    throw error instanceof Error ? error : new Error(message);
  }

  activeSession = {
    recordingId,
    tabId: tab.id,
    t0: startResponse.t0,
  };
  setRecordingBadge(true);

  await setWorkflow({
    phase: "recording",
    recordingId,
    tabId: tab.id,
    startedAt: Date.now(),
    t0: startResponse.t0,
    progress: 0,
    statusText: "Идёт запись — плашка REC в углу страницы",
    error: "",
    editorUrl: "",
  });

  return { ok: true, recordingId };
}

async function stopRecordingInternal() {
  if (!activeSession) {
    throw new Error("Запись не была начата");
  }

  const tabId = activeSession.tabId;
  const recordingId = activeSession.recordingId;
  const { events, screenshots, screenshotImages } = await collectContentArtifacts(
    tabId,
    recordingId,
  );

  const stopResponse = await sendToOffscreen({ type: MSG.OFFSCREEN_STOP });

  await stopContentRecorder(tabId);
  await clearBufferedArtifacts(recordingId);

  activeSession = null;
  setRecordingBadge(false);
  await closeOffscreenDocument();

  if (!stopResponse?.ok) {
    throw new Error(stopResponse?.error ?? "Не удалось остановить запись");
  }

  return {
    ...stopResponse,
    events,
    screenshots,
    screenshotImages,
    timeline: {
      meta: stopResponse.meta,
      events,
      screenshots,
    },
  };
}

async function stopAndProcess() {
  if (pipelineRunning) {
    await pipelineRunning;
    return getWorkflow();
  }

  const workflow = await getWorkflow();
  if (workflow.phase !== "recording" && !activeSession) {
    if (workflow.phase === "ready" || workflow.phase === "processing") {
      return workflow;
    }
    throw new Error("Нет активной записи");
  }

  pipelineRunning = (async () => {
    try {
      await setWorkflow({
        phase: "stopping",
        progress: 10,
        statusText: "Останавливаем запись…",
        error: "",
      });

      const stopResponse = await stopRecordingInternal();

      await setWorkflow({
        phase: "uploading",
        progress: 25,
        statusText: "Отправляем на сервер…",
      });

      const result = await runFullPipeline(stopResponse, async (progress, statusText) => {
        const phase = progress >= 45 ? "processing" : "uploading";
        await setWorkflow({ phase, progress, statusText });
      });

      await setWorkflow({
        phase: "ready",
        progress: 100,
        recordingId: result.recordingId,
        editorUrl: result.editorUrl,
        statusText: "Готово — инструкция в редакторе",
        error: "",
      });

      chrome.tabs.create({ url: result.editorUrl }).catch(() => undefined);
      chrome.runtime
        .sendMessage({
          type: MSG.RECORDING_DONE,
          recordingId: result.recordingId,
          editorUrl: result.editorUrl,
        })
        .catch(() => undefined);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setWorkflow({
        phase: "error",
        progress: 0,
        statusText: "Ошибка обработки",
        error: message,
      });
      throw error instanceof Error ? error : new Error(message);
    } finally {
      pipelineRunning = null;
    }
  })();

  await pipelineRunning;
  return getWorkflow();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target === OFFSCREEN_TARGET) {
    return false;
  }

  if (message.type === MSG.START_RECORDING) {
    startRecording({
      keepVideo: Boolean(message.keepVideo),
      tabId: typeof message.tabId === "number" ? message.tabId : null,
    })
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === MSG.STOP_AND_PROCESS || message.type === MSG.STOP_RECORDING) {
    stopAndProcess()
      .then((workflow) => sendResponse({ ok: true, workflow }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === MSG.RESET_WORKFLOW) {
    resetWorkflow()
      .then((workflow) => sendResponse({ ok: true, workflow }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === MSG.CAPTURE_FRAMES) {
    sendToOffscreen({
      type: MSG.OFFSCREEN_CAPTURE_FRAMES,
      payload: message.payload,
    })
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === MSG.DELETE_RECORDING) {
    deleteAllRecordingArtifacts({
      storage: chrome.storage,
      getBackendBaseUrl: async () => {
        const data = await chrome.storage.local.get(["backendBaseUrl"]);
        return typeof data.backendBaseUrl === "string" ? data.backendBaseUrl : null;
      },
    })
      .then(async (result) => {
        if (result.recordingId) {
          await clearBufferedArtifacts(result.recordingId);
        }
        await resetWorkflow();
        sendResponse(result);
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === MSG.RECORDING_STATE) {
    getWorkflow()
      .then(async (workflow) => {
        const localData = await chrome.storage.local.get(["lastRecording"]);
        sendResponse({
          ok: true,
          workflow,
          isRecording: workflow.phase === "recording",
          recordingId: workflow.recordingId ?? null,
          recordingStatus: workflow.phase,
          recordingError: workflow.error ?? "",
          hasLastRecording: hasStoredRecording(localData.lastRecording),
        });
      })
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (
    !activeSession ||
    tabId !== activeSession.tabId ||
    changeInfo.status !== "complete" ||
    activeSession.t0 == null
  ) {
    return;
  }
  injectContentRecorder(tabId, {
    t0: activeSession.t0,
    recordingId: activeSession.recordingId,
  }).catch(() => {
    // about:/chrome:// — пропускаем
  });
});

void (async () => {
  const workflow = await getWorkflow();
  if (workflow.phase === "recording" && workflow.recordingId && workflow.tabId) {
    activeSession = {
      recordingId: workflow.recordingId,
      tabId: workflow.tabId,
      t0: typeof workflow.t0 === "number" ? workflow.t0 : null,
    };
    setRecordingBadge(true);
  }
})();
