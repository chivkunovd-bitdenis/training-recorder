import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  createRecordingMeta,
  finalizeRecordingMeta,
  generateRecordingId,
} from "../extension/lib/recording-meta.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const extensionDir = join(root, "extension");

const manifest = JSON.parse(
  readFileSync(join(extensionDir, "manifest.json"), "utf8"),
);
const timelineSchema = JSON.parse(
  readFileSync(join(root, "shared/timeline.schema.json"), "utf8"),
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateMeta = ajv.compile(timelineSchema.$defs.RecordingMeta);

const REQUIRED_PERMISSIONS = [
  "offscreen",
  "activeTab",
  "scripting",
  "storage",
  "tabs",
];

const REQUIRED_FILES = [
  "manifest.json",
  "service-worker.js",
  "offscreen.html",
  "offscreen.js",
  "popup/popup.html",
  "popup/popup.js",
  "lib/messages.js",
  "lib/recording-meta.js",
  "lib/recording-artifacts.js",
  "content/bridge.js",
  "content/masking.js",
  "content/dom-context.js",
  "content/stabilizer.js",
  "content/net-hook.js",
  "content/content.js",
  "lib/stabilizer-config.js",
  "lib/frame-capture.js",
];

test("T0.2: manifest MV3 с нужными permissions и module service worker", () => {
  assert.equal(manifest.manifest_version, 3);
  for (const permission of REQUIRED_PERMISSIONS) {
    assert.ok(
      manifest.permissions.includes(permission),
      `missing permission: ${permission}`,
    );
  }
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.equal(manifest.background.service_worker, "service-worker.js");
  assert.equal(manifest.background.type, "module");
});

test("T0.2: все файлы каркаса расширения на месте", () => {
  for (const relativePath of REQUIRED_FILES) {
    const absolutePath = join(extensionDir, relativePath);
    assert.ok(existsSync(absolutePath), `missing file: ${relativePath}`);
  }
});

test("T0.2: RecordingMeta содержит t0 и проходит схему после finalize", () => {
  const t0 = 1_719_403_200_000;
  const meta = createRecordingMeta({
    recordingId: generateRecordingId(),
    url: "https://example.com",
    title: "Example",
    t0,
    userAgent: "test-agent",
  });

  assert.equal(meta.t0, t0);
  assert.equal(meta.durationMs, 0);

  const finalized = finalizeRecordingMeta(
    meta,
    t0 + 5_000,
    { videoEndOffsetMs: 4_980, micEndOffsetMs: 4_970 },
  );
  assert.equal(finalized.durationMs, 5_000);
  assert.equal(finalized.videoDurationMs, 4_980);
  assert.equal(finalized.micDurationMs, 4_970);

  const valid = validateMeta(finalized);
  if (!valid) {
    assert.fail(
      `RecordingMeta не прошёл схему: ${JSON.stringify(validateMeta.errors, null, 2)}`,
    );
  }
});

test("T0.2: generateRecordingId уникален", () => {
  const a = generateRecordingId();
  const b = generateRecordingId();
  assert.notEqual(a, b);
  assert.match(a, /^rec-/);
});
