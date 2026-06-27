import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveStepAnnotation,
  scaleViewportBBoxToNatural,
} from "../shared/annotation-utils.mjs";

const viewportBbox = { x: 100, y: 50, w: 200, h: 40 };

test("HiDPI: bbox вьюпорта переводится в пиксели кадра (2x)", () => {
  const screenshot = {
    id: "s1",
    width: 2560,
    height: 1440,
    viewportWidth: 1280,
    viewportHeight: 720,
  };
  assert.deepEqual(scaleViewportBBoxToNatural(viewportBbox, screenshot), {
    x: 200,
    y: 100,
    w: 400,
    h: 80,
  });
});

test("HiDPI: без viewport — passthrough только когда масштаб неизвестен", () => {
  const bbox = { x: 10, y: 20, w: 30, h: 40 };
  assert.deepEqual(
    scaleViewportBBoxToNatural(bbox, { id: "s", width: 800, height: 600 }),
    bbox,
  );
});

test("HiDPI: anti-passthrough — legacy viewport при 2x image не отдаёт viewport bbox", () => {
  const screenshot = {
    id: "s1",
    width: 2560,
    height: 1440,
    viewportWidth: 1280,
    viewportHeight: 720,
  };
  const scaled = scaleViewportBBoxToNatural(viewportBbox, screenshot);
  assert.notDeepEqual(scaled, viewportBbox, "viewport coords leaked via scale helper");
  assert.deepEqual(scaled, { x: 200, y: 100, w: 400, h: 80 });
});

test("resolveStepAnnotation масштабирует bbox под HiDPI-скрин", () => {
  const annotation = resolveStepAnnotation({
    eventIds: ["e1"],
    screenshotId: "s1",
    events: [
      {
        id: "e1",
        type: "click",
        target: { bbox: viewportBbox },
      },
    ],
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
  assert.deepEqual(annotation.bbox, { x: 200, y: 100, w: 400, h: 80 });
  assert.equal(annotation.coordinateSpace, "screenshotPixels");
  assert.equal(annotation.confidence, "inferred");
  assert.notDeepEqual(annotation.bbox, viewportBbox, "viewport coords leaked to annotation");
});
