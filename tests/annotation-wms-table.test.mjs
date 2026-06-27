import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { viewportPointToScreenshot } from "../shared/annotation-geometry.mjs";
import {
  resolveStepAnnotation,
  screenshotAnnotationToDisplayLayer,
} from "../shared/annotation-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const wmsTimeline = JSON.parse(
  readFileSync(join(root, "fixtures/timeline.wms-table-clicks.json"), "utf8"),
);
const matrix = JSON.parse(
  readFileSync(join(root, "fixtures/annotation-matrix.json"), "utf8"),
);
const wmsCase = matrix.cases.find((row) => row.id === "wms-two-rows-click-point");
assert.ok(wmsCase, "annotation-matrix must contain wms-two-rows-click-point");

const SHARED_CSS_PATH =
  "table.wms-table > tbody > tr > td.actions > button.row-action";
const display960x540 = { width: 960, height: 540 };

/** @param {{ x: number; y: number }} a @param {{ x: number; y: number }} b */
function pointDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** @param {ScreenshotAnnotation} annotation */
function annotationClickCenter(annotation) {
  return {
    x: annotation.bbox.x + annotation.bbox.w / 2,
    y: annotation.bbox.y + annotation.bbox.h / 2,
  };
}

/** @param {typeof wmsTimeline.events[0]} event @param {typeof wmsTimeline.screenshots[0]} screenshot */
function resolveWmsStepAnnotation(event, screenshot) {
  return resolveStepAnnotation({
    eventIds: [event.id],
    screenshotId: screenshot.id,
    events: wmsTimeline.events,
    screenshots: wmsTimeline.screenshots,
  });
}

/**
 * Старый путь: refreshEventBBox + querySelector(cssPath) → bbox первой кнопки в DOM.
 * Оба шага получают один и тот же viewport-bbox строки 1.
 * @param {typeof wmsTimeline.screenshots[0]} screenshot
 */
function resolveLegacyCssPathAnnotation(screenshot) {
  const firstRowBbox = wmsTimeline.events[0].target.bbox;
  const screenshotWithoutClickPoint = {
    ...screenshot,
    materializedClickPoint: undefined,
    materializedBbox: undefined,
  };
  return resolveStepAnnotation({
    eventIds: [screenshot.eventId],
    screenshotId: screenshot.id,
    events: [
      {
        id: screenshot.eventId,
        type: "click",
        target: {
          cssPath: SHARED_CSS_PATH,
          bbox: firstRowBbox,
        },
      },
    ],
    screenshots: [screenshotWithoutClickPoint],
  });
}

test("T-CLK-7: fixture — один cssPath, разные clickPoint и materializedClickPoint", () => {
  const [closeEvent, openEvent] = wmsTimeline.events;
  const [closeShot, openShot] = wmsTimeline.screenshots;

  assert.equal(closeEvent.target.cssPath, openEvent.target.cssPath);
  assert.equal(closeEvent.target.cssPath, SHARED_CSS_PATH);
  assert.notDeepEqual(closeEvent.target.clickPoint, openEvent.target.clickPoint);
  assert.notDeepEqual(
    closeShot.materializedClickPoint,
    openShot.materializedClickPoint,
  );

  assert.deepEqual(
    closeShot.materializedClickPoint,
    viewportPointToScreenshot(closeEvent.target.clickPoint, closeShot),
  );
  assert.deepEqual(
    openShot.materializedClickPoint,
    viewportPointToScreenshot(openEvent.target.clickPoint, openShot),
  );
});

test("T-CLK-7: шаг 1 и шаг 2 — разные точки подсветки (distance > 100 px)", () => {
  const closeAnnotation = resolveWmsStepAnnotation(
    wmsTimeline.events[0],
    wmsTimeline.screenshots[0],
  );
  const openAnnotation = resolveWmsStepAnnotation(
    wmsTimeline.events[1],
    wmsTimeline.screenshots[1],
  );

  assert.ok(closeAnnotation);
  assert.ok(openAnnotation);
  assert.equal(closeAnnotation.annotationMode, "clickPoint");
  assert.equal(openAnnotation.annotationMode, "clickPoint");

  const closeCenter = annotationClickCenter(closeAnnotation);
  const openCenter = annotationClickCenter(openAnnotation);
  const distance = pointDistance(closeCenter, openCenter);

  assert.ok(
    distance > wmsCase.minPointDistancePx,
    `expected distance > ${wmsCase.minPointDistancePx}, got ${distance}`,
  );
  assert.deepEqual(closeCenter, wmsCase.row1MaterializedClickPoint);
  assert.deepEqual(openCenter, wmsCase.row2MaterializedClickPoint);
});

test("T-CLK-7: правый клик — стрелка не у левого края (< 5% width)", () => {
  const openAnnotation = resolveWmsStepAnnotation(
    wmsTimeline.events[1],
    wmsTimeline.screenshots[1],
  );
  assert.ok(openAnnotation);

  const layer = screenshotAnnotationToDisplayLayer(
    openAnnotation,
    wmsTimeline.screenshots[1],
    display960x540,
    2,
  );

  const minX = layer.renderSize.width * wmsCase.rightClickMinArrowRatioX;
  assert.ok(
    layer.decoration.arrow.to.x >= minX,
    `arrow.to.x=${layer.decoration.arrow.to.x} must be >= ${minX}`,
  );
  assert.ok(layer.decoration.arrow.to.x > layer.renderSize.width * 0.5);
});

test("T-CLK-7: regression — без clickPoint cssPath схлопывает оба шага в bbox строки 1", () => {
  const closeLegacy = resolveLegacyCssPathAnnotation(wmsTimeline.screenshots[0]);
  const openLegacy = resolveLegacyCssPathAnnotation(wmsTimeline.screenshots[1]);

  assert.ok(closeLegacy);
  assert.ok(openLegacy);
  assert.equal(closeLegacy.confidence, "inferred");
  assert.equal(openLegacy.confidence, "inferred");
  assert.equal(closeLegacy.annotationMode, undefined);
  assert.equal(openLegacy.annotationMode, undefined);

  const closeCenter = annotationClickCenter(closeLegacy);
  const openCenter = annotationClickCenter(openLegacy);
  assert.deepEqual(closeCenter, openCenter);

  const openWithClickPoint = resolveWmsStepAnnotation(
    wmsTimeline.events[1],
    wmsTimeline.screenshots[1],
  );
  assert.ok(openWithClickPoint);
  const clickCenter = annotationClickCenter(openWithClickPoint);
  assert.notDeepEqual(clickCenter, openCenter);

  const drift = pointDistance(clickCenter, openCenter);
  assert.ok(
    drift > wmsCase.minPointDistancePx,
    `clickPoint fixes drift ${drift}px vs legacy cssPath collapse`,
  );
});
