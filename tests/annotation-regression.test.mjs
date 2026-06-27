import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  resolveDecorationLayout,
  resolveDecorationLayoutForPoint,
  screenshotBBoxToDisplay,
  validateBBoxInImage,
} from "../shared/annotation-geometry.mjs";
import {
  resolveStepAnnotation,
  screenshotAnnotationToDisplayLayer,
} from "../shared/annotation-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const matrix = JSON.parse(
  readFileSync(join(root, "fixtures/annotation-matrix.json"), "utf8"),
);
const hidpiTimeline = JSON.parse(
  readFileSync(join(root, "fixtures/timeline.hidpi-scrolled.json"), "utf8"),
);
const wmsTimeline = JSON.parse(
  readFileSync(join(root, "fixtures/timeline.wms-table-clicks.json"), "utf8"),
);

/** @param {Record<string, unknown>} caseRow */
function screenshotFromCase(caseRow) {
  if (caseRow.legacyViewportOnly) {
    return {
      id: "s-reg",
      width: caseRow.image.width,
      height: caseRow.image.height,
      viewportWidth: caseRow.viewport.width,
      viewportHeight: caseRow.viewport.height,
    };
  }

  return {
    id: "s-reg",
    width: caseRow.image.width,
    height: caseRow.image.height,
    captureContext: {
      viewportWidth: caseRow.viewport.width,
      viewportHeight: caseRow.viewport.height,
      devicePixelRatio: caseRow.devicePixelRatio ?? 1,
      scrollY: caseRow.scrollY ?? 0,
    },
  };
}

/** @param {Record<string, unknown>} caseRow */
function runRegressionPipeline(caseRow) {
  const screenshot = screenshotFromCase(caseRow);

  let bbox;
  let annotation = null;

  if (caseRow.screenshotBbox) {
    bbox = caseRow.screenshotBbox;
  } else {
    const event = {
      id: "evt-reg",
      type: "click",
      target: { bbox: caseRow.viewportBbox },
    };
    annotation = resolveStepAnnotation({
      eventIds: ["evt-reg"],
      screenshotId: screenshot.id,
      events: [event],
      screenshots: [screenshot],
    });
    assert.ok(annotation, `${caseRow.id}: annotation must resolve`);
    bbox = annotation.bbox;
  }

  const validation = validateBBoxInImage(
    bbox,
    screenshot.width,
    screenshot.height,
  );
  const decoration = resolveDecorationLayout(bbox, 1, {
    width: screenshot.width,
    height: screenshot.height,
  });

  const display = caseRow.display
    ? screenshotBBoxToDisplay(bbox, screenshot, caseRow.display)
    : null;

  return { annotation, validation, decoration, display, screenshot, bbox };
}

for (const caseRow of matrix.cases.filter(
  (row) => row.regression && !row.wmsFixture,
)) {
  test(`regression pipeline: ${caseRow.id}`, () => {
    const { annotation, validation, decoration, display, screenshot } =
      runRegressionPipeline(caseRow);

    if (caseRow.expectValidateOk === false) {
      assert.equal(annotation?.confidence, "inferred");
      const rawScaled = {
        x: caseRow.viewportBbox.x * 2,
        y: caseRow.viewportBbox.y * 2,
        w: caseRow.viewportBbox.w * 2,
        h: caseRow.viewportBbox.h * 2,
      };
      assert.equal(
        validateBBoxInImage(rawScaled, screenshot.width, screenshot.height).ok,
        false,
      );
      return;
    }

    assert.equal(validation.ok, true, `${caseRow.id}: bbox must be in image`);
    assert.equal(decoration.clamped, false, `${caseRow.id}: decoration clamped`);

    if (caseRow.expectedResolvedBbox) {
      for (const key of ["x", "y", "w", "h"]) {
        assert.equal(
          annotation.bbox[key],
          caseRow.expectedResolvedBbox[key],
          `${caseRow.id}.${key}`,
        );
      }
    } else if (caseRow.expectedScreenshotBbox) {
      for (const key of ["x", "y", "w", "h"]) {
        assert.equal(
          annotation.bbox[key],
          caseRow.expectedScreenshotBbox[key],
          `${caseRow.id}.${key}`,
        );
      }
    }

    if (display) {
      assert.ok(display.rect.x >= 0, `${caseRow.id}: not on left letterbox`);
      if (caseRow.displayMinRatioX != null) {
        assert.ok(
          display.rect.x > display.renderSize.width * caseRow.displayMinRatioX,
          `${caseRow.id}: highlight too far left (prod drift)`,
        );
      }
    }

    if (caseRow.expectBadgeInsideHighlight) {
      assert.ok(
        decoration.badge.y >= decoration.highlight.y,
        `${caseRow.id}: badge fallback inside highlight`,
      );
    }
  });
}

