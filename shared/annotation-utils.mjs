/**
 * Утилиты аннотаций скриншотов (T3.2). ESM, без React — для редактора и node-тестов.
 */

import {
  clampRectToImage,
  computeObjectFitContainLayout as geometryComputeObjectFitContainLayout,
  displayBBoxToScreenshot,
  resolveCaptureContext,
  resolveDecorationLayout,
  resolveDecorationLayoutForPoint,
  screenshotBBoxToDisplay,
  validateBBoxInImage,
  validatePointInImage,
  viewportBBoxToScreenshot,
} from "./annotation-geometry.mjs";

export {
  clampRectToImage,
  displayBBoxToScreenshot,
  measuredScale,
  resolveCaptureContext,
  resolveDecorationLayout,
  resolveDecorationLayoutForPoint,
  screenshotBBoxToDisplay,
  validateBBoxInImage,
  validatePointInImage,
  viewportBBoxToScreenshot,
} from "./annotation-geometry.mjs";

/** @typedef {{ x: number; y: number; w: number; h: number }} BoundingBox */

/** @typedef {{ id: string; type: string; target?: { bbox?: BoundingBox } | null }} RecEventLike */

/**
 * @typedef {{
 *   id: string;
 *   width: number;
 *   height: number;
 *   eventId?: string | null;
 *   viewportWidth?: number;
 *   viewportHeight?: number;
 *   captureContext?: import("./annotation-geometry.mjs").CaptureContextLike;
 *   materializedBbox?: BoundingBox;
 *   materializedClickPoint?: { x: number; y: number };
 *   annotationConfidence?: "measured" | "invalid";
 * }} ScreenshotLike
 */

/**
 * @typedef {{
 *   enabled: boolean;
 *   bbox: BoundingBox;
 *   coordinateSpace?: "screenshotPixels";
 *   confidence?: "measured" | "inferred" | "manual";
 *   materializedFromEventId?: string;
 *   annotationMode?: "elementRect" | "clickPoint";
 *   showArrow?: boolean;
 *   showStepNumber?: boolean;
 * }} ScreenshotAnnotation
 */

const CLICK_POINT_HIGHLIGHT_MIN = 24;

const EVENT_PRIORITY = [
  "click",
  "submit",
  "menu_select",
  "input",
  "focus",
  "modal_open",
];

const POINTER_EVENT_TYPES = new Set(["click", "submit", "menu_select"]);

/**
 * @param {string[]} eventIds
 * @param {RecEventLike[]} events
 */
export function pickAnnotationEvent(eventIds, events) {
  const byId = new Map(events.map((event) => [event.id, event]));

  for (const eventType of EVENT_PRIORITY) {
    for (const eventId of eventIds) {
      const event = byId.get(eventId);
      if (event?.target?.bbox && event.type === eventType) {
        return event;
      }
    }
  }

  for (const eventId of eventIds) {
    const event = byId.get(eventId);
    if (event?.target?.bbox) {
      return event;
    }
  }

  return null;
}

/**
 * Ближайший «указательный» клик/submit до якорного события (часто modal_open).
 * @param {string[]} eventIds
 * @param {RecEventLike[]} events
 * @param {RecEventLike | null | undefined} anchorEvent
 */
export function findRelatedPointerEvent(eventIds, events, anchorEvent) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const anchorTs = Number(anchorEvent?.ts);
  const hasAnchorTs = Number.isFinite(anchorTs);

  /** @type {RecEventLike | null} */
  let best = null;
  for (const eventId of eventIds) {
    const event = byId.get(eventId);
    if (!event?.target?.bbox || !POINTER_EVENT_TYPES.has(event.type)) {
      continue;
    }
    if (hasAnchorTs && Number(event.ts) > anchorTs) {
      continue;
    }
    if (!best || Number(event.ts) > Number(best.ts)) {
      best = event;
    }
  }
  return best;
}

/**
 * @param {ScreenshotLike | null | undefined} screenshot
 * @param {string[]} eventIds
 * @param {RecEventLike[]} events
 */
export function pickAnnotationEventForScreenshot(screenshot, eventIds, events) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const screenshotEventId = screenshot?.eventId;
  if (screenshotEventId) {
    const screenshotEvent = byId.get(String(screenshotEventId));
    if (
      screenshotEvent &&
      POINTER_EVENT_TYPES.has(screenshotEvent.type) &&
      screenshotEvent.target?.bbox
    ) {
      return screenshotEvent;
    }
  }

  for (const eventId of eventIds) {
    const event = byId.get(eventId);
    if (event && POINTER_EVENT_TYPES.has(event.type) && event.target?.bbox) {
      return event;
    }
  }

  return null;
}

