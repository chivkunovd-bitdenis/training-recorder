import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bakeAnnotatedScreenshot,
  drawAnnotationOnCanvas,
} from "../shared/annotation-utils.mjs";
import { resolveDecorationLayout } from "../shared/annotation-geometry.mjs";

const bbox = { x: 200, y: 100, w: 400, h: 80 };
const imageSize = { width: 2560, height: 1440 };
const annotation = { enabled: true, bbox };

/** @returns {CanvasRenderingContext2D} */
function createRecordingContext(width, height) {
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
    strokeRect(x, y, w, h) {
      ops.push({ op: "strokeRect", x, y, w, h });
    },
    fillText(text, x, y) {
      ops.push({ op: "fillText", text, x, y });
    },
    beginPath() {},
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
  };
}

test("canvas parity: layout numbers match geometry for fixed bbox", () => {
  const layout = resolveDecorationLayout(bbox, 3, imageSize);
  const ctx = createRecordingContext(imageSize.width, imageSize.height);
  drawAnnotationOnCanvas(ctx, annotation, 3, imageSize.width, imageSize.height);

  const highlightFill = ctx.ops.find(
    (op) => op.op === "fillRect" && op.fillStyle === "rgba(225, 29, 72, 0.12)",
  );
  assert.ok(highlightFill);
  assert.equal(highlightFill.x, layout.highlight.x);
  assert.equal(highlightFill.y, layout.highlight.y);
  assert.equal(highlightFill.w, layout.highlight.w);
  assert.equal(highlightFill.h, layout.highlight.h);

  const badgeFill = ctx.ops.find(
    (op) =>
      op.op === "fillRect" &&
      op.fillStyle === "#e11d48" &&
      op.x === layout.badge.x &&
      op.y === layout.badge.y,
  );
  assert.ok(badgeFill);

  const moveTo = ctx.ops.find((op) => op.op === "moveTo");
  const lineTo = ctx.ops.find((op) => op.op === "lineTo");
  assert.ok(moveTo);
  assert.ok(lineTo);
  assert.equal(moveTo.x, layout.arrow.from.x);
  assert.equal(moveTo.y, layout.arrow.from.y);
  assert.equal(lineTo.x, layout.arrow.to.x);
  assert.equal(lineTo.y, layout.arrow.to.y);
});

test("canvas parity: right-side button badge X ≠ 4 (old left clamp bug)", () => {
  const rightAnnotation = {
    enabled: true,
    bbox: { x: 2000, y: 100, w: 400, h: 80 },
  };
  const layout = resolveDecorationLayout(
    rightAnnotation.bbox,
    1,
    imageSize,
  );
  assert.notEqual(layout.badge.x, 4);
  assert.ok(layout.badge.x > 100);
});

test("canvas parity: bakeAnnotatedScreenshot smoke — blob size > 0", async () => {
  if (typeof document === "undefined") {
    return;
  }

  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    pretendToBeVisual: true,
  });
  globalThis.document = dom.window.document;
  globalThis.Image = dom.window.Image;
  globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  globalThis.HTMLImageElement = dom.window.HTMLImageElement;

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ccc";
  ctx.fillRect(0, 0, 64, 64);
  const dataUrl = canvas.toDataURL("image/png");

  const image = new Image();
  image.src = dataUrl;
  await image.decode();

  const blob = await bakeAnnotatedScreenshot(image, annotation, 1);
  assert.ok(blob.size > 0);
});
