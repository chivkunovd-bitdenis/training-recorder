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

export interface Screenshot {
  id: string;
  ts: number;
  eventId: string | null;
  confidence: ScreenshotConfidence;
  width: number;
  height: number;
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

export interface ScreenshotAnnotation {
  enabled: boolean;
  bbox: BoundingBox;
  showArrow?: boolean;
  showStepNumber?: boolean;
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
