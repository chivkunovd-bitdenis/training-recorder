/**
 * Единый geometry engine для аннотаций: viewport → screenshot pixels → display.
 * Pure functions — без React/DOM.
 */

/** @typedef {{ x: number; y: number; w: number; h: number }} Rect */

/**
 * @typedef {{
 *   viewportWidth: number;
 *   viewportHeight: number;
 *   devicePixelRatio: number;
 *   scrollX?: number;
 *   scrollY?: number;
 *   visualViewportScale?: number;
 * }} CaptureContextLike
 */

/**
 * @typedef {{
 *   width: number;
 *   height: number;
 *   captureContext?: CaptureContextLike;
 *   viewportWidth?: number;
 *   viewportHeight?: number;
 * }} ScreenshotLike
 */

/** @typedef {{ width: number; height: number }} Size */

const SCALE_DRIFT_THRESHOLD = 0.05;

/**
 * @param {ScreenshotLike | null | undefined} screenshot
 * @returns {CaptureContextLike | null}
 */
export function resolveCaptureContext(screenshot) {
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
 * @param {ScreenshotLike | null | undefined} screenshot
 * @returns {{ scaleX: number; scaleY: number } | null}
 */
export function measuredScale(screenshot) {
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
 * @param {Rect} bbox — viewport CSS (getBoundingClientRect)
 * @param {ScreenshotLike} screenshot
 * @returns {Rect}
 */
export function viewportBBoxToScreenshot(bbox, screenshot) {
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
 * @param {{ x: number; y: number }} point — viewport CSS (clientX/clientY)
 * @param {ScreenshotLike} screenshot
 * @returns {{ x: number; y: number }}
 */
export function viewportPointToScreenshot(point, screenshot) {
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
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @param {number} clientWidth
 * @param {number} clientHeight
 */
export function computeObjectFitContainLayout(
  naturalWidth,
  naturalHeight,
  clientWidth,
  clientHeight,
) {
  return computeFitLayout(
    naturalWidth,
    naturalHeight,
    clientWidth,
    clientHeight,
    "contain",
  );
}

/**
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @param {number} clientWidth
 * @param {number} clientHeight
 * @param {'contain' | 'cover'} fitMode
 */
function computeFitLayout(
  naturalWidth,
  naturalHeight,
  clientWidth,
  clientHeight,
  fitMode = "contain",
) {
  if (!naturalWidth || !naturalHeight || !clientWidth || !clientHeight) {
    return {
      renderWidth: clientWidth,
      renderHeight: clientHeight,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const containScale = Math.min(
    clientWidth / naturalWidth,
    clientHeight / naturalHeight,
  );
  const coverScale = Math.max(
    clientWidth / naturalWidth,
    clientHeight / naturalHeight,
  );
  const scale = fitMode === "cover" ? coverScale : containScale;
  const renderWidth = naturalWidth * scale;
  const renderHeight = naturalHeight * scale;

  return {
    renderWidth,
    renderHeight,
    offsetX: (clientWidth - renderWidth) / 2,
    offsetY: (clientHeight - renderHeight) / 2,
  };
}

/**
 * @param {Rect} bbox — screenshot pixels
 * @param {ScreenshotLike} screenshot
 * @param {Size} displayClientSize
 * @param {'contain' | 'cover'} [fitMode='contain']
 */
export function screenshotBBoxToDisplay(
  bbox,
  screenshot,
  displayClientSize,
  fitMode = "contain",
) {
  const nw = Number(screenshot.width);
  const nh = Number(screenshot.height);
  const layout = computeFitLayout(
    nw,
    nh,
    displayClientSize.width,
    displayClientSize.height,
    fitMode,
  );
  const scale = layout.renderWidth / nw;

  return {
    rect: {
      x: bbox.x * scale,
      y: bbox.y * scale,
      w: bbox.w * scale,
      h: bbox.h * scale,
    },
    offset: { x: layout.offsetX, y: layout.offsetY },
    renderSize: { width: layout.renderWidth, height: layout.renderHeight },
  };
}

/**
 * @param {Rect} bbox — координаты внутри render area (без letterbox offset)
 * @param {ScreenshotLike} screenshot
 * @param {Size} displayClientSize
 * @param {'contain' | 'cover'} [fitMode='contain']
 * @returns {Rect}
 */
export function displayBBoxToScreenshot(
  bbox,
  screenshot,
  displayClientSize,
  fitMode = "contain",
) {
  const nw = Number(screenshot.width);
  const nh = Number(screenshot.height);
  const layout = computeFitLayout(
    nw,
    nh,
    displayClientSize.width,
    displayClientSize.height,
    fitMode,
  );
  const scale = nw / layout.renderWidth;

  return {
    x: Math.round(bbox.x * scale),
    y: Math.round(bbox.y * scale),
    w: Math.round(bbox.w * scale),
    h: Math.round(bbox.h * scale),
  };
}

/**
 * @param {Rect} rect
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {Rect}
 */
export function clampRectToImage(rect, imageWidth, imageHeight) {
  const x = Math.max(0, Math.min(rect.x, imageWidth));
  const y = Math.max(0, Math.min(rect.y, imageHeight));
  const maxW = Math.max(0, imageWidth - x);
  const maxH = Math.max(0, imageHeight - y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(rect.w, maxW)),
    h: Math.max(0, Math.min(rect.h, maxH)),
  };
}

/**
 * @param {Rect} bbox
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {{ ok: boolean; reason?: string }}
 */
export function validateBBoxInImage(bbox, imageWidth, imageHeight) {
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
 * @returns {{ ok: boolean; reason?: string }}
 */
export function validatePointInImage(point, imageWidth, imageHeight) {
  if (point.x < 0 || point.y < 0) {
    return { ok: false, reason: "origin outside image" };
  }
  if (point.x > imageWidth || point.y > imageHeight) {
    return { ok: false, reason: "point exceeds image bounds" };
  }
  return { ok: true };
}

/**
 * @param {{ x: number; y: number }} point
 * @param {number} imageWidth
 * @param {number} imageHeight
 */
function clampPoint(point, imageWidth, imageHeight) {
  return {
    x: Math.max(0, Math.min(point.x, imageWidth)),
    y: Math.max(0, Math.min(point.y, imageHeight)),
  };
}

/**
 * @param {Rect} screenshotBBox
 * @param {number} _stepNumber
 * @param {Size} imageSize
 * @param {{ badgeSize?: number; gap?: number }} [options]
 */
export function resolveDecorationLayout(
  screenshotBBox,
  _stepNumber,
  imageSize,
  options = {},
) {
  const imageWidth = imageSize.width;
  const imageHeight = imageSize.height;
  const highlight = clampRectToImage(screenshotBBox, imageWidth, imageHeight);
  const clamped = highlight.x < imageWidth * 0.05;

  const badgeSize =
    options.badgeSize ?? Math.max(22, Math.round(imageWidth / 40));
  const gap = options.gap ?? 4;

  let badgeX = highlight.x;
  let badgeY = highlight.y - badgeSize - gap;
  if (badgeY < 0) {
    badgeY = highlight.y + gap;
  }

  const badge = clampRectToImage(
    { x: badgeX, y: badgeY, w: badgeSize, h: badgeSize },
    imageWidth,
    imageHeight,
  );

  const badgeCenter = {
    x: badge.x + badge.w / 2,
    y: badge.y + badge.h / 2,
  };
  const highlightCenter = {
    x: highlight.x + highlight.w / 2,
    y: highlight.y + highlight.h / 2,
  };

  return {
    highlight,
    badge,
    arrow: {
      from: clampPoint(badgeCenter, imageWidth, imageHeight),
      to: clampPoint(highlightCenter, imageWidth, imageHeight),
    },
    clamped,
  };
}

/**
 * Layout для режима clickPoint: highlight вокруг точки, стрелка badge → click point.
 * @param {{ x: number; y: number }} point — screenshot pixels
 * @param {number} _stepNumber
 * @param {Size} imageSize
 * @param {{ badgeSize?: number; gap?: number; highlightSize?: number }} [options]
 */
export function resolveDecorationLayoutForPoint(
  point,
  _stepNumber,
  imageSize,
  options = {},
) {
  const imageWidth = imageSize.width;
  const imageHeight = imageSize.height;
  const highlightSize =
    options.highlightSize ?? Math.max(24, Math.round(imageWidth / 80));
  const half = highlightSize / 2;
  const highlight = clampRectToImage(
    {
      x: point.x - half,
      y: point.y - half,
      w: highlightSize,
      h: highlightSize,
    },
    imageWidth,
    imageHeight,
  );

  const badgeSize =
    options.badgeSize ?? Math.max(22, Math.round(imageWidth / 40));
  const gap = options.gap ?? 4;

  let badgeX = point.x - badgeSize / 2;
  let badgeY = point.y - badgeSize - gap - half;
  if (badgeY < 0) {
    badgeY = point.y + gap + half;
  }

  const badge = clampRectToImage(
    { x: badgeX, y: badgeY, w: badgeSize, h: badgeSize },
    imageWidth,
    imageHeight,
  );

  const badgeCenter = {
    x: badge.x + badge.w / 2,
    y: badge.y + badge.h / 2,
  };
  const targetPoint = clampPoint(point, imageWidth, imageHeight);

  return {
    highlight,
    badge,
    arrow: {
      from: clampPoint(badgeCenter, imageWidth, imageHeight),
      to: targetPoint,
    },
    clamped: false,
  };
}
