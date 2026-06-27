/**
 * Geometry engine для content script (IIFE).
 * Sync with shared/annotation-geometry.mjs — parity-тест в content-capture-context.test.mjs
 */
(() => {
  const SCALE_DRIFT_THRESHOLD = 0.05;

  /**
   * @param {{ width: number; height: number; captureContext?: object; viewportWidth?: number; viewportHeight?: number } | null | undefined} screenshot
   */
  function resolveCaptureContext(screenshot) {
    if (screenshot?.captureContext) {
      return { ...screenshot.captureContext };
    }

    const vw = Number(screenshot?.viewportWidth);
    const vh = Number(screenshot?.viewportHeight);
    if (!(vw > 0 && vh > 0)) {
      return null;
    }

    const nw = Number(screenshot?.width);
    const nh = Number(screenshot?.height);
    let devicePixelRatio = 1;
    if (nw > 0 && nh > 0) {
      const scaleX = nw / vw;
      const scaleY = nh / vh;
      devicePixelRatio =
        Math.abs(scaleX - scaleY) < 0.01
          ? scaleX
          : (scaleX + scaleY) / 2;
    }

    return {
      viewportWidth: vw,
      viewportHeight: vh,
      devicePixelRatio,
    };
  }

  /**
   * @param {{ width: number; height: number; captureContext?: object; viewportWidth?: number; viewportHeight?: number } | null | undefined} screenshot
   */
  function measuredScale(screenshot) {
    const ctx = resolveCaptureContext(screenshot);
    const nw = Number(screenshot?.width);
    const nh = Number(screenshot?.height);
    if (!ctx || !(nw > 0 && nh > 0)) {
      return null;
    }

    const scaleX = nw / ctx.viewportWidth;
    const scaleY = nh / ctx.viewportHeight;
    const dpr = ctx.devicePixelRatio || 1;
    const dprDriftX = Math.abs(scaleX - dpr) / Math.max(dpr, 0.001);
    const dprDriftY = Math.abs(scaleY - dpr) / Math.max(dpr, 0.001);
    if (dprDriftX > SCALE_DRIFT_THRESHOLD || dprDriftY > SCALE_DRIFT_THRESHOLD) {
      return { scaleX, scaleY };
    }

    return { scaleX, scaleY };
  }

  /**
   * @param {{ x: number; y: number; w: number; h: number }} bbox
   * @param {{ width: number; height: number; captureContext?: object; viewportWidth?: number; viewportHeight?: number }} screenshot
   */
  function viewportBBoxToScreenshot(bbox, screenshot) {
    const scale = measuredScale(screenshot);
    if (!scale) {
      return { ...bbox };
    }

    return {
      x: Math.round(bbox.x * scale.scaleX),
      y: Math.round(bbox.y * scale.scaleY),
      w: Math.round(bbox.w * scale.scaleX),
      h: Math.round(bbox.h * scale.scaleY),
    };
  }

  /**
   * @param {{ x: number; y: number }} point
   * @param {{ width: number; height: number; captureContext?: object; viewportWidth?: number; viewportHeight?: number }} screenshot
   */
  function viewportPointToScreenshot(point, screenshot) {
    const scale = measuredScale(screenshot);
    if (!scale) {
      return { x: point.x, y: point.y };
    }

    return {
      x: Math.round(point.x * scale.scaleX),
      y: Math.round(point.y * scale.scaleY),
    };
  }

  /**
   * @param {{ x: number; y: number; w: number; h: number }} bbox
   * @param {number} imageWidth
   * @param {number} imageHeight
   */
  function validateBBoxInImage(bbox, imageWidth, imageHeight) {
    if (bbox.w < 0 || bbox.h < 0) {
      return { ok: false, reason: "negative dimensions" };
    }
    if (bbox.x < 0 || bbox.y < 0) {
      return { ok: false, reason: "origin outside image" };
    }
    if (bbox.x + bbox.w > imageWidth || bbox.y + bbox.h > imageHeight) {
      return { ok: false, reason: "bbox exceeds image bounds" };
    }
    return { ok: true };
  }

  /**
   * @param {{ x: number; y: number }} point
   * @param {number} imageWidth
   * @param {number} imageHeight
   */
  function validatePointInImage(point, imageWidth, imageHeight) {
    if (point.x < 0 || point.y < 0) {
      return { ok: false, reason: "origin outside image" };
    }
    if (point.x > imageWidth || point.y > imageHeight) {
      return { ok: false, reason: "point exceeds image bounds" };
    }
    return { ok: true };
  }

  const root = typeof window !== "undefined" ? window : globalThis;
  root.TrainingRecorderGeometry = {
    resolveCaptureContext,
    measuredScale,
    viewportBBoxToScreenshot,
    viewportPointToScreenshot,
    validateBBoxInImage,
    validatePointInImage,
  };
})();
