import { STABILIZER_CONFIG as CONFIG } from "./stabilizer-config.js";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class FrameCapture {
  constructor() {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.canvas = document.createElement("canvas");
    /** @type {{ ts: number; blob: Blob }[]} */
    this.buffer = [];
    /** @type {number | null} */
    this.t0 = null;
    /** @type {number | null} */
    this.bufferTimer = null;
  }

  /**
   * @param {MediaStream} stream
   * @param {number} t0
   */
  attach(stream, t0) {
    this.t0 = t0;
    this.video.srcObject = stream;
    void this.video.play();
    this.bufferTimer = window.setInterval(() => {
      void this.pushBufferSnapshot();
    }, CONFIG.BUFFER_INTERVAL);
  }

  detach() {
    if (this.bufferTimer != null) {
      clearInterval(this.bufferTimer);
      this.bufferTimer = null;
    }
    this.video.pause();
    this.video.srcObject = null;
    this.buffer = [];
    this.t0 = null;
  }

  async pushBufferSnapshot() {
    if (this.t0 == null) {
      return;
    }
    const blob = await this.captureCurrentFrame();
    if (!blob) {
      return;
    }
    this.buffer.push({ ts: Date.now() - this.t0, blob });
    if (this.buffer.length > CONFIG.BUFFER_MAX_FRAMES) {
      this.buffer.shift();
    }
  }

  async captureCurrentFrame() {
    if (!this.video.videoWidth || !this.video.videoHeight) {
      return null;
    }

    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

    return new Promise((resolve) => {
      this.canvas.toBlob(
        (blob) => resolve(blob),
        "image/jpeg",
        0.85,
      );
    });
  }

  /**
   * @param {number} targetTs
   */
  findBufferedFrame(targetTs) {
    if (this.buffer.length === 0) {
      return null;
    }

    let best = this.buffer[0];
    let bestDistance = Math.abs(best.ts - targetTs);
    for (const frame of this.buffer) {
      const distance = Math.abs(frame.ts - targetTs);
      if (distance < bestDistance) {
        best = frame;
        bestDistance = distance;
      }
    }
    return best.blob;
  }

  /**
   * @param {{ recordingId: string; eventId: string; ts: number; confidence: "high" | "low" }} params
   */
  async captureTriplet({ recordingId, eventId, ts, confidence }) {
    const offsets = CONFIG.FRAME_OFFSETS_MS;
    const blobs = [];

    for (const offset of offsets) {
      if (offset < 0) {
        const buffered = this.findBufferedFrame(ts + offset);
        blobs.push(buffered ?? (await this.captureCurrentFrame()));
      } else if (offset > 0) {
        await sleep(offset);
        blobs.push(await this.captureCurrentFrame());
      } else {
        blobs.push(await this.captureCurrentFrame());
      }
    }

    const screenshotIds = offsets.map(
      (_offset, index) => `scr-${recordingId}-${eventId}-${index}`,
    );
    const mainIndex = 1;

    const screenshots = blobs.map((blob, index) => ({
      id: screenshotIds[index],
      ts: ts + offsets[index],
      eventId: index === mainIndex ? eventId : null,
      confidence,
      width: this.canvas.width,
      height: this.canvas.height,
      blob,
      isMain: index === mainIndex,
    }));

    const main = screenshots[mainIndex];
    main.eventId = eventId;
    main.candidates = screenshotIds.filter((id) => id !== main.id);

    return {
      main,
      screenshots,
    };
  }
}

/**
 * @param {{ ts: number; blob: Blob | null }[]} frames
 * @param {number} targetTs
 */
export function findClosestFrame(frames, targetTs) {
  if (frames.length === 0) {
    return null;
  }
  let best = frames[0];
  let bestDistance = Math.abs(best.ts - targetTs);
  for (const frame of frames) {
    const distance = Math.abs(frame.ts - targetTs);
    if (distance < bestDistance) {
      best = frame;
      bestDistance = distance;
    }
  }
  return best;
}
