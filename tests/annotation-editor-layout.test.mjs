import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayBBoxToScreenshot,
  screenshotAnnotationToDisplayLayer,
} from "../shared/annotation-utils.mjs";

const screenshot2560 = { width: 2560, height: 1440 };
const display960x360 = { width: 960, height: 360 };

test("editor layout: letterbox — highlight displayX ≥ offsetX", () => {
  const annotation = {
    enabled: true,
    bbox: { x: 1000, y: 200, w: 400, h: 80 },
  };
  const layer = screenshotAnnotationToDisplayLayer(
    annotation,
    screenshot2560,
    display960x360,
    1,
  );

  assert.ok(layer.displayRect.x >= 0, "highlight not on left letterbox");
  assert.ok(
    layer.displayRect.x + layer.displayRect.w / 2 <= layer.renderSize.width,
    "highlight center inside render area",
  );
  assert.equal(layer.displayRect.x, 250);
});

test("editor layout: DPR2 right button — display x > 50% render width", () => {
  const annotation = {
    enabled: true,
    bbox: { x: 2000, y: 100, w: 400, h: 80 },
  };
  const layer = screenshotAnnotationToDisplayLayer(
    annotation,
    screenshot2560,
    display960x360,
    1,
  );

  assert.ok(
    layer.displayRect.x > layer.renderSize.width * 0.5,
    "right-side button must not appear on left edge",
  );
});

test("editor layout: arrow from/to inside render area", () => {
  const annotation = {
    enabled: true,
    bbox: { x: 200, y: 100, w: 400, h: 80 },
  };
  const layer = screenshotAnnotationToDisplayLayer(
    annotation,
    screenshot2560,
    display960x360,
    1,
  );

  const { from, to } = layer.decoration.arrow;
  for (const point of [from, to]) {
    assert.ok(point.x >= 0 && point.x <= layer.renderSize.width);
    assert.ok(point.y >= 0 && point.y <= layer.renderSize.height);
  }
});

test("editor layout: drag roundtrip +30px display X → screenshot bbox +30/scale", () => {
  const annotation = {
    enabled: true,
    bbox: { x: 200, y: 100, w: 400, h: 80 },
  };
  const layer = screenshotAnnotationToDisplayLayer(
    annotation,
    screenshot2560,
    display960x360,
    1,
  );
  const scale = layer.renderSize.width / screenshot2560.width;
  const movedDisplay = {
    ...layer.displayRect,
    x: layer.displayRect.x + 30,
  };
  const saved = displayBBoxToScreenshot(
    movedDisplay,
    screenshot2560,
    display960x360,
  );

  const expectedDelta = Math.round(30 / scale);
  assert.ok(
    Math.abs(saved.x - annotation.bbox.x - expectedDelta) <= 2,
    `expected delta ~${expectedDelta}, got ${saved.x - annotation.bbox.x}`,
  );
});
