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
    /** @type {ImageCapture | null} */
    this.imageCapture = null;
  }

  /**
   * @param {MediaStream} stream
   * @param {number} t0
   */
  attach(stream, t0) {
    this.t0 = t0;
    this.video.srcObject = stream;
    void this.video.play();

    const track = stream.getVideoTracks?.()[0];
    this.imageCapture = null;
    if (track && typeof ImageCapture !== "undefined") {
      try {
        this.imageCapture = new ImageCapture(track);
      } catch {
        this.imageCapture = null;
      }
    }

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
    this.imageCapture = null;
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

  /**
   * @returns {Promise<Blob | null>}
   */
  canvasToBlob() {
    return new Promise((resolve) => {
      this.canvas.toBlob(
        (blob) => resolve(blob),
        CONFIG.CAPTURE_MIME_TYPE,
        CONFIG.CAPTURE_JPEG_QUALITY,
      );
    });
  }

  /**
   * ImageCapture.grabFrame() даёт нативный кадр трека без артефактов декодера <video>.
   * @returns {Promise<{ width: number; height: number; blob: Blob } | null>}
   */
  async captureFrameBitmap() {
    if (this.imageCapture) {
      try {
        const bitmap = await this.imageCapture.grabFrame();
        const width = bitmap.width;
        const height = bitmap.height;
        this.canvas.width = width;
        this.canvas.height = height;
        const ctx = this.canvas.getContext("2d");
        if (!ctx) {
          bitmap.close();
          return null;
        }
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        const blob = await this.canvasToBlob();
        return blob ? { width, height, blob } : null;
      } catch {
        // fallback — video + canvas
      }
    }

    if (!this.video.videoWidth || !this.video.videoHeight) {
      return null;
    }

    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.drawImage(this.video, 0, 0, width, height);

    const blob = await this.canvasToBlob();
    return blob ? { width, height, blob } : null;
  }

  async captureCurrentFrame() {
    const frame = await this.captureFrameBitmap();
    return frame?.blob ?? null;
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
  /**
   * Один кадр на клик — без triplet loop (T-CLK-3).
   * @param {{ recordingId: string; eventId: string; ts: number; confidence: "high" | "low"; delayMs?: number }} params
   */
  async captureSingleFrame({
    recordingId,
    eventId,
    ts,
    confidence,
    delayMs = CONFIG.IMMEDIATE_CAPTURE_DELAY_MS,
  }) {
    const mainId = `scr-${recordingId}-${eventId}-0`;

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    let captured = await this.captureFrameBitmap();
    if (!captured && CONFIG.IMMEDIATE_CAPTURE_FALLBACK_MS > 0) {
      await sleep(CONFIG.IMMEDIATE_CAPTURE_FALLBACK_MS);
      captured = await this.captureFrameBitmap();
    }

    if (!captured) {
      return {
        main: { id: mainId, candidates: [] },
        screenshots: [],
      };
    }

    const screenshot = {
      id: mainId,
      ts,
      eventId,
      confidence,
      width: captured.width,
      height: captured.height,
      blob: captured.blob,
      isMain: true,
      candidates: [],
    };

    return {
      main: screenshot,
      screenshots: [screenshot],
    };
  }

  async captureTriplet({ recordingId, eventId, ts, confidence }) {
    const offsets = CONFIG.FRAME_OFFSETS_MS;
    /** @type {{ blob: Blob; width: number; height: number }[]} */
    const frames = [];

    for (const offset of offsets) {
      if (offset < 0) {
        const buffered = this.findBufferedFrame(ts + offset);
        if (buffered) {
          frames.push({
            blob: buffered,
            width: this.canvas.width,
            height: this.canvas.height,
          });
        } else {
          const captured = await this.captureFrameBitmap();
          if (captured) {
            frames.push(captured);
          }
        }
      } else if (offset > 0) {
        await sleep(offset);
        const captured = await this.captureFrameBitmap();
        if (captured) {
          frames.push(captured);
        }
      } else {
        const captured = await this.captureFrameBitmap();
        if (captured) {
          frames.push(captured);
        }
      }
    }

    const screenshotIds = offsets.map(
      (_offset, index) => `scr-${recordingId}-${eventId}-${index}`,
    );
    const mainIndex = 1;

    const screenshots = frames.map((frame, index) => ({
      id: screenshotIds[index],
      ts: ts + offsets[index],
      eventId: index === mainIndex ? eventId : null,
      confidence,
      width: frame.width,
      height: frame.height,
      blob: frame.blob,
      isMain: index === mainIndex,
    }));

    const main = screenshots[mainIndex];
    if (!main) {
      return {
        main: { id: screenshotIds[mainIndex], candidates: [] },
        screenshots,
      };
    }

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
