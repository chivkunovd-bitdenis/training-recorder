import { MSG } from "./lib/messages.js";
import { blobToBase64 } from "./lib/blob-utils.js";
import { FrameCapture } from "./lib/frame-capture.js";
import { STABILIZER_CONFIG } from "./lib/stabilizer-config.js";
import {
  createRecordingMeta,
  finalizeRecordingMeta,
  withTrackStartOffsets,
} from "./lib/recording-meta.js";

/** @type {MediaRecorder | null} */
let videoRecorder = null;
/** @type {MediaRecorder | null} */
let micRecorder = null;
/** @type {BlobPart[]} */
let videoChunks = [];
/** @type {BlobPart[]} */
let micChunks = [];
/** @type {ReturnType<typeof createRecordingMeta> | null} */
let activeMeta = null;
/** @type {MediaStream | null} */
let videoStream = null;
/** @type {MediaStream | null} */
let micStream = null;
/** @type {string | null} */
let activeDisplaySurface = null;
const frameCapture = new FrameCapture();

function pickVideoMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function pickAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function createRecorder(stream, mimeType) {
  return mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
}

function attachChunkCollector(recorder, chunks) {
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };
}

/**
 * @param {MediaRecorder} recorder
 * @param {BlobPart[]} chunks
 * @param {string} fallbackType
 * @param {number} t0
 */
function stopMediaRecorder(recorder, chunks, fallbackType, t0) {
  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      const endOffsetMs = Date.now() - t0;
      const type = recorder.mimeType || fallbackType;
      resolve({
        blob: new Blob(chunks, { type }),
        endOffsetMs,
      });
    };
    recorder.onerror = () => {
      reject(new Error("MediaRecorder завершился с ошибкой"));
    };

    if (recorder.state === "inactive") {
      const endOffsetMs = Date.now() - t0;
      const type = recorder.mimeType || fallbackType;
      resolve({
        blob: new Blob(chunks, { type }),
        endOffsetMs,
      });
      return;
    }

    recorder.stop();
  });
}

function stopStream(stream) {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

async function acquireTabVideoStream(tabStreamId) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: tabStreamId,
        maxWidth: STABILIZER_CONFIG.CAPTURE_MAX_WIDTH,
        maxHeight: STABILIZER_CONFIG.CAPTURE_MAX_HEIGHT,
      },
    },
  });
}

async function acquireDisplayVideoStream() {
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
  });
}

async function startRecording(payload) {
  if (videoRecorder?.state === "recording" || micRecorder?.state === "recording") {
    throw new Error("Запись уже идёт");
  }

  const keepVideo = Boolean(payload.keepVideo);

  const displayStream = payload.tabStreamId
    ? await acquireTabVideoStream(payload.tabStreamId)
    : await acquireDisplayVideoStream();

  let audioStream;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || String(error).includes("Permission dismissed")) {
      throw new Error(
        "Микрофон не разрешён. Откройте расширение, нажмите «Запись» и выберите «Разрешить» в диалоге Chrome.",
      );
    }
    throw error instanceof Error ? error : new Error(String(error));
  }

  // t0 — после получения потоков (без пикера «что шарить» при tabCapture).
  const t0 = Date.now();
  let meta = createRecordingMeta({
    recordingId: payload.recordingId,
    url: payload.url,
    title: payload.title,
    t0,
    userAgent: navigator.userAgent,
  });

  const videoTrack = displayStream.getVideoTracks?.()[0];
  activeDisplaySurface = payload.tabStreamId
    ? "browser"
    : (videoTrack?.getSettings?.().displaySurface ?? null);

  videoStream = displayStream;
  micStream = audioStream;
  // Кадры для скринов берём из displayStream всегда, даже если видеофайл не пишем.
  frameCapture.attach(displayStream, t0);

  videoChunks = [];
  micChunks = [];

  const audioMimeType = pickAudioMimeType();
  micRecorder = createRecorder(micStream, audioMimeType);
  attachChunkCollector(micRecorder, micChunks);

  // Видеофайл — опционально (тяжёлый base64 через messaging). По умолчанию выкл:
  // для генерации инструкции нужны только аудио + скрины + таймлайн.
  let videoStartOffsetMs = 0;
  if (keepVideo) {
    const videoMimeType = pickVideoMimeType();
    videoRecorder = createRecorder(videoStream, videoMimeType);
    attachChunkCollector(videoRecorder, videoChunks);
    videoStartOffsetMs = Date.now() - t0;
    videoRecorder.start(1000);
  } else {
    videoRecorder = null;
  }

  const micStartOffsetMs = Date.now() - t0;
  micRecorder.start(1000);

  meta = withTrackStartOffsets(meta, { videoStartOffsetMs, micStartOffsetMs });
  activeMeta = meta;
}

