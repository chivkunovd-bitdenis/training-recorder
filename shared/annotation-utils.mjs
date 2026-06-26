/**
 * Утилиты аннотаций скриншотов (T3.2). ESM, без React — для редактора и node-тестов.
 */

/** @typedef {{ x: number; y: number; w: number; h: number }} BoundingBox */

/** @typedef {{ id: string; type: string; target?: { bbox?: BoundingBox } | null }} RecEventLike */

/** @typedef {{ id: string; width: number; height: number; viewportWidth?: number; viewportHeight?: number }} ScreenshotLike */

/** @typedef {{ enabled: boolean; bbox: BoundingBox; showArrow?: boolean; showStepNumber?: boolean }} ScreenshotAnnotation */

const EVENT_PRIORITY = [
  "click",
  "submit",
  "input",
  "menu_select",
  "focus",
  "modal_open",
];

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
 * @param {BoundingBox} bbox
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @param {number} displayWidth
 * @param {number} displayHeight
 */
export function scaleBBoxToDisplay(
  bbox,
  naturalWidth,
  naturalHeight,
  displayWidth,
  displayHeight,
) {
  const scaleX = displayWidth / naturalWidth;
  const scaleY = displayHeight / naturalHeight;
  return {
    x: bbox.x * scaleX,
    y: bbox.y * scaleY,
    w: bbox.w * scaleX,
    h: bbox.h * scaleY,
  };
}

/**
 * @param {BoundingBox} displayBBox
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @param {number} displayWidth
 * @param {number} displayHeight
 */
export function scaleBBoxToNatural(
  displayBBox,
  naturalWidth,
  naturalHeight,
  displayWidth,
  displayHeight,
) {
  const scaleX = naturalWidth / displayWidth;
  const scaleY = naturalHeight / displayHeight;
  return {
    x: Math.round(displayBBox.x * scaleX),
    y: Math.round(displayBBox.y * scaleY),
    w: Math.round(displayBBox.w * scaleX),
    h: Math.round(displayBBox.h * scaleY),
  };
}

/**
 * Перевести bbox из CSS-пикселей вьюпорта (как пишет dom-context) в натуральные
 * пиксели скриншота (кадр видео). Без этого на HiDPI (devicePixelRatio > 1) рамка
 * уезжает, т.к. кадр крупнее вьюпорта. Если размеры вьюпорта неизвестны — passthrough.
 * @param {BoundingBox} bbox
 * @param {ScreenshotLike} screenshot
 */
export function scaleViewportBBoxToNatural(bbox, screenshot) {
  const vw = Number(screenshot?.viewportWidth);
  const vh = Number(screenshot?.viewportHeight);
  const nw = Number(screenshot?.width);
  const nh = Number(screenshot?.height);
  if (!vw || !vh || !nw || !nh) {
    return { ...bbox };
  }
  const scaleX = nw / vw;
  const scaleY = nh / vh;
  return {
    x: Math.round(bbox.x * scaleX),
    y: Math.round(bbox.y * scaleY),
    w: Math.round(bbox.w * scaleX),
    h: Math.round(bbox.h * scaleY),
  };
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
  const event = pickAnnotationEvent(eventIds, events);
  if (!screenshot || !event?.target?.bbox) {
    return null;
  }

  return {
    enabled: true,
    bbox: scaleViewportBBoxToNatural(event.target.bbox, screenshot),
    showArrow: true,
    showStepNumber: true,
  };
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

  const { bbox } = annotation;
  const showArrow = annotation.showArrow !== false;
  const showStepNumber = annotation.showStepNumber !== false;

  ctx.save();
  ctx.strokeStyle = "#e11d48";
  ctx.lineWidth = Math.max(2, Math.round(canvasWidth / 480));
  ctx.fillStyle = "rgba(225, 29, 72, 0.12)";
  ctx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h);
  ctx.strokeRect(bbox.x + 0.5, bbox.y + 0.5, bbox.w, bbox.h);

  if (showStepNumber) {
    const badgeSize = Math.max(22, Math.round(canvasWidth / 40));
    const badgeX = Math.max(4, bbox.x);
    const badgeY = Math.max(4, bbox.y - badgeSize - 4);
    ctx.fillStyle = "#e11d48";
    ctx.fillRect(badgeX, badgeY, badgeSize, badgeSize);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(badgeSize * 0.55)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(stepNumber), badgeX + badgeSize / 2, badgeY + badgeSize / 2);
  }

  if (showArrow) {
    const centerX = bbox.x + bbox.w / 2;
    const centerY = bbox.y + bbox.h / 2;
    const fromX = Math.min(canvasWidth * 0.15, bbox.x - 40);
    const fromY = Math.max(20, bbox.y - 60);
    ctx.strokeStyle = "#e11d48";
    ctx.fillStyle = "#e11d48";
    ctx.lineWidth = Math.max(2, Math.round(canvasWidth / 480));
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(centerX, centerY);
    ctx.stroke();
    const angle = Math.atan2(centerY - fromY, centerX - fromX);
    const head = Math.max(8, Math.round(canvasWidth / 120));
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX - head * Math.cos(angle - Math.PI / 6),
      centerY - head * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      centerX - head * Math.cos(angle + Math.PI / 6),
      centerY - head * Math.sin(angle + Math.PI / 6),
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
