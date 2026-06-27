(() => {
  const MSG = globalThis.TrainingRecorderMSG;
  if (!MSG) {
    return;
  }

  if (window.__trOverlayInstalled) {
    return;
  }
  window.__trOverlayInstalled = true;

  const ROOT_ID = "training-recorder-overlay";

  /** @type {number | null} */
  let timerInterval = null;
  /** @type {number} */
  let startedAt = 0;

  function removeOverlay() {
    if (timerInterval != null) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    document.getElementById(ROOT_ID)?.remove();
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  /**
   * @param {{ t0: number }} payload
   */
  function showOverlay(payload) {
    removeOverlay();
    startedAt = payload.t0;

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("data-training-recorder", "overlay");
    root.innerHTML = `
      <style>
        #${ROOT_ID} {
          position: fixed;
          right: 12px;
          bottom: 12px;
          z-index: 2147483646;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(20, 20, 20, 0.88);
          color: #fff;
          font: 600 11px/1 system-ui, -apple-system, sans-serif;
          box-shadow: 0 2px 12px rgba(0,0,0,0.35);
          pointer-events: auto;
          user-select: none;
        }
        #${ROOT_ID} .tr-rec-dot {
          color: #ff4d4f;
          letter-spacing: 0.04em;
        }
        #${ROOT_ID} .tr-timer {
          min-width: 42px;
          font-variant-numeric: tabular-nums;
          opacity: 0.95;
        }
        #${ROOT_ID} .tr-stop {
          border: none;
          border-radius: 999px;
          padding: 4px 10px;
          background: #fff;
          color: #111;
          font: 600 11px/1 system-ui, sans-serif;
          cursor: pointer;
        }
        #${ROOT_ID} .tr-stop:hover {
          background: #f2f2f2;
        }
      </style>
      <span class="tr-rec-dot">● REC</span>
      <span class="tr-timer">00:00</span>
      <button type="button" class="tr-stop">Стоп</button>
    `;

    document.documentElement.appendChild(root);

    const timerEl = root.querySelector(".tr-timer");
    const stopBtn = root.querySelector(".tr-stop");

    timerInterval = window.setInterval(() => {
      if (timerEl instanceof HTMLElement) {
        timerEl.textContent = formatElapsed(Date.now() - startedAt);
      }
    }, 1000);

    if (stopBtn instanceof HTMLButtonElement) {
      stopBtn.addEventListener("click", () => {
        stopBtn.disabled = true;
        stopBtn.textContent = "…";
        chrome.runtime.sendMessage({ type: MSG.STOP_AND_PROCESS }).catch(() => {
          stopBtn.disabled = false;
          stopBtn.textContent = "Стоп";
        });
      });
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MSG.CONTENT_OVERLAY_START) {
      showOverlay(message.payload ?? { t0: Date.now() });
      return;
    }
    if (message.type === MSG.CONTENT_OVERLAY_STOP) {
      removeOverlay();
    }
  });
})();
