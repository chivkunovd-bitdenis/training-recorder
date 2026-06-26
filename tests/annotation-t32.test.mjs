import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  pickAnnotationEvent,
  resolveStepAnnotation,
  scaleBBoxToDisplay,
} from "../shared/annotation-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");
const timeline = JSON.parse(
  readFileSync(join(fixturesDir, "timeline.mock.json"), "utf8"),
);

test("T3.2: pickAnnotationEvent выбирает click «Создать клиента»", () => {
  const event = pickAnnotationEvent(["evt-001", "evt-002"], timeline.events);
  assert.equal(event?.id, "evt-001");
  assert.equal(event?.target?.bbox?.w, 168);
});

test("T3.2: resolveStepAnnotation ставит bbox кнопки для шага 1", () => {
  const annotation = resolveStepAnnotation({
    eventIds: ["evt-001", "evt-002"],
    screenshotId: "scr-001",
    events: timeline.events,
    screenshots: timeline.screenshots,
  });

  assert.ok(annotation);
  assert.equal(annotation.enabled, true);
  assert.deepEqual(annotation.bbox, { x: 1120, y: 84, w: 168, h: 40 });
});

test("T3.2: scaleBBoxToDisplay масштабирует рамку под ширину превью", () => {
  const display = scaleBBoxToDisplay(
    { x: 1120, y: 84, w: 168, h: 40 },
    1440,
    900,
    720,
    450,
  );

  assert.equal(display.x, 560);
  assert.equal(display.w, 84);
});

test("T3.2: сохранённая аннотация не перезаписывается автоматически", () => {
  const saved = {
    enabled: true,
    bbox: { x: 10, y: 20, w: 30, h: 40 },
  };
  const annotation = resolveStepAnnotation({
    eventIds: ["evt-001"],
    screenshotId: "scr-001",
    events: timeline.events,
    screenshots: timeline.screenshots,
    existing: saved,
  });

  assert.deepEqual(annotation, saved);
});
