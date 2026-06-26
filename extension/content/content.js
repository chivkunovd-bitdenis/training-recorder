(() => {
  const MSG = globalThis.TrainingRecorderMSG;
  const Dom = globalThis.TrainingRecorderDom;
  const Stabilizer = globalThis.TrainingRecorderStabilizer;

  if (!MSG || !Dom || !Stabilizer) {
    throw new Error("Training Recorder content dependencies are not loaded");
  }

  // Защита от повторной инъекции в тот же документ (service worker может реинъектить
  // при навигации): слушатель сообщений должен быть один.
  if (window.__trContentInstalled) {
    return;
  }
  window.__trContentInstalled = true;

  const INPUT_DEBOUNCE_MS = 300;
  const NET_HOOK_SOURCE = "training-recorder-net-hook";

  // Буфер в chrome.storage.local переживает полную перезагрузку страницы: при навигации
  // content script уничтожается, поэтому события/скрины складываем в storage инкрементально,
  // а новый инстанс после реинъекции их подхватывает (rehydrate).
  const bufferKey = (recordingId) => `tr_buffer_${recordingId}`;
  const bufferImagesKey = (recordingId) => `tr_buffer_img_${recordingId}`;

  class EventRecorder {
    /**
     * @param {{ t0: number; recordingId: string }} options
     */
    constructor({ t0, recordingId }) {
      this.t0 = t0;
      this.recordingId = recordingId;
      this.bufferKey = bufferKey(recordingId);
      this.bufferImagesKey = bufferImagesKey(recordingId);
      /** @type {object[]} */
      this.events = [];
      /** @type {object[]} */
      this.screenshots = [];
      /** @type {Map<string, string>} */
      this.screenshotImages = new Map();
      this.sequence = 0;
      this.lastUrl = window.location.href;
      this.inputTimers = new WeakMap();
      this.seenModalElements = new WeakSet();
      this.networkActiveCount = 0;

      /** @type {Array<() => void>} */
      this.cleanups = [];

      this.stabilizer = new Stabilizer.StabilizerController({
        t0,
        onCapture: (payload) => {
          void this.requestScreenshot(payload);
        },
        getNetworkActiveCount: () => this.networkActiveCount,
      });
    }

    async start() {
      await this.rehydrate();
      this.injectNetHook();
      this.bindNetworkListener();
      this.bindHistory();
      this.bindListeners();
      this.bindModalObserver();
      this.stabilizer.start();
      this.recordNavigation("navigation");
    }

    async rehydrate() {
      try {
        const data = await chrome.storage.local.get([
          this.bufferKey,
          this.bufferImagesKey,
        ]);
        const buffered = data[this.bufferKey];
        if (buffered && typeof buffered === "object") {
          if (Array.isArray(buffered.events)) {
            this.events = buffered.events;
          }
          if (Array.isArray(buffered.screenshots)) {
            this.screenshots = buffered.screenshots;
          }
          // Продолжаем нумерацию, чтобы id событий не пересекались между инстансами.
          this.sequence = this.events.length;
          // lastUrl от предыдущего инстанса — чтобы start() записал переход на новый URL.
          const last = this.events[this.events.length - 1];
          if (last?.url) {
            this.lastUrl = last.url;
          }
        }
        const images = data[this.bufferImagesKey];
        if (images && typeof images === "object") {
          this.screenshotImages = new Map(Object.entries(images));
        }
      } catch {
        // storage недоступен — продолжаем с пустым буфером
      }
    }

    flushEvents() {
      try {
        void chrome.storage.local.set({
          [this.bufferKey]: {
            events: this.events,
            screenshots: this.screenshots,
          },
        });
      } catch {
        // игнорируем — буфер лучшее усилие
      }
    }

    flushImages() {
      try {
        void chrome.storage.local.set({
          [this.bufferImagesKey]: Object.fromEntries(this.screenshotImages),
        });
      } catch {
        // игнорируем
      }
    }

    stop() {
      this.stabilizer.stop();
      for (const cleanup of this.cleanups) {
        cleanup();
      }
      this.cleanups = [];
      this.inputTimers = new WeakMap();
    }

    getEvents() {
      return this.events.slice();
    }

    getScreenshots() {
      return this.screenshots.map((shot) => {
        const { imageBase64: _image, ...meta } = shot;
        return meta;
      });
    }

    getScreenshotImages() {
      return Object.fromEntries(this.screenshotImages.entries());
    }

    injectNetHook() {
      if (document.documentElement.dataset.trNetHookInjected === "1") {
        return;
      }
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("content/net-hook.js");
      script.async = false;
      (document.head || document.documentElement).appendChild(script);
      document.documentElement.dataset.trNetHookInjected = "1";
    }

    bindNetworkListener() {
      const onMessage = (event) => {
        if (event.source !== window) {
          return;
        }
        const data = event.data;
        if (!data || data.source !== NET_HOOK_SOURCE) {
          return;
        }
        this.networkActiveCount = Number(data.activeCount) || 0;
      };
      window.addEventListener("message", onMessage);
      this.cleanups.push(() => window.removeEventListener("message", onMessage));
    }

    /**
     * @param {{ eventId: string; ts: number; confidence: "high" | "low" }} payload
     */
    async requestScreenshot(payload) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: MSG.CAPTURE_FRAMES,
          payload: {
            recordingId: this.recordingId,
            eventId: payload.eventId,
            ts: payload.ts,
            confidence: payload.confidence,
          },
        });

        if (!response?.ok || !Array.isArray(response.screenshots)) {
          return;
        }

        for (const shot of response.screenshots) {
          if (shot.imageBase64) {
            this.screenshotImages.set(shot.id, shot.imageBase64);
          }
        }
        this.flushImages();

        const mainShot = response.screenshots.find(
          (shot) => shot.id === response.mainScreenshotId,
        );
        if (!mainShot || this.screenshots.some((existing) => existing.id === mainShot.id)) {
          return;
        }

        const { imageBase64: _image, byteLength: _byteLength, ...meta } = mainShot;
        this.screenshots.push({
          ...meta,
          eventId: payload.eventId,
          candidates: mainShot.candidates ?? [],
          // Размер вьюпорта на момент захвата — нужен, чтобы перевести bbox события
          // (CSS-пиксели) в пиксели кадра при аннотации на HiDPI.
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
        this.flushEvents();
      } catch {
        // offscreen мог быть недоступен
      }
    }

    bindHistory() {
      const originalPushState = history.pushState.bind(history);
      const originalReplaceState = history.replaceState.bind(history);

      history.pushState = (...args) => {
        originalPushState(...args);
        this.recordNavigation("navigation");
      };

      history.replaceState = (...args) => {
        originalReplaceState(...args);
        this.recordNavigation("navigation");
      };

      const onPopState = () => this.recordNavigation("navigation");
      const onHashChange = () => this.recordNavigation("navigation");

      window.addEventListener("popstate", onPopState);
      window.addEventListener("hashchange", onHashChange);

      this.cleanups.push(() => {
        history.pushState = originalPushState;
        history.replaceState = originalReplaceState;
        window.removeEventListener("popstate", onPopState);
        window.removeEventListener("hashchange", onHashChange);
      });
    }

    bindListeners() {
      const onClick = (event) => {
        const target = /** @type {Element | null} */ (event.target);
        if (!target) {
          return;
        }
        this.pushEvent("click", target);
      };

      const onFocusIn = (event) => {
        const target = /** @type {Element | null} */ (event.target);
        if (!target) {
          return;
        }
        this.pushEvent("focus", target);
      };

      const onInput = (event) => {
        const target = /** @type {Element | null} */ (event.target);
        if (!target) {
          return;
        }

        const existingTimer = this.inputTimers.get(target);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        const timer = window.setTimeout(() => {
          const value =
            "value" in target
              ? /** @type {HTMLInputElement | HTMLTextAreaElement} */ (target).value
              : null;
          this.pushEvent("input", target, value);
        }, INPUT_DEBOUNCE_MS);

        this.inputTimers.set(target, timer);
      };

      const onSubmit = (event) => {
        const target = /** @type {Element | null} */ (event.target);
        if (!target) {
          return;
        }
        this.pushEvent("submit", target);
      };

      const onKeyDown = (event) => {
        if (event.key !== "Enter") {
          return;
        }
        const target = /** @type {Element | null} */ (event.target);
        if (!target) {
          return;
        }
        this.pushEvent("keypress_enter", target);
      };

      const onChange = (event) => {
        const target = /** @type {Element | null} */ (event.target);
        if (!target || target.tagName.toLowerCase() !== "select") {
          return;
        }
        const select = /** @type {HTMLSelectElement} */ (target);
        this.pushEvent("menu_select", select, select.value);
      };

      document.addEventListener("click", onClick, true);
      document.addEventListener("focusin", onFocusIn, true);
      document.addEventListener("input", onInput, true);
      document.addEventListener("submit", onSubmit, true);
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("change", onChange, true);

      this.cleanups.push(() => {
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("focusin", onFocusIn, true);
        document.removeEventListener("input", onInput, true);
        document.removeEventListener("submit", onSubmit, true);
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("change", onChange, true);
      });
    }

    bindModalObserver() {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) {
              continue;
            }
            this.scanForModal(node);
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      this.cleanups.push(() => observer.disconnect());
      this.scanForModal(document.body);
    }

    /**
     * @param {Element} root
     */
    scanForModal(root) {
      if (Dom.isVisibleModal(root) && !this.seenModalElements.has(root)) {
        this.seenModalElements.add(root);
        this.pushEvent("modal_open", root);
      }

      const dialogs = root.querySelectorAll(
        '[role="dialog"], [role="alertdialog"], [aria-modal="true"]',
      );
      for (const dialog of dialogs) {
        if (Dom.isVisibleModal(dialog) && !this.seenModalElements.has(dialog)) {
          this.seenModalElements.add(dialog);
          this.pushEvent("modal_open", dialog);
        }
      }
    }

    /**
     * @param {string} type
     * @param {Element | null} [target]
     * @param {string | null} [value]
     */
    recordNavigation(type, target = null, value = null) {
      const currentUrl = window.location.href;
      if (type === "navigation" && currentUrl === this.lastUrl && this.events.length > 0) {
        return;
      }
      this.lastUrl = currentUrl;
      this.pushEvent(type, target, value);
    }

    /**
     * @param {string} type
     * @param {Element | null} [target]
     * @param {string | null} [value]
     */
    pushEvent(type, target = null, value = null) {
      this.sequence += 1;
      const event = Dom.createRecEvent({
        id: `evt-${this.recordingId}-${this.sequence}`,
        type,
        target,
        t0: this.t0,
        url: window.location.href,
        value,
      });
      this.events.push(event);
      this.flushEvents();

      if (Stabilizer.isSignificantAction(type, target, Dom)) {
        this.stabilizer.onSignificantAction(event.id, event.ts);
      }
    }
  }

  /** @type {EventRecorder | null} */
  let activeRecorder = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === MSG.CONTENT_START) {
      if (activeRecorder) {
        activeRecorder.stop();
      }
      activeRecorder = new EventRecorder(message.payload);
      activeRecorder
        .start()
        .then(() => sendResponse({ ok: true }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return true;
    }

    if (message.type === MSG.CONTENT_GET_EVENTS) {
      sendResponse({
        ok: true,
        events: activeRecorder?.getEvents() ?? [],
        screenshots: activeRecorder?.getScreenshots() ?? [],
        screenshotImages: activeRecorder?.getScreenshotImages() ?? {},
      });
      return true;
    }

    if (message.type === MSG.CONTENT_STOP) {
      activeRecorder?.stop();
      activeRecorder = null;
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
})();
