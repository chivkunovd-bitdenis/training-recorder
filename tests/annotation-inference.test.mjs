import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveStepAnnotation } from "../shared/annotation-utils.mjs";

const viewportBbox = { x: 100, y: 50, w: 200, h: 40 };

test("inference: HiDPI без captureContext, legacy viewport — scale, not passthrough", () => {
  const annotation = resolveStepAnnotation({
    eventIds: ["e1"],
    screenshotId: "s1",
    events: [{ id: "e1", type: "click", target: { bbox: viewportBbox } }],
    screenshots: [
      {
        id: "s1",
        width: 2560,
        height: 1440,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
    ],
  });

  assert.ok(annotation);
  assert.notDeepEqual(
    annotation.bbox,
    viewportBbox,
    "viewport coords leaked to annotation",
  );
  assert.deepEqual(annotation.bbox, { x: 200, y: 100, w: 400, h: 80 });
  assert.equal(annotation.coordinateSpace, "screenshotPixels");
  assert.equal(annotation.confidence, "inferred");
});

test("inference: 1:1 old recording — inferred 1:1 OK", () => {
  const bbox = { x: 1120, y: 84, w: 168, h: 40 };
  const annotation = resolveStepAnnotation({
    eventIds: ["e1"],
    screenshotId: "s1",
    events: [{ id: "e1", type: "click", target: { bbox } }],
    screenshots: [
      {
        id: "s1",
        width: 1440,
        height: 900,
        viewportWidth: 1440,
        viewportHeight: 900,
      },
    ],
  });

  assert.ok(annotation);
  assert.deepEqual(annotation.bbox, bbox);
  assert.equal(annotation.coordinateSpace, "screenshotPixels");
  assert.equal(annotation.confidence, "inferred");
});

test("inference: broken old recording — inferred + needsReview-compatible signal", () => {
  /**
   * Return shape for broken legacy (no viewport / captureContext):
   * - coordinateSpace: "screenshotPixels" (never viewport)
   * - confidence: "inferred" — сигнал для UI «проверьте подсветку» (T-ANN-8)
   * - bbox: passthrough viewport coords (неверно, но не silent OK)
   */
  const annotation = resolveStepAnnotation({
    eventIds: ["e1"],
    screenshotId: "s1",
    events: [{ id: "e1", type: "click", target: { bbox: viewportBbox } }],
    screenshots: [{ id: "s1", width: 2560, height: 1440 }],
  });

  assert.ok(annotation);
  assert.deepEqual(annotation.bbox, viewportBbox);
  assert.equal(annotation.coordinateSpace, "screenshotPixels");
  assert.equal(annotation.confidence, "inferred");
});

test("inference: materializedBbox at capture — measured confidence", () => {
  const annotation = resolveStepAnnotation({
    eventIds: ["e1"],
    screenshotId: "s1",
    events: [{ id: "e1", type: "click", target: { bbox: viewportBbox } }],
    screenshots: [
      {
        id: "s1",
        width: 2560,
        height: 1440,
        captureContext: {
          viewportWidth: 1280,
          viewportHeight: 720,
          devicePixelRatio: 2,
        },
        materializedBbox: { x: 200, y: 100, w: 400, h: 80 },
        annotationConfidence: "measured",
      },
    ],
  });

  assert.ok(annotation);
  assert.deepEqual(annotation.bbox, { x: 200, y: 100, w: 400, h: 80 });
  assert.equal(annotation.confidence, "measured");
  assert.equal(annotation.coordinateSpace, "screenshotPixels");
  assert.notDeepEqual(annotation.bbox, viewportBbox);
});

test("inference: saved manual annotation — never overwritten", () => {
  const saved = {
    enabled: true,
    bbox: { x: 10, y: 20, w: 30, h: 40 },
    coordinateSpace: "screenshotPixels",
    confidence: "manual",
  };
  const annotation = resolveStepAnnotation({
    eventIds: ["e1"],
    screenshotId: "s1",
    events: [{ id: "e1", type: "click", target: { bbox: viewportBbox } }],
    screenshots: [
      {
        id: "s1",
        width: 2560,
        height: 1440,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
    ],
    existing: saved,
  });

  assert.deepEqual(annotation, saved);
});

test("inference: anti-regression — DPR2 must not passthrough viewport bbox", () => {
  const ann = resolveStepAnnotation({
    eventIds: ["e1"],
    screenshotId: "s1",
    events: [{ id: "e1", type: "click", target: { bbox: viewportBbox } }],
    screenshots: [
      {
        id: "s1",
        width: 2560,
        height: 1440,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
    ],
  });

  assert.ok(ann);
  assert.notDeepEqual(ann.bbox, viewportBbox, "viewport coords leaked to annotation");
  assert.equal(ann.coordinateSpace, "screenshotPixels");
});
