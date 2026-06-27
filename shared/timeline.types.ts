/**
 * Единый контракт таймлайна Training Recorder.
 * Всё время — миллисекунды от t0 (момент старта записи).
 */

export interface RecordingMeta {
  recordingId: string;
  t0: number;
  url: string;
  title: string;
  durationMs: number;
  userAgent: string;
  /** Смещение старта видео относительно t0, мс */
  videoStartOffsetMs: number;
  /** Смещение старта микрофона относительно t0, мс */
  micStartOffsetMs: number;
  /** Длительность видеодорожки, мс */
  videoDurationMs: number;
  /** Длительность микрофона, мс */
  micDurationMs: number;
}

export type EventType =
  | "click"
  | "input"
  | "submit"
  | "navigation"
  | "modal_open"
  | "menu_select"
  | "focus"
  | "keypress_enter";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Координаты точки: viewport CSS (clientX/clientY) или пиксели bitmap. */
export interface ClickPoint {
  x: number;
  y: number;
}

export interface ElementContext {
  role: string | null;
  text: string | null;
  placeholder: string | null;
  label: string | null;
  nearbyText: string | null;
  tag: string;
  cssPath: string;
  bbox: BoundingBox;
  masked: boolean;
  /** Точка клика в viewport CSS (MouseEvent.clientX/clientY). */
  clickPoint?: ClickPoint;
}

export interface RecEvent {
  id: string;
  type: EventType;
  ts: number;
  url: string;
  target: ElementContext | null;
  value?: string | null;
}

export type ScreenshotConfidence = "high" | "low";

/** Паспорт кадра: viewport CSS → пиксели bitmap скриншота. */
export interface CaptureContext {
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  scrollX?: number;
  scrollY?: number;
  visualViewportScale?: number;
}

export interface Screenshot {
  id: string;
  ts: number;
  eventId: string | null;
  confidence: ScreenshotConfidence;
  width: number;
  height: number;
  /** @deprecated Prefer captureContext; kept for backward compatibility. */
  viewportWidth?: number;
  /** @deprecated Prefer captureContext; kept for backward compatibility. */
  viewportHeight?: number;
  captureContext?: CaptureContext;
  /** Bbox целевого элемента в пикселях скриншота, materialize при захвате. */
  materializedBbox?: BoundingBox;
  /** Точка клика в пикселях bitmap (после transform на захвате). */
  materializedClickPoint?: ClickPoint;
  /** Уверенность materialize bbox на захвате. */
  annotationConfidence?: "measured" | "invalid";
  candidates?: string[];
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
}

export type AnnotationCoordinateSpace = "screenshotPixels";

export type AnnotationConfidence = "measured" | "inferred" | "manual";

/** Режим подсветки: прямоугольник элемента или точка клика. */
export type AnnotationMode = "elementRect" | "clickPoint";

export interface ScreenshotAnnotation {
  enabled: boolean;
  bbox: BoundingBox;
  /** Единственная система координат для рендера аннотаций. */
  coordinateSpace?: AnnotationCoordinateSpace;
  confidence?: AnnotationConfidence;
  /** Audit trail: из какого события materialize bbox. */
  materializedFromEventId?: string;
  showArrow?: boolean;
  showStepNumber?: boolean;
  /** Default для новых записей: clickPoint; старые без поля → elementRect. */
  annotationMode?: AnnotationMode;
}

export interface Step {
  id: string;
  title: string;
  body: string;
  screenshotId: string | null;
  eventIds: string[];
  needsReview: boolean;
  /** Альтернативные кадры для редактора (T2.5 screenshot_match). */
  screenshotCandidates?: string[];
  /** Подсветка целевого элемента на скрине (T3.2). */
  screenshotAnnotation?: ScreenshotAnnotation;
}

export interface GeneratedDoc {
  title: string;
  purpose: string;
  audience: string;
  prerequisites: string;
  steps: Step[];
  warnings: string[];
  result: string;
}

/** Артефакт расширения / вход бэкенда до обработки. */
export interface Timeline {
  meta: RecordingMeta;
  events: RecEvent[];
  screenshots: Screenshot[];
  transcript?: TranscriptSegment[];
  generatedDoc?: GeneratedDoc;
}
