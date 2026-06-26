import type {
  BoundingBox,
  DocStep,
  RecEvent,
  Screenshot,
  ScreenshotAnnotation,
  Timeline,
} from "./types";
import {
  resolveStepAnnotation,
  scaleBBoxToDisplay,
  scaleBBoxToNatural,
} from "../../shared/annotation-utils.mjs";

export type {
  BoundingBox,
  RecEvent,
  Screenshot,
  ScreenshotAnnotation,
  Timeline,
};

export {
  resolveStepAnnotation,
  scaleBBoxToDisplay,
  scaleBBoxToNatural,
};

export function getScreenshotMeta(
  timeline: Timeline | null,
  screenshotId: string | null,
): Screenshot | null {
  if (!timeline || !screenshotId) {
    return null;
  }
  return timeline.screenshots.find((shot) => shot.id === screenshotId) ?? null;
}

export function resolveAnnotationForStep(
  step: DocStep,
  timeline: Timeline | null,
): ScreenshotAnnotation | null {
  if (!timeline) {
    return step.screenshotAnnotation ?? null;
  }
  return resolveStepAnnotation({
    eventIds: step.eventIds,
    screenshotId: step.screenshotId,
    events: timeline.events,
    screenshots: timeline.screenshots,
    existing: step.screenshotAnnotation ?? null,
  });
}

export function clampBBoxToImage(
  bbox: BoundingBox,
  width: number,
  height: number,
): BoundingBox {
  const x = Math.max(0, Math.min(bbox.x, width - 1));
  const y = Math.max(0, Math.min(bbox.y, height - 1));
  const w = Math.max(8, Math.min(bbox.w, width - x));
  const h = Math.max(8, Math.min(bbox.h, height - y));
  return { x, y, w, h };
}
