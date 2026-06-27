import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { shouldShowAnnotationWarning } from "../shared/annotation-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const chromeExtensionDoc = readFileSync(
  join(root, "docs/CHROME_EXTENSION.md"),
  "utf8",
);

test("shouldShowAnnotationWarning: inferred → true", () => {
  assert.equal(
    shouldShowAnnotationWarning({
      enabled: true,
      bbox: { x: 1, y: 2, w: 3, h: 4 },
      confidence: "inferred",
    }),
    true,
  );
});

test("shouldShowAnnotationWarning: measured → false", () => {
  assert.equal(
    shouldShowAnnotationWarning({
      enabled: true,
      bbox: { x: 1, y: 2, w: 3, h: 4 },
      confidence: "measured",
    }),
    false,
  );
});

test("T-CLK-8: shouldShowAnnotationWarning clickPoint + measured → false", () => {
  assert.equal(
    shouldShowAnnotationWarning({
      enabled: true,
      bbox: { x: 560, y: 440, w: 32, h: 32 },
      coordinateSpace: "screenshotPixels",
      confidence: "measured",
      annotationMode: "clickPoint",
    }),
    false,
  );
});

test("T-CLK-8: shouldShowAnnotationWarning clickPoint + inferred → true", () => {
  assert.equal(
    shouldShowAnnotationWarning({
      enabled: true,
      bbox: { x: 560, y: 440, w: 32, h: 32 },
      coordinateSpace: "screenshotPixels",
      confidence: "inferred",
      annotationMode: "clickPoint",
    }),
    true,
  );
});

test("shouldShowAnnotationWarning: manual → false", () => {
  assert.equal(
    shouldShowAnnotationWarning({
      enabled: true,
      bbox: { x: 1, y: 2, w: 3, h: 4 },
      confidence: "manual",
    }),
    false,
  );
});

test("shouldShowAnnotationWarning: null → false", () => {
  assert.equal(shouldShowAnnotationWarning(null), false);
});

test("shouldShowAnnotationWarning: disabled inferred → false", () => {
  assert.equal(
    shouldShowAnnotationWarning({
      enabled: false,
      bbox: { x: 1, y: 2, w: 3, h: 4 },
      confidence: "inferred",
    }),
    false,
  );
});

test("T-CLK-8: CHROME_EXTENSION — modal_open = следующий шаг", () => {
  assert.match(
    chromeExtensionDoc,
    /modal_open.*следующ/i,
    "doc must state modal_open is context for the next step",
  );
  assert.match(
    chromeExtensionDoc,
    /Клик = шаг/,
    "doc must contain click-first section heading",
  );
  assert.match(
    chromeExtensionDoc,
    /clickPoint/,
    "doc must document clickPoint fields",
  );
});
