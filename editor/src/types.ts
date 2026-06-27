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
  viewportWidth?: number;
  viewportHeight?: number;
  captureContext?: {
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
    scrollX?: number;
    scrollY?: number;
    visualViewportScale?: number;
  };
  materializedBbox?: BoundingBox;
  materializedClickPoint?: { x: number; y: number };
  annotationConfidence?: "measured" | "invalid";
  eventId?: string | null;
}

export type AnnotationCoordinateSpace = "screenshotPixels";
export type AnnotationConfidence = "measured" | "inferred" | "manual";
export type AnnotationMode = "elementRect" | "clickPoint";

export interface ScreenshotAnnotation {
  enabled: boolean;
  bbox: BoundingBox;
  coordinateSpace?: AnnotationCoordinateSpace;
  confidence?: AnnotationConfidence;
  materializedFromEventId?: string;
  annotationMode?: AnnotationMode;
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
