globalThis.TrainingRecorderMSG = {
  CONTENT_START: "CONTENT_START",
  CONTENT_STOP: "CONTENT_STOP",
  CONTENT_GET_EVENTS: "CONTENT_GET_EVENTS",
  CAPTURE_FRAMES: "CAPTURE_FRAMES",
};

if (typeof window !== "undefined") {
  window.TrainingRecorderMSG = globalThis.TrainingRecorderMSG;
}
