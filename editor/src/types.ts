export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RecEvent {
  id: string;
  type: string;
  target?: {
    bbox?: BoundingBox;
  } | null;
}

export interface Screenshot {
  id: string;
  width: number;
  height: number;
}

export interface ScreenshotAnnotation {
  enabled: boolean;
  bbox: BoundingBox;
  showArrow?: boolean;
  showStepNumber?: boolean;
}

export interface DocStep {
  id: string;
  title: string;
  body: string;
  screenshotId: string | null;
  eventIds: string[];
  needsReview: boolean;
  screenshotCandidates?: string[];
  screenshotAnnotation?: ScreenshotAnnotation;
}

export interface GeneratedDoc {
  title: string;
  purpose: string;
  audience: string;
  prerequisites: string;
  steps: DocStep[];
  warnings: string[];
  result: string;
}

export interface Timeline {
  events: RecEvent[];
  screenshots: Screenshot[];
}