/**
 * @param {{ x: number; y: number }} point
 * @param {number} imageWidth
 * @returns {BoundingBox}
 */
function clickPointToHighlightBBox(point, imageWidth) {
  const size = Math.max(
    CLICK_POINT_HIGHLIGHT_MIN,
    Math.round(imageWidth / 80),
  );
  const half = size / 2;
  return {
    x: Math.round(point.x - half),
    y: Math.round(point.y - half),
    w: size,
    h: size,
  };
}

/**
 * @param {ScreenshotAnnotation} annotation
 * @returns {{ x: number; y: number }}
 */
function annotationCenterPoint(annotation) {
  return {
    x: annotation.bbox.x + annotation.bbox.w / 2,
    y: annotation.bbox.y + annotation.bbox.h / 2,
  };
}

/**
 * Как браузер рисует img с object-fit: contain внутри clientWidth×clientHeight.
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
  return geometryComputeObjectFitContainLayout(
    naturalWidth,
    naturalHeight,
    clientWidth,
    clientHeight,
  );
}

/**
 * @param {BoundingBox} bbox
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @param {number} clientWidth
 * @param {number} clientHeight
 */
export function scaleBBoxToDisplay(
  bbox,
  naturalWidth,
  naturalHeight,
  clientWidth,
  clientHeight,
) {
  const layout = computeObjectFitContainLayout(
    naturalWidth,
    naturalHeight,
    clientWidth,
    clientHeight,
  );
  const scale = layout.renderWidth / naturalWidth;
  return {
    x: bbox.x * scale,
    y: bbox.y * scale,
    w: bbox.w * scale,
    h: bbox.h * scale,
  };
}

/**
 * @param {BoundingBox} displayBBox — координаты внутри области object-fit: contain (без letterbox-offset)
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @param {number} clientWidth
 * @param {number} clientHeight
 */
export function scaleBBoxToNatural(
  displayBBox,
  naturalWidth,
  naturalHeight,
  clientWidth,
  clientHeight,
) {
  return displayBBoxToScreenshot(
    displayBBox,
    { width: naturalWidth, height: naturalHeight },
    { width: clientWidth, height: clientHeight },
  );
}

/**
 * Единый layout превью редактора: highlight, badge, arrow в display space.
 * @param {ScreenshotAnnotation} annotation
 * @param {ScreenshotLike} screenshot
 * @param {{ width: number; height: number }} displayClientSize
 * @param {number} stepNumber
 */
export function screenshotAnnotationToDisplayLayer(
  annotation,
  screenshot,
  displayClientSize,
  stepNumber,
) {
  const imageWidth = Number(screenshot.width);
  const imageHeight = Number(screenshot.height);
  const { rect, offset, renderSize } = screenshotBBoxToDisplay(
    annotation.bbox,
    screenshot,
    displayClientSize,
  );
  const scale = renderSize.width / imageWidth;

  const isClickPoint = annotation.annotationMode === "clickPoint";
  const decoration = isClickPoint
    ? resolveDecorationLayoutForPoint(
        annotationCenterPoint(annotation),
        stepNumber,
        { width: imageWidth, height: imageHeight },
      )
    : resolveDecorationLayout(
        annotation.bbox,
        stepNumber,
        { width: imageWidth, height: imageHeight },
      );

  const scaleRect = (rectValue) => ({
    x: rectValue.x * scale,
    y: rectValue.y * scale,
    w: rectValue.w * scale,
    h: rectValue.h * scale,
  });
  const scalePoint = (point) => ({
    x: point.x * scale,
    y: point.y * scale,
  });

  return {
    displayRect: rect,
    offset,
    renderSize,
    decoration: {
      highlight: scaleRect(decoration.highlight),
      badge: scaleRect(decoration.badge),
      arrow: {
        from: scalePoint(decoration.arrow.from),
        to: scalePoint(decoration.arrow.to),
      },
      clamped: decoration.clamped,
    },
  };
}

/**
 * Перевести bbox из CSS-пикселей вьюпорта в пиксели bitmap скриншота.
 * Делегирует geometry engine; без capture/legacy viewport — passthrough (inferred).
 * @param {BoundingBox} bbox
 * @param {ScreenshotLike} screenshot
 */
