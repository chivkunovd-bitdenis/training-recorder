(() => {
  const MAX_TEXT = 120;
  const MAX_VALUE = 200;

  const SIGNIFICANT_ANCESTOR_SELECTOR = [
    "section",
    "article",
    "main",
    '[role="region"]',
    "fieldset",
    "form",
    "li",
    "nav",
    '[class*="card"]',
  ].join(", ");

  const INTERACTIVE_CLICK_SELECTOR =
    'a, button, summary, [role="button"], [role="link"], [type="submit"], [type="button"]';

  /**
   * @param {string | null | undefined} text
   * @param {number} [max]
   * @returns {string | null}
   */
  function truncateText(text, max = MAX_TEXT) {
    if (!text) {
      return null;
    }
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return null;
    }
    return normalized.length > max ? normalized.slice(0, max) : normalized;
  }

  /**
   * @param {Element} element
   * @returns {string | null}
   */
  function inferRole(element) {
    const explicit = element.getAttribute("role");
    if (explicit) {
      return explicit;
    }

    const tag = element.tagName.toLowerCase();
    if (tag === "button") {
      return "button";
    }
    if (tag === "a") {
      return "link";
    }
    if (tag === "select") {
      return "combobox";
    }
    if (tag === "textarea") {
      return "textbox";
    }
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") {
        return "button";
      }
      if (type === "checkbox") {
        return "checkbox";
      }
      if (type === "radio") {
        return "radio";
      }
      return "textbox";
    }
    if (tag === "summary") {
      return "button";
    }
    return null;
  }

  /**
   * @param {Element} element
   * @returns {string}
   */
  function getCssPath(element) {
    const parts = [];
    let current = element;

    while (current && current.nodeType === 1 && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();

      if (current.id) {
        part += `#${current.id}`;
        parts.unshift(part);
        break;
      }

      const parent = current.parentElement;
      if (!parent) {
        parts.unshift(part);
        break;
      }

      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current.tagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        part += `:nth-of-type(${index})`;
      }

      parts.unshift(part);
      current = parent;
    }

    return parts.join(" > ") || element.tagName.toLowerCase();
  }

  /**
   * @param {Element} element
   * @returns {string | null}
   */
  function getLabel(element) {
    if (element.id) {
      const escapedId =
        typeof CSS !== "undefined" && CSS.escape
          ? CSS.escape(element.id)
          : element.id.replace(/"/g, '\\"');
      const linked = document.querySelector(`label[for="${escapedId}"]`);
      if (linked) {
        return truncateText(linked.textContent);
      }
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      const truncated = truncateText(text);
      if (truncated) {
        return truncated;
      }
    }

    const parentLabel = element.closest("label");
    if (parentLabel) {
      return truncateText(parentLabel.textContent);
    }

    const previous = findNearbyTextNode(element);
    return previous ? truncateText(previous) : null;
  }

  /**
   * @param {Element} element
   * @returns {string | null}
   */
  function findNearbyTextNode(element) {
    let sibling = element.previousElementSibling;
    while (sibling) {
      const text = truncateText(sibling.textContent);
      if (text) {
        return text;
      }
      sibling = sibling.previousElementSibling;
    }

    const parent = element.parentElement;
    if (!parent) {
      return null;
    }

    let parentSibling = parent.previousElementSibling;
    while (parentSibling) {
      const text = truncateText(parentSibling.textContent);
      if (text) {
        return text;
      }
      parentSibling = parentSibling.previousElementSibling;
    }

    return null;
  }

  /**
   * @param {Element} element
   * @returns {boolean}
   */
  function isSignificantContainer(element) {
    if (element.matches(SIGNIFICANT_ANCESTOR_SELECTOR)) {
      return true;
    }
    const className = element.getAttribute("class") || "";
    return className.toLowerCase().includes("card");
  }

  /**
   * @param {Element} element
   * @returns {string | null}
   */
  function getNearbyText(element) {
    let current = element.parentElement;
    while (current && current !== document.body) {
      if (isSignificantContainer(current)) {
        const text = truncateText(current.textContent);
        if (text) {
          return text;
        }
      }
      current = current.parentElement;
    }
    return null;
  }

  /**
   * @param {Element} element
   * @returns {string | null}
   */
  function getVisibleText(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      return truncateText(ariaLabel);
    }

    const tag = element.tagName.toLowerCase();
    if (tag === "input") {
      const input = /** @type {HTMLInputElement} */ (element);
      const type = (input.type || "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") {
        return truncateText(input.value || input.getAttribute("value"));
      }
      return null;
    }

    if (tag === "textarea") {
      return null;
    }

    if (tag === "button" || tag === "a" || tag === "option") {
      return truncateText(element.textContent);
    }

    return truncateText(element.textContent);
  }

  /**
   * @param {Element} element
   * @returns {{ x: number; y: number; w: number; h: number }}
   */
  function buildBoundingBox(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height,
    };
  }

  /**
   * @param {Element} element
   * @returns {boolean}
   */
  function isElementVisibleForBBox(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    return true;
  }

  /**
   * @param {Element | null | undefined} element
   * @returns {object | null}
   */
  function buildElementContext(element) {
    if (!element || element.nodeType !== 1) {
      return null;
    }

    const placeholder = element.getAttribute("placeholder");

    const context = {
      role: inferRole(element),
      text: getVisibleText(element),
      placeholder: placeholder ? truncateText(placeholder) : null,
      label: getLabel(element),
      nearbyText: getNearbyText(element),
      tag: element.tagName.toLowerCase(),
      cssPath: getCssPath(element),
      bbox: buildBoundingBox(element),
      masked: false,
    };

    const root = typeof window !== "undefined" ? window : globalThis;
    if (root.TrainingRecorderMasking) {
      root.TrainingRecorderMasking.sanitizeContextFields(context, element);
    }

    return context;
  }

  /**
   * @param {Element} element
   * @returns {boolean}
   */
  function isVisibleModal(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const role = element.getAttribute("role");
    const ariaModal = element.getAttribute("aria-modal");
    const isDialog = role === "dialog" || role === "alertdialog";
    if (!isDialog && ariaModal !== "true") {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  /**
   * @param {Element} rawTarget
   * @param {{ clientX: number; clientY: number }} pointerEvent
   * @returns {{ element: Element; clickPoint: { x: number; y: number } }}
   */
  function resolveClickTarget(rawTarget, pointerEvent) {
    const interactive = rawTarget.closest(INTERACTIVE_CLICK_SELECTOR);
    const element = interactive ?? rawTarget;
    return {
      element,
      clickPoint: { x: pointerEvent.clientX, y: pointerEvent.clientY },
    };
  }

  /**
   * @param {{ id?: string; type: string; target?: Element | null; t0: number; url: string; value?: string | null; clickPoint?: { x: number; y: number } | null }} params
   */
  function createRecEvent({
    id,
    type,
    target = null,
    t0,
    url,
    value = null,
    clickPoint = null,
  }) {
    const event = {
      id: id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      ts: Math.max(0, Date.now() - t0),
      url,
      target: target ? buildElementContext(target) : null,
    };

    if (
      event.target &&
      clickPoint &&
      (type === "click" || type === "submit" || type === "menu_select")
    ) {
      event.target.clickPoint = { x: clickPoint.x, y: clickPoint.y };
    }

    if (value != null) {
      event.value = value;
    }

    const root = typeof window !== "undefined" ? window : globalThis;
    if (target && root.TrainingRecorderMasking) {
      root.TrainingRecorderMasking.applyToRecEvent(event, target);
    } else if (value != null) {
      event.value = truncateText(value, MAX_VALUE);
    }

    return event;
  }

  /**
   * Паспорт кадра на момент захвата: viewport CSS → пиксели bitmap.
   * @returns {{
   *   viewportWidth: number;
   *   viewportHeight: number;
   *   devicePixelRatio: number;
   *   scrollX: number;
   *   scrollY: number;
   *   visualViewportScale: number;
   * }}
   */
  function buildCaptureContext() {
    const win = typeof window !== "undefined" ? window : globalThis;
    return {
      viewportWidth: win.innerWidth,
      viewportHeight: win.innerHeight,
      devicePixelRatio: win.devicePixelRatio || 1,
      scrollX: win.scrollX ?? 0,
      scrollY: win.scrollY ?? 0,
      visualViewportScale: win.visualViewport?.scale ?? 1,
    };
  }

  /**
   * Собрать метаданные скриншота с captureContext и materialized bbox.
   * @param {{
   *   mainShot: { id: string; width: number; height: number; candidates?: string[]; imageBase64?: string; byteLength?: number; [key: string]: unknown };
   *   eventId: string;
   *   events: Array<{ id: string; target?: { bbox?: { x: number; y: number; w: number; h: number } } | null }>;
   *   geometry: { viewportBBoxToScreenshot: Function; validateBBoxInImage: Function };
   * }} params
   */
  function buildScreenshotMeta({ mainShot, eventId, events, geometry }) {
    const event = events.find((item) => item.id === eventId);
    const captureContext = buildCaptureContext();
    const { imageBase64: _image, byteLength: _byteLength, ...meta } = mainShot;

    /** @type {{ x: number; y: number; w: number; h: number } | undefined} */
    let materializedBbox;
    /** @type {{ x: number; y: number } | undefined} */
    let materializedClickPoint;
    /** @type {"measured" | "invalid" | undefined} */
    let annotationConfidence;

    const screenshotLike = {
      width: meta.width,
      height: meta.height,
      captureContext,
    };

    const clickPoint = event?.target?.clickPoint;
    if (
      clickPoint &&
      meta.width &&
      meta.height &&
      typeof geometry.viewportPointToScreenshot === "function"
    ) {
      const materialized = geometry.viewportPointToScreenshot(
        clickPoint,
        screenshotLike,
      );
      const validation = geometry.validatePointInImage
        ? geometry.validatePointInImage(materialized, meta.width, meta.height)
        : { ok: true };
      if (validation.ok) {
        materializedClickPoint = materialized;
        annotationConfidence = "measured";
      } else {
        annotationConfidence = "invalid";
        console.warn(
          "[Training Recorder] materialized clickPoint invalid:",
          validation.reason,
          materialized,
        );
      }
    } else if (event?.target?.bbox && meta.width && meta.height) {
      const materialized = geometry.viewportBBoxToScreenshot(
        event.target.bbox,
        screenshotLike,
      );
      const validation = geometry.validateBBoxInImage(
        materialized,
        meta.width,
        meta.height,
      );
      if (validation.ok) {
        materializedBbox = materialized;
        annotationConfidence = "measured";
      } else {
        annotationConfidence = "invalid";
        console.warn(
          "[Training Recorder] materialized bbox invalid:",
          validation.reason,
          materialized,
        );
      }
    }

    return {
      ...meta,
      eventId,
      candidates: mainShot.candidates ?? [],
      captureContext,
      viewportWidth: captureContext.viewportWidth,
      viewportHeight: captureContext.viewportHeight,
      ...(materializedClickPoint ? { materializedClickPoint } : {}),
      ...(materializedBbox ? { materializedBbox } : {}),
      ...(annotationConfidence ? { annotationConfidence } : {}),
    };
  }

  const root = typeof window !== "undefined" ? window : globalThis;
  root.TrainingRecorderDom = {
    truncateText,
    inferRole,
    getCssPath,
    getLabel,
    getNearbyText,
    getVisibleText,
    buildBoundingBox,
    isElementVisibleForBBox,
    buildElementContext,
    isVisibleModal,
    resolveClickTarget,
    createRecEvent,
    buildCaptureContext,
    buildScreenshotMeta,
  };
})();