async function captureFrames(payload) {
  if (!activeMeta) {
    throw new Error("Запись не активна");
  }

  const result = payload.immediate
    ? await frameCapture.captureSingleFrame({
        recordingId: activeMeta.recordingId,
        eventId: payload.eventId,
        ts: payload.ts,
        confidence: payload.confidence,
      })
    : await frameCapture.captureTriplet({
        recordingId: activeMeta.recordingId,
        eventId: payload.eventId,
        ts: payload.ts,
        confidence: payload.confidence,
      });

  const screenshots = [];
  for (const shot of result.screenshots) {
    if (!shot.blob) {
      continue;
    }
    screenshots.push({
      id: shot.id,
      ts: shot.ts,
      eventId: shot.isMain ? payload.eventId : null,
      confidence: payload.confidence,
      width: shot.width,
      height: shot.height,
      candidates: shot.isMain ? shot.candidates : undefined,
      imageBase64: await blobToBase64(shot.blob),
      byteLength: shot.blob.size,
    });
  }

  const effectiveConfidence =
    payload.immediate && screenshots.length === 0 ? "low" : payload.confidence;

  return {
    ok: true,
    screenshots: screenshots.map((shot) => ({
      ...shot,
      confidence: effectiveConfidence,
    })),
    mainScreenshotId: result.main.id,
  };
}

async function stopRecording() {
  if (!micRecorder || !activeMeta) {
    throw new Error("Запись не была начата");
  }

  const t0 = activeMeta.t0;
  const recorderVideo = videoRecorder;
  const recorderMic = micRecorder;
  const metaDraft = activeMeta;
  const streamVideo = videoStream;
  const streamMic = micStream;
  const chunksVideo = videoChunks;
  const chunksMic = micChunks;

  frameCapture.detach();

  const emptyVideo = { blob: new Blob([], { type: "video/webm" }), endOffsetMs: 0 };
  const [videoResult, micResult] = await Promise.all([
    recorderVideo
      ? stopMediaRecorder(recorderVideo, chunksVideo, "video/webm", t0)
      : Promise.resolve(emptyVideo),
    stopMediaRecorder(recorderMic, chunksMic, "audio/webm", t0),
  ]);

  stopStream(streamVideo);
  stopStream(streamMic);

  const endTime = Date.now();
  const finalizedMeta = finalizeRecordingMeta(metaDraft, endTime, {
    videoEndOffsetMs: videoResult.endOffsetMs,
    micEndOffsetMs: micResult.endOffsetMs,
  });

  videoRecorder = null;
  micRecorder = null;
  activeMeta = null;
  videoStream = null;
  micStream = null;
  videoChunks = [];
  micChunks = [];

  const micBase64 = await blobToBase64(micResult.blob);
  const videoBase64 = recorderVideo ? await blobToBase64(videoResult.blob) : null;

  return {
    ok: true,
    videoBase64,
    micBase64,
    videoByteLength: videoResult.blob.size,
    micByteLength: micResult.blob.size,
    meta: finalizedMeta,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target && message.target !== "offscreen") {
    return false;
  }
  if (message?.target !== "offscreen" && message.type?.startsWith("OFFSCREEN_")) {
    return false;
  }

  if (message.type === MSG.OFFSCREEN_PING) {
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === MSG.OFFSCREEN_START) {
    startRecording(message.payload)
      .then(() =>
        sendResponse({
          ok: true,
          t0: activeMeta?.t0 ?? null,
          displaySurface: activeDisplaySurface,
        }),
      )
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === MSG.OFFSCREEN_CAPTURE_FRAMES) {
    captureFrames(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === MSG.OFFSCREEN_STOP) {
    stopRecording()
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  return false;
});
