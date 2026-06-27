import { blobToBase64 } from "./blob-utils.js";
import { FrameCapture } from "./frame-capture.js";
import {
  createRecordingMeta,
  finalizeRecordingMeta,
  withTrackStartOffsets,
} from "./recording-meta.js";

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

export class RecordingEngine {
  constructor() {
    /** @type {MediaRecorder | null} */
    this.videoRecorder = null;
    /** @type {MediaRecorder | null} */
    this.micRecorder = null;
    /** @type {BlobPart[]} */
    this.videoChunks = [];
    /** @type {BlobPart[]} */
    this.micChunks = [];
    /** @type {ReturnType<typeof createRecordingMeta> | null} */
    this.activeMeta = null;
    /** @type {MediaStream | null} */
    this.videoStream = null;
    /** @type {MediaStream | null} */
    this.micStream = null;
    /** @type {string | null} */
    this.activeDisplaySurface = null;
    this.frameCapture = new FrameCapture();
  }

  get isRecording() {
    return (
      this.videoRecorder?.state === "recording" ||
      this.micRecorder?.state === "recording"
    );
  }

  /**
   * @param {{
   *   recordingId: string;
   *   url: string;
   *   title: string;
   *   keepVideo: boolean;
   *   displayStream: MediaStream;
   *   micStream: MediaStream;
   * }} params
   */
  async startFromStreams(params) {
    if (this.isRecording) {
      throw new Error("Запись уже идёт");
    }

    const t0 = Date.now();
    let meta = createRecordingMeta({
      recordingId: params.recordingId,
      url: params.url,
      title: params.title,
      t0,
      userAgent: navigator.userAgent,
    });

    const videoTrack = params.displayStream.getVideoTracks?.()[0];
    this.activeDisplaySurface = videoTrack?.getSettings?.().displaySurface ?? "browser";

    this.videoStream = params.displayStream;
    this.micStream = params.micStream;
    this.frameCapture.attach(params.displayStream, t0);

    this.videoChunks = [];
    this.micChunks = [];

    const audioMimeType = pickAudioMimeType();
    this.micRecorder = createRecorder(this.micStream, audioMimeType);
    attachChunkCollector(this.micRecorder, this.micChunks);

    let videoStartOffsetMs = 0;
    if (params.keepVideo) {
      const videoMimeType = pickVideoMimeType();
      this.videoRecorder = createRecorder(this.videoStream, videoMimeType);
      attachChunkCollector(this.videoRecorder, this.videoChunks);
      videoStartOffsetMs = Date.now() - t0;
      this.videoRecorder.start(1000);
    } else {
      this.videoRecorder = null;
    }

    const micStartOffsetMs = Date.now() - t0;
    this.micRecorder.start(1000);

    meta = withTrackStartOffsets(meta, { videoStartOffsetMs, micStartOffsetMs });
    this.activeMeta = meta;

    return {
      t0,
      displaySurface: this.activeDisplaySurface,
    };
  }

  async captureFrames(payload) {
    if (!this.activeMeta) {
      throw new Error("Запись не активна");
    }

    const result = payload.immediate
      ? await this.frameCapture.captureSingleFrame({
          recordingId: this.activeMeta.recordingId,
          eventId: payload.eventId,
          ts: payload.ts,
          confidence: payload.confidence,
        })
      : await this.frameCapture.captureTriplet({
          recordingId: this.activeMeta.recordingId,
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

    return {
      ok: true,
      screenshots,
      mainScreenshotId: result.main.id,
    };
  }

  async stop() {
    if (!this.micRecorder || !this.activeMeta) {
      throw new Error("Запись не была начата");
    }

    const t0 = this.activeMeta.t0;
    const recorderVideo = this.videoRecorder;
    const recorderMic = this.micRecorder;
    const metaDraft = this.activeMeta;
    const streamVideo = this.videoStream;
    const streamMic = this.micStream;
    const chunksVideo = this.videoChunks;
    const chunksMic = this.micChunks;

    this.frameCapture.detach();

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

    this.videoRecorder = null;
    this.micRecorder = null;
    this.activeMeta = null;
    this.videoStream = null;
    this.micStream = null;
    this.videoChunks = [];
    this.micChunks = [];

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
}
