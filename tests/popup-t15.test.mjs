import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  deleteAllRecordingArtifacts,
  deleteLocalRecording,
  deleteRemoteRecording,
  hasStoredRecording,
} from "../extension/lib/recording-artifacts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(__dirname, "..", "extension");

const popupHtml = readFileSync(
  join(extensionDir, "popup/popup.html"),
  "utf8",
);
const popupJs = readFileSync(join(extensionDir, "popup/popup.js"), "utf8");

function createMockStorage(initial = {}) {
  /** @type {Record<string, unknown>} */
  const local = { ...initial };

  return {
    local: {
      async get(keys) {
        if (typeof keys === "string") {
          return { [keys]: local[keys] };
        }
        const result = {};
        for (const key of keys) {
          result[key] = local[key];
        }
        return result;
      },
      async remove(keys) {
        const list = typeof keys === "string" ? [keys] : keys;
        for (const key of list) {
          delete local[key];
        }
      },
    },
    _local: local,
  };
}

test("T1.5: popup содержит экран согласия и чекбокс", () => {
  assert.match(popupHtml, /Перед записью/);
  assert.match(popupHtml, /видео активной вкладки/);
  assert.match(popupHtml, /OpenAI Whisper/);
  assert.match(popupHtml, /id="consentCheckbox"/);
  assert.match(popupHtml, /Я понимаю и согласен/);
  assert.match(popupHtml, /id="deleteBtn"/);
  assert.match(popupHtml, /Удалить запись и все артефакты/);
});

test("T1.5: без согласия старт заблокирован в popup.js", () => {
  assert.match(popupJs, /consentCheckbox\.checked/);
  assert.match(popupJs, /startBtn\.disabled = isRecording \|\| !consentGiven/);
  assert.match(popupJs, /Нужно согласие перед началом записи/);
  assert.match(popupHtml, /id="startBtn"[^>]*disabled/);
});

test("T1.5: deleteLocalRecording очищает lastRecording", async () => {
  const storage = createMockStorage({
    lastRecording: { recordingId: "rec-1" },
  });

  await deleteLocalRecording(storage);
  const data = await storage.local.get("lastRecording");
  assert.equal(data.lastRecording, undefined);
});

test("T1.5: deleteRemoteRecording вызывает DELETE /recording/{id}", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 204 };
  };

  const result = await deleteRemoteRecording({
    baseUrl: "http://localhost:8000/",
    recordingId: "rec-42",
    fetchFn,
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:8000/recording/rec-42");
  assert.equal(calls[0].init?.method, "DELETE");
});

test("T1.5: deleteAllRecordingArtifacts удаляет локально и шлёт DELETE если uploaded", async () => {
  const storage = createMockStorage({
    lastRecording: {
      recordingId: "rec-uploaded",
      meta: { recordingId: "rec-uploaded" },
      uploaded: true,
    },
    backendBaseUrl: "http://localhost:8000",
  });

  const calls = [];
  const result = await deleteAllRecordingArtifacts({
    storage,
    getBackendBaseUrl: async () => "http://localhost:8000",
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 204 };
    },
  });

  assert.equal(result.deleted, true);
  assert.equal(result.recordingId, "rec-uploaded");
  assert.equal(calls.length, 1);
  const data = await storage.local.get("lastRecording");
  assert.equal(data.lastRecording, undefined);
});

test("T1.5: hasStoredRecording определяет наличие локальной записи", () => {
  assert.equal(hasStoredRecording(null), false);
  assert.equal(hasStoredRecording({ recordingId: "rec-1" }), true);
});
