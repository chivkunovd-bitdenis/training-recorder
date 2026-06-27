/** @readonly */
export const STABILIZER_CONFIG = {
  QUIET_WINDOW: 400,
  MAX_WAIT: 8000,
  LAYOUT_SAMPLE: 150,
  FRAME_OFFSETS_MS: [-120, 0, 120],
  CHECK_INTERVAL: 50,
  BUFFER_INTERVAL: 100,
  BUFFER_MAX_FRAMES: 30,
  /** JPEG для UI-текста: 0.85 давало «мыло» на мелком шрифте. */
  CAPTURE_JPEG_QUALITY: 0.95,
  CAPTURE_MIME_TYPE: "image/jpeg",
  /** Запрашиваем у tabCapture максимум — иначе поток часто ниже HiDPI-экрана. */
  CAPTURE_MAX_WIDTH: 3840,
  CAPTURE_MAX_HEIGHT: 2160,
  /** Задержка перед immediate capture (0 = сразу на клик). */
  IMMEDIATE_CAPTURE_DELAY_MS: 0,
  /** Fallback-кадр, если первый immediate blob null. */
  IMMEDIATE_CAPTURE_FALLBACK_MS: 50,
};