test("regression: modal-click picks pointer event bbox, not dialog", () => {
  const annotation = resolveStepAnnotation({
    eventIds: ["evt-001", "evt-002"],
    screenshotId: "scr-modal",
    events: hidpiTimeline.events,
    screenshots: [
      {
        id: "scr-modal",
        eventId: "evt-002",
        width: 2560,
        height: 1440,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
    ],
  });

  assert.ok(annotation);
  assert.notDeepEqual(annotation.bbox, hidpiTimeline.events[1].target.bbox);
  assert.deepEqual(annotation.bbox, { x: 2240, y: 168, w: 320, h: 80 });
});

test("regression: manual-override — saved annotation never overwritten", () => {
  const saved = {
    enabled: true,
    bbox: { x: 99, y: 88, w: 77, h: 66 },
    coordinateSpace: "screenshotPixels",
    confidence: "manual",
  };
  const result = resolveStepAnnotation({
    eventIds: ["evt-reg"],
    screenshotId: "s1",
    events: [{ id: "evt-reg", type: "click", target: { bbox: { x: 1, y: 2, w: 3, h: 4 } } }],
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

  assert.deepEqual(result, saved);
});

test("regression: hidpi fixture materialized bbox is measured", () => {
  const screenshot = hidpiTimeline.screenshots[0];
  const annotation = resolveStepAnnotation({
    eventIds: ["evt-001"],
    screenshotId: screenshot.id,
    events: hidpiTimeline.events,
    screenshots: hidpiTimeline.screenshots,
  });

  assert.ok(annotation);
  assert.equal(annotation.confidence, "measured");
  assert.deepEqual(annotation.bbox, screenshot.materializedBbox);
});

test("regression pipeline: wms-two-rows-click-point (WMS fixture)", () => {
  const caseRow = matrix.cases.find((row) => row.id === "wms-two-rows-click-point");
  assert.ok(caseRow?.wmsFixture);

  const [closeEvent, openEvent] = wmsTimeline.events;
  const [closeShot, openShot] = wmsTimeline.screenshots;

  const closeAnnotation = resolveStepAnnotation({
    eventIds: [closeEvent.id],
    screenshotId: closeShot.id,
    events: wmsTimeline.events,
    screenshots: wmsTimeline.screenshots,
  });
  const openAnnotation = resolveStepAnnotation({
    eventIds: [openEvent.id],
    screenshotId: openShot.id,
    events: wmsTimeline.events,
    screenshots: wmsTimeline.screenshots,
  });

  assert.ok(closeAnnotation);
  assert.ok(openAnnotation);
  assert.equal(closeAnnotation.annotationMode, "clickPoint");
  assert.equal(openAnnotation.annotationMode, "clickPoint");

  const closeCenter = {
    x: closeAnnotation.bbox.x + closeAnnotation.bbox.w / 2,
    y: closeAnnotation.bbox.y + closeAnnotation.bbox.h / 2,
  };
  const openCenter = {
    x: openAnnotation.bbox.x + openAnnotation.bbox.w / 2,
    y: openAnnotation.bbox.y + openAnnotation.bbox.h / 2,
  };

  assert.deepEqual(closeCenter, caseRow.row1MaterializedClickPoint);
  assert.deepEqual(openCenter, caseRow.row2MaterializedClickPoint);
  assert.ok(
    Math.hypot(openCenter.x - closeCenter.x, openCenter.y - closeCenter.y) >
      caseRow.minPointDistancePx,
  );

  const openLayer = screenshotAnnotationToDisplayLayer(
    openAnnotation,
    openShot,
    caseRow.display,
    2,
  );
  const minArrowX = openLayer.renderSize.width * caseRow.rightClickMinArrowRatioX;
  assert.ok(openLayer.decoration.arrow.to.x >= minArrowX);

  const openPointLayout = resolveDecorationLayoutForPoint(
    openCenter,
    2,
    { width: openShot.width, height: openShot.height },
  );
  assert.equal(openPointLayout.clamped, false);
  assert.ok(openPointLayout.arrow.to.x >= openShot.width * 0.5);

  const closeRectLayout = resolveDecorationLayout(
    closeAnnotation.bbox,
    1,
    { width: closeShot.width, height: closeShot.height },
  );
  assert.equal(closeRectLayout.clamped, false);
  assert.ok(
    validateBBoxInImage(closeAnnotation.bbox, closeShot.width, closeShot.height)
      .ok,
  );
});
