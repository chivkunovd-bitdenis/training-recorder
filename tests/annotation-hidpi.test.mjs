import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveStepAnnotation,
  scaleViewportBBoxToNatural,
} from "../shared/annotation-utils.mjs";

test("HiDPI: bbox вьюпорта переводится в пиксели кадра (2x)", () => {
  const bbox = { x: 100, y: 50, w: 200, h: 40 };
  const screenshot = {
    id: "s1",
    width: 2560,
    height: 1440,
    viewportWidth: 1280,
    viewportHeight: 720,
  };
  assert.deepEqual(scaleViewportBBoxToNatural(bbox, screenshot), {
    x: 200,
    y: 100,
    w: 400,
    h: 80,
  });
});

test("HiDPI: без размеров вьюпорта — passthrough (обратная совместимость)", () => {
  const bbox = { x: 10, y: 20, w: 30, h: 40 };
  assert.deepEqual(
    scaleViewportBBoxToNatural(bbox, { id: "s", width: 800, height: 600 }),
    bbox,
  );
});

test("resolveStepAnnotation масштабирует bbox под HiDPI-скрин", () => {
  const annotation = resolveStepAnnotation({
    eventIds: ["e1"],
    screenshotId: "s1",
    events: [
      {
        id: "e1",
        type: "click",
        target: { bbox: { x: 100, y: 50, w: 200, h: 40 } },
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
  assert.deepEqual(annotation.bbox, { x: 200, y: 100, w: 400, h: 80 });
});
