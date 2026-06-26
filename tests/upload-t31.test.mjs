import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildEditorUrl,
  uploadAndOpenEditor,
  uploadRecording,
} from "../extension/lib/upload-recording.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(__dirname, "..", "extension");

const popupHtml = readFileSync(join(extensionDir, "popup/popup.html"), "utf8");
const popupJs = readFileSync(join(extensionDir, "popup/popup.js"), "utf8");

test("T3.1: popup содержит кнопку отправки в редактор и поле адреса сервера", () => {
  assert.match(popupHtml, /id="editorBtn"/);
  assert.match(popupHtml, /Отправить и открыть редактор/);
  assert.match(popupHtml, /id="backendUrlInput"/);
  assert.match(popupJs, /uploadAndOpenEditor/);
  assert.match(popupJs, /chrome\.tabs\.create/);
});

test("T3.1: buildEditorUrl формирует URL редактора", () => {
  const url = buildEditorUrl("http://127.0.0.1:8000/", "rec-42");
  assert.equal(url, "http://127.0.0.1:8000/editor/recording/rec-42");
});

test("T3.1: uploadRecording отправляет multipart на POST /process", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return { recordingId: "rec-uploaded", jobId: "job-1", status: "received" };
      },
    };
  };

  const timeline = {
    meta: { recordingId: "rec-uploaded", t0: 1 },
    events: [],
    screenshots: [{ id: "scr-001" }],
  };

  const result = await uploadRecording({
    baseUrl: "http://localhost:8000",
    micBlob: new Blob(["mic"], { type: "audio/webm" }),
    timeline,
    screenshotImages: { "scr-001": btoa("jpeg") },
    fetchFn,
  });

  assert.equal(result.recordingId, "rec-uploaded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:8000/process");
  assert.equal(calls[0].init?.method, "POST");
  assert.ok(calls[0].init?.body instanceof FormData);
});

test("T3.1: uploadAndOpenEditor открывает вкладку редактора", async () => {
  const opened = [];
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { recordingId: "rec-99", jobId: "job-9", status: "received" };
    },
  });

  const result = await uploadAndOpenEditor({
    baseUrl: "http://localhost:8000",
    micBlob: new Blob(["mic"], { type: "audio/webm" }),
    timeline: { meta: { recordingId: "rec-99", t0: 1 }, events: [], screenshots: [] },
    openEditor: (url) => {
      opened.push(url);
    },
    fetchFn,
  });

  assert.equal(
    result.editorUrl,
    "http://localhost:8000/editor/recording/rec-99",
  );
  assert.deepEqual(opened, ["http://localhost:8000/editor/recording/rec-99"]);
});
