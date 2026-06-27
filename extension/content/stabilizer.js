(() => {
  const CONFIG = {
    QUIET_WINDOW: 400,
    MAX_WAIT: 8000,
    LAYOUT_SAMPLE: 150,
    CHECK_INTERVAL: 50,
  };

  // "loader" специфичнее, чем "loading": подстрока "loading" попадает в постоянные
  // элементы (lazy-loading, *-loading-wrapper) и страница «никогда не успокаивается».
  const LOADER_SELECTOR = [
    '[aria-busy="true"]',
    '[role="progressbar"]',
    '[data-loading="true"]',
    '[class*="spinner" i]',
    '[class*="skeleton" i]',
    '[class*="loader" i]',
  ].join(", ");

  const LAYOUT_ATTRS = new Set([
    "class",
    "style",
    "hidden",
    "width",
    "height",
    "aria-hidden",
  ]);

  const CAPTURE_MODE = {
    IMMEDIATE: "IMMEDIATE",
    DEFERRED: "DEFERRED",
  };

  /**
   * Режим захвата скрина для события (T-CLK-3).
   * @returns {"IMMEDIATE" | "DEFERRED" | null}
   */
  function getCaptureMode(type, target, dom = null) {
    if (type === "navigation") {
      return CAPTURE_MODE.DEFERRED;
    }

    if (type === "submit" || type === "menu_select") {
      return CAPTURE_MODE.IMMEDIATE;
    }

    if (type === "modal_open" || type === "input" || type === "focus") {
      return null;
    }

    if (type !== "click" || !target) {
      return null;
    }

    if (typeof target.closest === "function") {
      const interactive = target.closest(
        'a, button, summary, [role="button"], [role="link"], [type="submit"], [type="button"]',
      );
      if (interactive) {
        return CAPTURE_MODE.IMMEDIATE;
      }
    }

    const tag = target.tagName.toLowerCase();
    if (tag === "a" || tag === "button") {
      return CAPTURE_MODE.IMMEDIATE;
    }

    const role = dom?.inferRole?.(target) ?? target.getAttribute("role");
    if (role === "button" || role === "link") {
      return CAPTURE_MODE.IMMEDIATE;
    }

    return null;
  }

  function isSignificantAction(type, target, dom = null) {
    return getCaptureMode(type, target, dom) != null;
  }

  function hasVisibleLoaders(doc) {
    const nodes = doc.querySelectorAll(LOADER_SELECTOR);
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      const style = doc.defaultView?.getComputedStyle(node);
      if (!style || style.display === "none" || style.visibility === "hidden") {
        continue;
      }
      if (node.getAttribute("aria-busy") === "true") {
        return true;
      }
      if (node.getAttribute("role") === "progressbar") {
        return true;
      }
      const className = node.className?.toString().toLowerCase() ?? "";
      if (
        className.includes("spinner") ||
        className.includes("skeleton") ||
        className.includes("loader")
      ) {
        return true;
      }
      if (node.offsetParent !== null || style.position === "fixed") {
        return true;
      }
    }
    return false;
  }

  function measureLayout(doc) {
    const main = doc.querySelector("main");
    return {
      scrollHeight: doc.documentElement.scrollHeight,
      mainHeight: main instanceof HTMLElement ? main.offsetHeight : 0,
    };
  }

  function isSignificantNode(node, doc) {
    if (!(node instanceof Element)) {
      return false;
    }
    if (node.closest("[data-tr-ignore-mutations]")) {
      return false;
    }
    const view = doc.defaultView;
    if (!view) {
      return true;
    }
    const rect = node.getBoundingClientRect?.();
    if (rect && (rect.bottom < 0 || rect.top > view.innerHeight + 200)) {
      return false;
    }
    return true;
  }

  class StabilizerController {
    constructor({ t0, document: doc, onCapture, getNetworkActiveCount }) {
      this.t0 = t0;
      this.document = doc ?? globalThis.document;
      this.onCapture = onCapture;
      this.getNetworkActiveCount = getNetworkActiveCount ?? (() => 0);
      this.activeCandidate = null;
      this.history = [];
      this.lastDomMutation = 0;
      this.quietSince = null;
      this.lastLayoutCheckAt = 0;
      this.lastLayout = measureLayout(this.document);
      this.layoutStable = true;
      this.tickTimer = null;
      this.mutationObserver = null;
    }

    start() {
      this.bindMutationObserver();
      this.tickTimer = window.setInterval(
        () => this.tick(),
        CONFIG.CHECK_INTERVAL,
      );
    }

    stop() {
      if (this.tickTimer != null) {
        clearInterval(this.tickTimer);
        this.tickTimer = null;
      }
      this.mutationObserver?.disconnect();
      this.mutationObserver = null;
      this.activeCandidate = null;
    }

    bindMutationObserver() {
      this.mutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes") {
            const attr = mutation.attributeName || "";
            if (!LAYOUT_ATTRS.has(attr) && attr !== "aria-busy") {
              continue;
            }
            if (isSignificantNode(mutation.target, this.document)) {
              this.markDomMutation();
            }
            continue;
          }

          if (mutation.type === "childList") {
            for (const node of mutation.addedNodes) {
              if (isSignificantNode(node, this.document)) {
                this.markDomMutation();
                break;
              }
            }
            for (const node of mutation.removedNodes) {
              if (isSignificantNode(node, this.document)) {
                this.markDomMutation();
                break;
              }
            }
          }
        }
      });

      const root = this.document.body ?? this.document.documentElement;
      this.mutationObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: Array.from(LAYOUT_ATTRS).concat(["aria-busy"]),
      });
    }

    markDomMutation() {
      this.lastDomMutation = Date.now();
      this.quietSince = null;
    }

    onSignificantAction(eventId, ts, mode = CAPTURE_MODE.DEFERRED) {
      if (this.activeCandidate?.state === "WAITING") {
        this.activeCandidate.state = "SUPERSEDED";
        this.history.push({
          eventId: this.activeCandidate.eventId,
          state: "SUPERSEDED",
        });
      }

      if (mode === CAPTURE_MODE.IMMEDIATE) {
        this.activeCandidate = null;
        this.quietSince = null;
        this.onCapture({
          eventId,
          ts,
          confidence: "high",
          immediate: true,
        });
        return;
      }

      this.activeCandidate = {
        eventId,
        ts,
        state: "WAITING",
        startedAt: Date.now(),
      };
      this.quietSince = null;
    }

    tick() {
      const candidate = this.activeCandidate;
      if (!candidate || candidate.state !== "WAITING") {
        return;
      }

      const now = Date.now();
      if (now - candidate.startedAt >= CONFIG.MAX_WAIT) {
        this.finishCandidate(candidate, "TIMED_OUT", "low");
        return;
      }

      this.updateLayoutStability(now);

      if (this.isStable(now)) {
        if (this.quietSince == null) {
          this.quietSince = now;
        }
        if (now - this.quietSince >= CONFIG.QUIET_WINDOW) {
          this.finishCandidate(candidate, "CAPTURED", "high");
        }
        return;
      }

      this.quietSince = null;
    }

    updateLayoutStability(now) {
      if (now - this.lastLayoutCheckAt < CONFIG.LAYOUT_SAMPLE) {
        return;
      }

      const nextLayout = measureLayout(this.document);
      this.layoutStable =
        nextLayout.scrollHeight === this.lastLayout.scrollHeight &&
        nextLayout.mainHeight === this.lastLayout.mainHeight;
      this.lastLayout = nextLayout;
      this.lastLayoutCheckAt = now;

      if (!this.layoutStable) {
        this.quietSince = null;
      }
    }

    isStable(now) {
      const networkIdle = this.getNetworkActiveCount() === 0;
      const domQuiet = now - this.lastDomMutation >= CONFIG.QUIET_WINDOW;
      const loadersHidden = !hasVisibleLoaders(this.document);
      return networkIdle && domQuiet && loadersHidden && this.layoutStable;
    }

    finishCandidate(candidate, finalState, confidence) {
      candidate.state = finalState;
      this.history.push({ eventId: candidate.eventId, state: finalState });
      this.activeCandidate = null;
      this.quietSince = null;

      this.onCapture({
        eventId: candidate.eventId,
        ts: candidate.ts,
        confidence,
        immediate: false,
      });
    }

    getHistory() {
      return this.history.slice();
    }
  }

  const root = typeof window !== "undefined" ? window : globalThis;
  root.TrainingRecorderStabilizer = {
    CONFIG,
    CAPTURE_MODE,
    getCaptureMode,
    isSignificantAction,
    hasVisibleLoaders,
    measureLayout,
    StabilizerController,
  };
})();
