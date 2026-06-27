import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  displayBBoxToScreenshot,
  measuredScale,
  resolveCaptureContext,
  resolveDecorationLayout,
  screenshotBBoxToDisplay,
  validateBBoxInImage,
  viewportBBoxToScreenshot,
} from "../shared/annotation-geometry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const matrix = JSON.parse(
  readFileSync(join(root, "fixtures/annotation-matrix.json"), "utf8"),
);

/** @param {Record<string, number>} expected @param {Record<string, number>} actual @param {number} [tol=1] */
function assertRectClose(expected, actual, tol = 1) {
  for (const key of ["x", "y", "w", "h"]) {
    assert.ok(
      Math.abs(expected[key] - actual[key]) <= tol,
      `${key}: expected ${expected[key]}, got ${actual[key]}`,
    );
  }
}

/** @param {import('../shared/annotation-geometry.mjs').ScreenshotLike} screenshot */
function screenshotFromCase(caseRow) {
  return {
    width: caseRow.image.width,
    height: caseRow.image.height,
    captureContext: {
      viewportWidth: caseRow.viewport.width,
      viewportHeight: caseRow.viewport.height,
      devicePixelRatio: caseRow.devicePixelRatio,
      scrollY: caseRow.scrollY ?? 0,
    },
  };
}

for (const caseRow of matrix.cases) {
  if (caseRow.expectedScreenshotBbox) {
    test(`matrix transform: ${caseRow.id}`, () => {
      const screenshot = screenshotFromCase(caseRow);
      const result = viewportBBoxToScreenshot(caseRow.viewportBbox, screenshot);
      assertRectClose(caseRow.expectedScreenshotBbox, result);
    });
  }
}

test("passthrough trap: DPR2 viewport bbox must scale, not passthrough", () => {
  const viewportBbox = { x: 100, y: 50, w: 200, h: 40 };
  const screenshot = {
    width: 2560,
    height: 1440,
    captureContext: {
      viewportWidth: 1280,
      viewportHeight: 720,
      devicePixelRatio: 2,
    },
  };
  const result = viewportBBoxToScreenshot(viewportBbox, screenshot);
  assertRectClose({ x: 200, y: 100, w: 400, h: 80 }, result);
  assert.notDeepEqual(result, viewportBbox, "viewport coords leaked to screenshot");
});

test("legacy screenshot without captureContext: resolveCaptureContext builds context", () => {
  const screenshot = {
    width: 2560,
    height: 1440,
    viewportWidth: 1280,
    viewportHeight: 720,
  };
  const ctx = resolveCaptureContext(screenshot);
  assert.ok(ctx);
  assert.equal(ctx.viewportWidth, 1280);
  assert.equal(ctx.devicePixelRatio, 2);

  const scale = measuredScale(screenshot);
  assert.ok(scale);
  assert.equal(scale.scaleX, 2);
  assert.equal(scale.scaleY, 2);

  const result = viewportBBoxToScreenshot(
    { x: 100, y: 50, w: 200, h: 40 },
    screenshot,
  );
  assertRectClose({ x: 200, y: 100, w: 400, h: 80 }, result);
});

test("letterbox display: highlight center inside render area", () => {
  const caseRow = matrix.cases.find((row) => row.id === "letterbox-wide");
  assert.ok(caseRow);

  const screenshot = screenshotFromCase(caseRow);
  const { rect, offset, renderSize } = screenshotBBoxToDisplay(
    caseRow.screenshotBbox,
    screenshot,
    caseRow.display,
  );

  const tol = caseRow.displayTolerance ?? 2;
  assert.ok(
    Math.abs(rect.x - caseRow.expectedDisplayRectX) <= tol,
    `display rect x: expected ~${caseRow.expectedDisplayRectX}, got ${rect.x}`,
  );
  assert.ok(
    Math.abs(offset.y - caseRow.expectedOffsetY) <= tol,
    `offset y: expected ~${caseRow.expectedOffsetY}, got ${offset.y}`,
  );

  const centerX = rect.x + rect.w / 2 + offset.x;
  const centerY = rect.y + rect.h / 2 + offset.y;
  assert.ok(centerX >= offset.x);
  assert.ok(centerX <= offset.x + renderSize.width);
  assert.ok(centerY >= offset.y);
  assert.ok(centerY <= offset.y + renderSize.height);
});

test("validateBBoxInImage rejects negative origin and overflow", () => {
  assert.equal(validateBBoxInImage({ x: -10, y: 0, w: 50, h: 50 }, 100, 100).ok, false);
  assert.equal(
    validateBBoxInImage({ x: 80, y: 0, w: 50, h: 50 }, 100, 100).ok,
    false,
  );
  assert.equal(validateBBoxInImage({ x: 0, y: 0, w: 50, h: 50 }, 100, 100).ok, true);
});

test("decoration not at origin: dpr2-retina right button arrow.from.x > 100", () => {
  const caseRow = matrix.cases.find((row) => row.id === "dpr2-retina");
  assert.ok(caseRow?.decorationViewportBbox);

  const screenshot = screenshotFromCase(caseRow);
  const screenshotBbox = viewportBBoxToScreenshot(
    caseRow.decorationViewportBbox,
    screenshot,
  );
  const layout = resolveDecorationLayout(screenshotBbox, 1, caseRow.image);
  assert.ok(
    layout.arrow.from.x > caseRow.decorationMinArrowFromX,
    `arrow.from.x=${layout.arrow.from.x} should be > ${caseRow.decorationMinArrowFromX}`,
  );
  assert.equal(layout.clamped, false);
});

test("drag roundtrip: display → screenshot → display delta ≤2px", () => {
  const screenshot = {
    width: 2560,
    height: 1440,
    captureContext: {
      viewportWidth: 1280,
      viewportHeight: 720,
      devicePixelRatio: 2,
    },
  };
  const displaySize = { width: 960, height: 540 };
  const original = { x: 200, y: 100, w: 400, h: 80 };
  const moved = { x: 230, y: 100, w: 400, h: 80 };

  const screenshotMoved = displayBBoxToScreenshot(moved, screenshot, displaySize);
  const { rect: roundtrip } = screenshotBBoxToDisplay(
    screenshotMoved,
    screenshot,
    displaySize,
  );

  assert.ok(Math.abs(roundtrip.x - moved.x) <= 2);
  assert.ok(Math.abs(roundtrip.y - moved.y) <= 2);
});
