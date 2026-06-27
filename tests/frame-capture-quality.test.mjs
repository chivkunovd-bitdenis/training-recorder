import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { STABILIZER_CONFIG } from "../extension/lib/stabilizer-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frameCaptureSource = readFileSync(
  join(__dirname, "../extension/lib/frame-capture.js"),
  "utf8",
);

test("скриншоты: JPEG quality не ниже 0.95", () => {
  assert.ok(STABILIZER_CONFIG.CAPTURE_JPEG_QUALITY >= 0.95);
});

test("скриншоты: tabCapture запрашивает HiDPI-разрешение", () => {
  assert.ok(STABILIZER_CONFIG.CAPTURE_MAX_WIDTH >= 2560);
  assert.ok(STABILIZER_CONFIG.CAPTURE_MAX_HEIGHT >= 1440);
});

test("скриншоты: frame-capture использует ImageCapture.grabFrame", () => {
  assert.match(frameCaptureSource, /ImageCapture/);
  assert.match(frameCaptureSource, /grabFrame/);
});
