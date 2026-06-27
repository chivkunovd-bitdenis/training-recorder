import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import {
  validateBBoxInImage,
  validatePointInImage,
  viewportBBoxToScreenshot,
  viewportPointToScreenshot,
} from "../shared/annotation-geometry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const extensionDir = join(root, "extension");
/** @param {unknown} value */
function fromDomRealm(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {Record<string, unknown>} [windowOverrides]
 */
function loadDomContext(windowOverrides = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.com/test",
    pretendToBeVisual: true,
    runScripts: "dangerously",
  });

  Object.assign(dom.window, {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 2,
    scrollX: 0,
    scrollY: 600,
    visualViewport: { scale: 1 },
    ...windowOverrides,
  });

  for (const relativePath of [
    "lib/annotation-geometry.js",
    "content/dom-context.js",
  ]) {
    const scriptEl = dom.window.document.createElement("script");
    scriptEl.textContent = readFileSync(
      join(extensionDir, relativePath),
      "utf8",
    );
    dom.window.document.body.appendChild(scriptEl);
  }

  return dom.window;
}

test("buildCaptureContext возвращает все поля окна", () => {
  const win = loadDomContext();
  const ctx = win.TrainingRecorderDom.buildCaptureContext();

  assert.deepEqual(fromDomRealm(ctx), {
    viewportWidth: 1280,
    viewportHeight: 720,
    devicePixelRatio: 2,
    scrollX: 0,
    scrollY: 600,
    visualViewportScale: 1,
  });
});

test("materialize: viewport bbox → screenshot pixels при DPR=2 и scrollY=600", () => {
  const win = loadDomContext();
  const captureContext = win.TrainingRecorderDom.buildCaptureContext();
  const viewportBbox = { x: 400, y: 200, w: 100, h: 30 };
  const screenshot = {
    width: 2560,
    height: 1440,
    captureContext,
  };

  const materialized = viewportBBoxToScreenshot(viewportBbox, screenshot);
  assert.deepEqual(materialized, { x: 800, y: 400, w: 200, h: 60 });
  assert.equal(
    validateBBoxInImage(materialized, screenshot.width, screenshot.height).ok,
    true,
  );
});

test("buildScreenshotMeta записывает captureContext и materializedBbox", () => {
  const win = loadDomContext();
  const viewportBbox = { x: 400, y: 200, w: 100, h: 30 };
  const mainShot = {
    id: "scr-test",
    ts: 1000,
    confidence: "high",
    width: 2560,
    height: 1440,
    imageBase64: "abc",
    byteLength: 3,
  };
  const events = [
    {
      id: "evt-test",
      target: { bbox: viewportBbox },
    },
  ];

  const meta = win.TrainingRecorderDom.buildScreenshotMeta({
    mainShot,
    eventId: "evt-test",
    events,
    geometry: win.TrainingRecorderGeometry,
  });

  assert.equal(meta.captureContext.devicePixelRatio, 2);
  assert.deepEqual(fromDomRealm(meta.materializedBbox), {
    x: 800,
    y: 400,
    w: 200,
    h: 60,
  });
  assert.equal(meta.annotationConfidence, "measured");
  assert.equal(meta.viewportWidth, 1280);
  assert.equal(meta.imageBase64, undefined);
});

test("extension geometry parity: viewportBBoxToScreenshot совпадает с shared/", () => {
  const win = loadDomContext({ devicePixelRatio: 2 });
  const bbox = { x: 100, y: 50, w: 200, h: 40 };
  const screenshot = {
    width: 2560,
    height: 1440,
    captureContext: win.TrainingRecorderDom.buildCaptureContext(),
  };

  const sharedResult = viewportBBoxToScreenshot(bbox, screenshot);
  const extensionResult = win.TrainingRecorderGeometry.viewportBBoxToScreenshot(
    bbox,
    screenshot,
  );
  assert.deepEqual(fromDomRealm(extensionResult), sharedResult);
});

test("T-CLK-4: viewportPointToScreenshot DPR=2 — (640,360) → (1280,720) ±1px", () => {
  const win = loadDomContext({ devicePixelRatio: 2, scrollY: 0 });
  const screenshot = {
    width: 2560,
    height: 1440,
    captureContext: win.TrainingRecorderDom.buildCaptureContext(),
  };

  const sharedResult = viewportPointToScreenshot({ x: 640, y: 360 }, screenshot);
  assert.ok(Math.abs(sharedResult.x - 1280) <= 1);
  assert.ok(Math.abs(sharedResult.y - 720) <= 1);
  assert.equal(
    validatePointInImage(sharedResult, screenshot.width, screenshot.height).ok,
    true,
  );

  const extensionResult = win.TrainingRecorderGeometry.viewportPointToScreenshot(
    { x: 640, y: 360 },
    screenshot,
  );
  assert.deepEqual(fromDomRealm(extensionResult), sharedResult);
});

test("T-CLK-4: buildScreenshotMeta пишет materializedClickPoint, measured confidence", () => {
  const win = loadDomContext({ devicePixelRatio: 2, scrollY: 0 });
  const mainShot = {
    id: "scr-click",
    ts: 800,
    confidence: "high",
    width: 2560,
    height: 1440,
  };
  const events = [
    {
      id: "evt-click",
      type: "click",
      target: {
        clickPoint: { x: 612, y: 198 },
        bbox: { x: 520, y: 180, w: 140, h: 36 },
      },
    },
  ];

  const meta = win.TrainingRecorderDom.buildScreenshotMeta({
    mainShot,
    eventId: "evt-click",
    events,
    geometry: win.TrainingRecorderGeometry,
  });

  assert.deepEqual(fromDomRealm(meta.materializedClickPoint), {
    x: 1224,
    y: 396,
  });
  assert.equal(meta.annotationConfidence, "measured");
  assert.equal(meta.materializedBbox, undefined);
});

test("T-CLK-4: buildScreenshotMeta с clickPoint не вызывает querySelector", () => {
  const win = loadDomContext({ devicePixelRatio: 2 });
  let querySelectorCalls = 0;
  const original = win.document.querySelector.bind(win.document);
  win.document.querySelector = (...args) => {
    querySelectorCalls += 1;
    return original(...args);
  };

  win.TrainingRecorderDom.buildScreenshotMeta({
    mainShot: {
      id: "scr-click",
      ts: 800,
      confidence: "high",
      width: 2560,
      height: 1440,
    },
    eventId: "evt-click",
    events: [
      {
        id: "evt-click",
        type: "click",
        target: { clickPoint: { x: 640, y: 360 } },
      },
    ],
    geometry: win.TrainingRecorderGeometry,
  });

  assert.equal(querySelectorCalls, 0);
});
