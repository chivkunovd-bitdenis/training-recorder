import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  drawAnnotationOnCanvas,
  pickAnnotationEventForScreenshot,
  resolveStepAnnotation,
  screenshotAnnotationToDisplayLayer,
} from "../shared/annotation-utils.mjs";
import {
  resolveDecorationLayout,
  resolveDecorationLayoutForPoint,
} from "../shared/annotation-geometry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");
const clickPointTimeline = JSON.parse(
  readFileSync(join(fixturesDir, "timeline.click-point.json"), "utf8"),
);

const imageSize2560 = { width: 2560, height: 1440 };
const display960x540 = { width: 960, height: 540 };

/** @returns {CanvasRenderingContext2D} */
function createRecordingContext() {
  /** @type {Array<Record<string, unknown>>} */
  const ops = [];
  return {
    ops,
    save() {},
    restore() {},
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect(x, y, w, h) {
      ops.push({ op: "fillRect", x, y, w, h, fillStyle: this.fillStyle });
    },
    strokeRect() {},
    beginPath() {},
    arc(x, y, radius) {
      ops.push({ op: "arc", x, y, radius, fillStyle: this.fillStyle });
    },
    moveTo(x, y) {
      ops.push({ op: "moveTo", x, y });
    },
    lineTo(x, y) {
      ops.push({ op: "lineTo", x, y });
    },
    closePath() {},
    fill() {
      ops.push({ op: "fill" });
    },
    stroke() {
      ops.push({ op: "stroke" });
    },
    fillText(text, x, y) {
      ops.push({ op: "fillText", text, x, y });
    },
  };
}

test("T-CLK-5: materializedClickPoint справа — стрелка не у левого края", () => {
  const screenshot = {
    id: "scr-right",
    width: 2560,
    height: 1440,
    eventId: "evt-right-click",
    materializedClickPoint: { x: 2100, y: 720 },
    annotationConfidence: "measured",
  };
  const annotation = resolveStepAnnotation({
    eventIds: ["evt-right-click"],
    screenshotId: "scr-right",
    events: [
      {
        id: "evt-right-click",
        type: "click",
        target: {
          bbox: { x: 2000, y: 680, w: 140, h: 36 },
        },
      },
    ],
    screenshots: [screenshot],
  });

  assert.ok(annotation);
  assert.equal(annotation.annotationMode, "clickPoint");
  assert.equal(annotation.confidence, "measured");

  const layer = screenshotAnnotationToDisplayLayer(
    annotation,
    screenshot,
    display960x540,
    1,
  );

  assert.ok(layer.decoration.arrow.to.x > layer.renderSize.width * 0.5);
  assert.notEqual(layer.decoration.badge.x, 4);
  assert.ok(layer.decoration.badge.x > 100);
});

test("T-CLK-5: modal_open в eventIds — аннотация от click, не dialog bbox", () => {
  const clickEvent = {
    id: "evt-click",
    type: "click",
    target: {
      text: "Закрыть короб",
      bbox: { x: 520, y: 180, w: 140, h: 36 },
    },
  };
  const modalEvent = {
    id: "evt-modal",
    type: "modal_open",
    target: {
      text: "Подтверждение",
      bbox: { x: 400, y: 200, w: 480, h: 320 },
    },
  };
  const screenshot = {
    id: "scr-click",
    width: 2560,
    height: 1440,
    eventId: "evt-click",
    materializedClickPoint: { x: 1224, y: 396 },
    annotationConfidence: "measured",
  };

  const picked = pickAnnotationEventForScreenshot(
    screenshot,
    ["evt-click", "evt-modal"],
    [clickEvent, modalEvent],
  );
  assert.equal(picked?.id, "evt-click");
  assert.equal(picked?.type, "click");

  const annotation = resolveStepAnnotation({
    eventIds: ["evt-click", "evt-modal"],
    screenshotId: "scr-click",
    events: [clickEvent, modalEvent],
    screenshots: [screenshot],
  });

  assert.ok(annotation);
  assert.equal(annotation.annotationMode, "clickPoint");
  assert.equal(annotation.materializedFromEventId, "evt-click");
  assert.notDeepEqual(annotation.bbox, modalEvent.target.bbox);
  const centerX = annotation.bbox.x + annotation.bbox.w / 2;
  assert.ok(Math.abs(centerX - 1224) <= 1);
});

test("T-CLK-5: canvas parity — point mode preview ≈ export", () => {
  const annotation = resolveStepAnnotation({
    eventIds: clickPointTimeline.events.map((event) => event.id),
    screenshotId: clickPointTimeline.screenshots[0].id,
    events: clickPointTimeline.events,
    screenshots: clickPointTimeline.screenshots,
  });

  assert.ok(annotation);
  assert.equal(annotation.annotationMode, "clickPoint");

  const point = {
    x: annotation.bbox.x + annotation.bbox.w / 2,
    y: annotation.bbox.y + annotation.bbox.h / 2,
  };
  const layout = resolveDecorationLayoutForPoint(point, 1, imageSize2560);
  const ctx = createRecordingContext();
  drawAnnotationOnCanvas(
    ctx,
    annotation,
    1,
    imageSize2560.width,
    imageSize2560.height,
  );

  const arcFill = ctx.ops.find(
    (op) => op.op === "arc" && op.fillStyle === "rgba(225, 29, 72, 0.12)",
  );
  assert.ok(arcFill, "point mode draws circle highlight");
  assert.equal(arcFill.x, layout.highlight.x + layout.highlight.w / 2);
  assert.equal(arcFill.y, layout.highlight.y + layout.highlight.h / 2);

  const moveTo = ctx.ops.find((op) => op.op === "moveTo");
  const lineTo = ctx.ops.find((op) => op.op === "lineTo");
  assert.ok(moveTo);
  assert.ok(lineTo);
  assert.equal(moveTo.x, layout.arrow.from.x);
  assert.equal(moveTo.y, layout.arrow.from.y);
  assert.equal(lineTo.x, layout.arrow.to.x);
  assert.equal(lineTo.y, layout.arrow.to.y);

  const rectLayout = resolveDecorationLayout(
    modalEventLikeBbox(),
    1,
    imageSize2560,
  );
  assert.notEqual(lineTo.x, rectLayout.arrow.to.x);
});

/** @returns {{ x: number; y: number; w: number; h: number }} */
function modalEventLikeBbox() {
  return { x: 400, y: 200, w: 480, h: 320 };
}
