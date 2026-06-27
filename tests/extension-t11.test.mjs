import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { recordingTracksAligned } from "../extension/lib/duration.js";
import {
  createRecordingMeta,
  finalizeRecordingMeta,
  withTrackStartOffsets,
} from "../extension/lib/recording-meta.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const serviceWorkerSource = readFileSync(
  join(root, "extension/service-worker.js"),
  "utf8",
);
const timelineSchema = JSON.parse(
  readFileSync(join(root, "shared/timeline.schema.json"), "utf8"),
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateMeta = ajv.compile(timelineSchema.$defs.RecordingMeta);

test("T1.1: устойчивый workflow, overlay и pipeline", () => {
  const workflowSource = readFileSync(
    join(root, "extension/lib/workflow-state.js"),
    "utf8",
  );
  const overlaySource = readFileSync(
    join(root, "extension/content/overlay.js"),
    "utf8",
  );
  const pipelineSource = readFileSync(
    join(root, "extension/lib/process-pipeline.js"),
    "utf8",
  );
  assert.match(workflowSource, /trWorkflow/);
  assert.match(overlaySource, /STOP_AND_PROCESS/);
  assert.match(pipelineSource, /runFullPipeline/);
  assert.match(serviceWorkerSource, /tabCapture\.getMediaStreamId/);
  assert.match(serviceWorkerSource, /stopAndProcess/);
});

test("T1.1: popup восстанавливает workflow из storage", () => {
  const popupSource = readFileSync(join(root, "extension/popup/popup.js"), "utf8");
  assert.match(popupSource, /renderWorkflow/);
  assert.match(popupSource, /trWorkflow/);
  assert.match(popupSource, /STOP_AND_PROCESS/);
});

test("T1.1: meta фиксирует смещения старта и длительности дорожек", () => {
  const t0 = 1_719_403_200_000;
  const meta = withTrackStartOffsets(
    createRecordingMeta({
      recordingId: "rec-test",
      url: "https://example.com",
      title: "Example",
      t0,
      userAgent: "test-agent",
    }),
    { videoStartOffsetMs: 12, micStartOffsetMs: 24 },
  );

  const finalized = finalizeRecordingMeta(meta, t0 + 10_000, {
    videoEndOffsetMs: 9_990,
    micEndOffsetMs: 9_980,
  });

  assert.equal(finalized.videoStartOffsetMs, 12);
  assert.equal(finalized.micStartOffsetMs, 24);
  assert.equal(finalized.videoDurationMs, 9_978);
  assert.equal(finalized.micDurationMs, 9_956);
  assert.ok(recordingTracksAligned(finalized));

  const valid = validateMeta(finalized);
  if (!valid) {
    assert.fail(
      `RecordingMeta не прошёл схему: ${JSON.stringify(validateMeta.errors, null, 2)}`,
    );
  }
});

test("T1.1: допуск ±300мс между длительностями дорожек", () => {
  assert.ok(recordingTracksAligned({ videoDurationMs: 5000, micDurationMs: 4800 }));
  assert.ok(recordingTracksAligned({ videoDurationMs: 5000, micDurationMs: 4700 }));
  assert.ok(!recordingTracksAligned({ videoDurationMs: 5000, micDurationMs: 4600 }));
});
