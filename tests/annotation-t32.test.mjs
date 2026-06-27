import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  findRelatedPointerEvent,
  pickAnnotationEvent,
  pickAnnotationEventForScreenshot,
  resolveStepAnnotation,
  scaleBBoxToDisplay,
} from "../shared/annotation-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");
const timeline = JSON.parse(
  readFileSync(join(fixturesDir, "timeline.mock.json"), "utf8"),
);
const hidpiTimeline = JSON.parse(
  readFileSync(join(fixturesDir, "timeline.hidpi-scrolled.json"), "utf8"),
);

test("T3.2: pickAnnotationEvent предпочитает click перед modal_open в шаге", () => {
  const event = pickAnnotationEvent(["evt-001", "evt-002"], timeline.events);
  assert.equal(event?.id, "evt-001");
  assert.equal(event?.type, "click");
});

test("T3.2: findRelatedPointerEvent находит клик перед modal_open", () => {
  const modal = timeline.events.find((event) => event.id === "evt-002");
  const click = findRelatedPointerEvent(
    ["evt-001", "evt-002"],
    timeline.events,
    modal,
  );
  assert.equal(click?.id, "evt-001");
});

test("T3.2: pickAnnotationEventForScreenshot берёт eventId скрина (клик)", () => {
  const screenshot = timeline.screenshots.find((shot) => shot.id === "scr-001");
  const event = pickAnnotationEventForScreenshot(
    screenshot,
    ["evt-001", "evt-002"],
    timeline.events,
  );
  assert.equal(event?.id, "evt-001");
});

test("T3.2: pickAnnotationEventForScreenshot подменяет modal_open на ближайший click", () => {
  const event = pickAnnotationEventForScreenshot(
    { id: "scr-modal", eventId: "evt-002" },
    ["evt-001", "evt-002"],
    timeline.events,
  );
  assert.equal(event?.id, "evt-001");
  assert.equal(event?.type, "click");
});

test("T3.2: pickAnnotationEvent выбирает click, если других целей нет", () => {
  const event = pickAnnotationEvent(["evt-001"], timeline.events);
  assert.equal(event?.id, "evt-001");
  assert.equal(event?.target?.bbox?.w, 168);
});

test("T3.2: resolveStepAnnotation ставит bbox кнопки, если скрин привязан к click", () => {
  const annotation = resolveStepAnnotation({
    eventIds: ["evt-001", "evt-002"],
    screenshotId: "scr-001",
    events: timeline.events,
    screenshots: timeline.screenshots,
  });

  assert.ok(annotation);
  assert.equal(annotation.enabled, true);
  assert.deepEqual(annotation.bbox, { x: 1120, y: 84, w: 168, h: 40 });
  assert.equal(annotation.coordinateSpace, "screenshotPixels");
  assert.equal(annotation.confidence, "inferred");
});

test("T3.2: HiDPI fixture — measured materialized bbox на кнопке справа", () => {
  const screenshot = hidpiTimeline.screenshots[0];
  const annotation = resolveStepAnnotation({
    eventIds: ["evt-001"],
    screenshotId: screenshot.id,
    events: hidpiTimeline.events,
    screenshots: hidpiTimeline.screenshots,
  });

  assert.ok(annotation);
  assert.equal(annotation.confidence, "measured");
  assert.deepEqual(annotation.bbox, { x: 2240, y: 168, w: 320, h: 80 });
  assert.notDeepEqual(annotation.bbox, hidpiTimeline.events[0].target.bbox);
});

test("T3.2: resolveStepAnnotation ставит bbox кнопки для одиночного click", () => {
  const annotation = resolveStepAnnotation({
    eventIds: ["evt-001"],
    screenshotId: "scr-001",
    events: timeline.events,
    screenshots: timeline.screenshots,
  });

  assert.ok(annotation);
  assert.deepEqual(annotation.bbox, { x: 1120, y: 84, w: 168, h: 40 });
  assert.equal(annotation.coordinateSpace, "screenshotPixels");
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

test("T3.2: scaleBBoxToDisplay учитывает object-fit contain (letterbox)", () => {
  const display = scaleBBoxToDisplay(
    { x: 1000, y: 500, w: 200, h: 40 },
    2560,
    1440,
    960,
    360,
  );

  assert.equal(display.x, 250);
  assert.equal(display.y, 125);
  assert.equal(display.w, 50);
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