export function scaleViewportBBoxToNatural(bbox, screenshot) {
  const ctx = resolveCaptureContext(screenshot);
  const imageWidth = Number(screenshot?.width);
  const imageHeight = Number(screenshot?.height);

  if (ctx && imageWidth > 0 && imageHeight > 0) {
    return viewportBBoxToScreenshot(bbox, screenshot);
  }

  return { ...bbox };
}

/**
 * @param {BoundingBox} bbox
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {"measured" | "inferred"} confidence
 * @param {string | undefined} materializedFromEventId
 * @returns {ScreenshotAnnotation | null}
 */
function finalizeScreenshotAnnotation(
  bbox,
  imageWidth,
  imageHeight,
  confidence,
  materializedFromEventId,
) {
  const validation = validateBBoxInImage(bbox, imageWidth, imageHeight);
  let finalBbox = bbox;
  let finalConfidence = confidence;

  if (!validation.ok) {
    finalConfidence = "inferred";
    finalBbox = clampRectToImage(bbox, imageWidth, imageHeight);
    const reclamped = validateBBoxInImage(finalBbox, imageWidth, imageHeight);
    if (!reclamped.ok || finalBbox.w < 8 || finalBbox.h < 8) {
      return null;
    }
  }

  return {
    enabled: true,
    bbox: finalBbox,
    coordinateSpace: "screenshotPixels",
    confidence: finalConfidence,
    ...(materializedFromEventId
      ? { materializedFromEventId }
      : {}),
    showArrow: true,
    showStepNumber: true,
  };
}

/**
 * @param {{ x: number; y: number }} point
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {"measured" | "inferred"} confidence
 * @param {string | undefined} materializedFromEventId
 * @returns {ScreenshotAnnotation | null}
 */
function finalizeClickPointAnnotation(
  point,
  imageWidth,
  imageHeight,
  confidence,
  materializedFromEventId,
) {
  const validation = validatePointInImage(point, imageWidth, imageHeight);
  let finalPoint = point;
  let finalConfidence = confidence;

  if (!validation.ok) {
    finalConfidence = "inferred";
    finalPoint = {
      x: Math.max(0, Math.min(point.x, imageWidth)),
      y: Math.max(0, Math.min(point.y, imageHeight)),
    };
  }

  const bbox = clickPointToHighlightBBox(finalPoint, imageWidth);
  const bboxValidation = validateBBoxInImage(bbox, imageWidth, imageHeight);
  if (!bboxValidation.ok) {
    return null;
  }

  return {
    enabled: true,
    bbox,
    coordinateSpace: "screenshotPixels",
    confidence: finalConfidence,
    annotationMode: "clickPoint",
    ...(materializedFromEventId
      ? { materializedFromEventId }
      : {}),
    showArrow: true,
    showStepNumber: true,
  };
}

/**
 * @param {ScreenshotLike} screenshot
 * @param {BoundingBox} viewportBbox
 * @returns {{ bbox: BoundingBox; confidence: "measured" | "inferred" }}
 */
function inferBBoxFromViewport(screenshot, viewportBbox) {
  const ctx = resolveCaptureContext(screenshot);
  const imageWidth = Number(screenshot.width);
  const imageHeight = Number(screenshot.height);

  if (ctx && imageWidth > 0 && imageHeight > 0) {
    return {
      bbox: viewportBBoxToScreenshot(viewportBbox, screenshot),
      confidence: "inferred",
    };
  }

  return {
    bbox: { ...viewportBbox },
    confidence: "inferred",
  };
}

/**
 * Показывать предупреждение «проверьте подсветку» для inferred-координат.
 * clickPoint + measured — без плашки (T-CLK-8).
 * @param {ScreenshotAnnotation | null | undefined} annotation
 */
export function shouldShowAnnotationWarning(annotation) {
  if (!annotation?.enabled) {
    return false;
  }
  const confidence = annotation.confidence;
  if (
    confidence === "measured" ||
    confidence === "manual" ||
    (annotation.annotationMode === "clickPoint" && confidence === "measured")
  ) {
    return false;
  }
  return confidence === "inferred" || confidence === undefined;
}

/**
 * @param {{
 *   eventIds: string[];
 *   screenshotId: string | null;
 *   events: RecEventLike[];
 *   screenshots: ScreenshotLike[];
 *   existing?: ScreenshotAnnotation | null;
 * }} params
 */
