import { MSG } from "./lib/messages.js";
import { generateRecordingId } from "./lib/recording-meta.js";
import {
  deleteAllRecordingArtifacts,
  hasStoredRecording,
} from "./lib/recording-artifacts.js";

const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");
const OFFSCREEN_TARGET = "offscreen";

/** @type {Promise<void> | null} */
let offscreenCreating = null;

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
        justification: "Запись видео активной вкладки для обучающей документации",
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
  throw new Error("Offscreen-документ не ответил — перезагрузите расширение");
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
    throw new Error("Offscreen не ответил на команду");
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

// Буфер артефактов в storage.local переживает навигацию вкладки (см. content.js).
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

/** @type {{ recordingId: string; tabId: number; t0: number | null } | null} */
let activeSession = null;

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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("Не найдена активная вкладка");
  }
  if (isRestrictedTabUrl(tab.url)) {
    throw new Error(
      "Нельзя записывать эту страницу (chrome://, Web Store и служебные вкладки). " +
        "Откройте обычный сайт и нажмите «Запись» снова.",
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
      "content/stabilizer.js",
      "content/content.js",
    ],
  });

  return chrome.tabs.sendMessage(tabId, {
    type: MSG.CONTENT_START,
    payload,
  });
}

async function collectContentArtifacts(tabId, recordingId) {
  // Буфер из storage.local — авторитетный источник: он переживает навигацию, даже
  // если в момент стопа живого content script на странице нет.
  const buffered = await readBufferedArtifacts(recordingId);
  if (buffered.events.length || buffered.screenshots.length) {
    return buffered;
  }

  // Запасной путь: вкладка не навигировала, спросим живой content script.
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
    // вкладка могла закрыться
  }
}

async function startRecording({ keepVideo = false } = {}) {
  if (activeSession) {
    throw new Error("Запись уже идёт");
  }

  const tab = await getActiveTab();
  const recordingId = generateRecordingId();

  await ensureOffscreenDocument();

  const startResponse = await sendToOffscreen({
    type: MSG.OFFSCREEN_START,
    payload: {
      recordingId,
      url: tab.url ?? "",
      title: tab.title ?? "",
      keepVideo,
    },
  });

  if (!startResponse?.ok) {
    await closeOffscreenDocument();
    throw new Error(startResponse?.error ?? "Не удалось начать запись в offscreen");
  }

  if (!startResponse.t0) {
    await closeOffscreenDocument();
    throw new Error("Offscreen не вернул t0");
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
    if (message.includes("Cannot access") || message.includes("extensions gallery")) {
      throw new Error(
        "Нельзя записать эту страницу. Откройте обычный сайт (не chrome:// и не Web Store).",
      );
    }
    throw error instanceof Error
      ? error
      : new Error("Не удалось запустить сбор событий на странице");
  }

  activeSession = { recordingId, tabId: tab.id, t0: startResponse.t0 ?? null };
  setRecordingBadge(true);

  await chrome.storage.session.set({
    recordingActive: true,
    recordingId,
    recordingTabId: tab.id,
  });

  return {
    ok: true,
    recordingId,
    displaySurface: startResponse.displaySurface ?? null,
  };
}

async function stopRecording() {
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
  await chrome.storage.session.set({
    recordingActive: false,
    recordingId: null,
    recordingTabId: null,
  });

  await closeOffscreenDocument();

  if (!stopResponse?.ok) {
    throw new Error(stopResponse?.error ?? "Не удалось остановить запись");
  }

  await chrome.storage.local.set({
    lastRecording: {
      recordingId: stopResponse.meta.recordingId,
      meta: stopResponse.meta,
      events,
      screenshots,
      uploaded: false,
      videoByteLength: stopResponse.videoByteLength,
      micByteLength: stopResponse.micByteLength,
      savedAt: Date.now(),
    },
  });

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target === OFFSCREEN_TARGET) {
    return false;
  }

  if (message.type === MSG.START_RECORDING) {
    startRecording({ keepVideo: Boolean(message.keepVideo) })
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === MSG.STOP_RECORDING) {
    stopRecording()
      .then((result) => sendResponse(result))
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
    chrome.storage.session
      .get(["recordingActive", "recordingId"])
      .then(async (sessionData) => {
        const localData = await chrome.storage.local.get(["lastRecording"]);
        sendResponse({
          ok: true,
          isRecording: Boolean(sessionData.recordingActive),
          recordingId: sessionData.recordingId ?? null,
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

// Реинъекция content script после полной навигации записываемой вкладки: новый
// документ уничтожает старый скрипт, поднимаем заново с тем же t0/recordingId —
// накопленные артефакты подхватятся из буфера (rehydrate в content.js).
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
    // about:/chrome:// или закрытая вкладка — пропускаем
  });
});