export function resolveStepAnnotation({
  eventIds,
  screenshotId,
  events,
  screenshots,
  existing = null,
}) {
  if (existing) {
    return existing;
  }

  if (!screenshotId) {
    return null;
  }

  const screenshot = screenshots.find((shot) => shot.id === screenshotId);
  if (!screenshot) {
    return null;
  }

  const imageWidth = Number(screenshot.width);
  const imageHeight = Number(screenshot.height);
  if (!(imageWidth > 0 && imageHeight > 0)) {
    return null;
  }

  const event = pickAnnotationEventForScreenshot(screenshot, eventIds, events);
  const eventId = event
    ? String(event.id)
    : screenshot.eventId
      ? String(screenshot.eventId)
      : undefined;

  if (screenshot.materializedClickPoint) {
    const pointConfidence =
      screenshot.annotationConfidence === "invalid" ? "inferred" : "measured";
    return finalizeClickPointAnnotation(
      screenshot.materializedClickPoint,
      imageWidth,
      imageHeight,
      pointConfidence,
      eventId,
    );
  }

  if (!event?.target?.bbox) {
    return null;
  }

  const viewportBbox = event.target.bbox;

  if (screenshot.materializedBbox) {
    const confidence =
      screenshot.annotationConfidence === "invalid" ? "inferred" : "measured";
    return finalizeScreenshotAnnotation(
      screenshot.materializedBbox,
      imageWidth,
      imageHeight,
      confidence,
      eventId,
    );
  }

  const { bbox, confidence } = inferBBoxFromViewport(screenshot, viewportBbox);
  return finalizeScreenshotAnnotation(
    bbox,
    imageWidth,
    imageHeight,
    confidence,
    eventId,
  );
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ScreenshotAnnotation} annotation
 * @param {number} stepNumber
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
export function drawAnnotationOnCanvas(
  ctx,
  annotation,
  stepNumber,
  canvasWidth,
  canvasHeight,
) {
  if (!annotation.enabled) {
    return;
  }

  const showArrow = annotation.showArrow !== false;
  const showStepNumber = annotation.showStepNumber !== false;
  const isClickPoint = annotation.annotationMode === "clickPoint";
  const layout = isClickPoint
    ? resolveDecorationLayoutForPoint(
        annotationCenterPoint(annotation),
        stepNumber,
        { width: canvasWidth, height: canvasHeight },
      )
    : resolveDecorationLayout(
        annotation.bbox,
        stepNumber,
        { width: canvasWidth, height: canvasHeight },
      );

  ctx.save();
  ctx.strokeStyle = "#e11d48";
  ctx.lineWidth = Math.max(2, Math.round(canvasWidth / 480));
  ctx.fillStyle = "rgba(225, 29, 72, 0.12)";

  if (isClickPoint) {
    const { highlight } = layout;
    const radius = highlight.w / 2;
    const centerX = highlight.x + radius;
    const centerY = highlight.y + radius;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(
      layout.highlight.x,
      layout.highlight.y,
      layout.highlight.w,
      layout.highlight.h,
    );
    ctx.strokeRect(
      layout.highlight.x + 0.5,
      layout.highlight.y + 0.5,
      layout.highlight.w,
      layout.highlight.h,
    );
  }

  if (showStepNumber) {
    const { badge } = layout;
    ctx.fillStyle = "#e11d48";
    ctx.fillRect(badge.x, badge.y, badge.w, badge.h);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(badge.h * 0.55)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      String(stepNumber),
      badge.x + badge.w / 2,
      badge.y + badge.h / 2,
    );
  }

  if (showArrow) {
    const { from, to } = layout.arrow;
    ctx.strokeStyle = "#e11d48";
    ctx.fillStyle = "#e11d48";
    ctx.lineWidth = Math.max(2, Math.round(canvasWidth / 480));
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head = Math.max(8, Math.round(canvasWidth / 120));
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
      to.x - head * Math.cos(angle - Math.PI / 6),
      to.y - head * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      to.x - head * Math.cos(angle + Math.PI / 6),
      to.y - head * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/**
 * @param {HTMLImageElement} image
 * @param {ScreenshotAnnotation} annotation
 * @param {number} stepNumber
 */
export async function bakeAnnotatedScreenshot(image, annotation, stepNumber) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2d недоступен");
  }

  ctx.drawImage(image, 0, 0);
  drawAnnotationOnCanvas(
    ctx,
    annotation,
    stepNumber,
    canvas.width,
    canvas.height,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Не удалось создать PNG"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}
