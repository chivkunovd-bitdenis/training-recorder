import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { findClosestFrame } from "../extension/lib/frame-capture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(__dirname, "..", "extension");

function loadStabilizer(dom) {
  const source = readFileSync(
    join(extensionDir, "content/stabilizer.js"),
    "utf8",
  );
  const scriptEl = dom.window.document.createElement("script");
  scriptEl.textContent = source;
  dom.window.document.body.appendChild(scriptEl);
}

test("T1.4: isSignificantAction для navigation и click по кнопке", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "dangerously",
  });
  loadStabilizer(dom);
  const { isSignificantAction } = dom.window.TrainingRecorderStabilizer;

  assert.equal(isSignificantAction("navigation", null), true);
  assert.equal(isSignificantAction("input", null), false);

  const button = dom.window.document.createElement("button");
  button.textContent = "Сохранить";
  assert.equal(isSignificantAction("click", button), true);

  const div = dom.window.document.createElement("div");
  assert.equal(isSignificantAction("click", div), false);
});

test("T1.4: второй significant action помечает первый кандидат как SUPERSEDED", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "dangerously",
  });
  loadStabilizer(dom);
  const { StabilizerController } = dom.window.TrainingRecorderStabilizer;
  const captures = [];

  const stabilizer = new StabilizerController({
    t0: Date.now() - 1_000,
    document: dom.window.document,
    onCapture: (payload) => captures.push(payload),
    getNetworkActiveCount: () => 0,
  });

  stabilizer.onSignificantAction("evt-a", 100);
  stabilizer.onSignificantAction("evt-b", 300);

  const history = stabilizer.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].eventId, "evt-a");
  assert.equal(history[0].state, "SUPERSEDED");
  assert.equal(captures.length, 0);
});

test("T1.4: CAPTURED после quiet window, TIMED_OUT по MAX_WAIT", () => {
  const dom = new JSDOM(
    `<!doctype html><html><body><main style="height:120px"></main></body></html>`,
    { runScripts: "dangerously" },
  );
  loadStabilizer(dom);
  const { StabilizerController, CONFIG } = dom.window.TrainingRecorderStabilizer;
  const captures = [];

  const stabilizer = new StabilizerController({
    t0: Date.now() - 5_000,
    document: dom.window.document,
    onCapture: (payload) => captures.push(payload),
    getNetworkActiveCount: () => 0,
  });

  stabilizer.lastDomMutation = Date.now() - CONFIG.QUIET_WINDOW - 50;
  stabilizer.onSignificantAction("evt-stable", 500);
  stabilizer.quietSince = Date.now() - CONFIG.QUIET_WINDOW;
  stabilizer.tick();

  assert.equal(captures.length, 1);
  assert.equal(captures[0].confidence, "high");
  assert.equal(captures[0].eventId, "evt-stable");

  const timeoutCaptures = [];
  const timeoutStabilizer = new StabilizerController({
    t0: Date.now() - 10_000,
    document: dom.window.document,
    onCapture: (payload) => timeoutCaptures.push(payload),
    getNetworkActiveCount: () => 1,
  });
  timeoutStabilizer.onSignificantAction("evt-timeout", 1000);
  timeoutStabilizer.activeCandidate.startedAt = Date.now() - CONFIG.MAX_WAIT - 10;
  timeoutStabilizer.tick();

  assert.equal(timeoutCaptures.length, 1);
  assert.equal(timeoutCaptures[0].confidence, "low");
});

test("T1.4: hasVisibleLoaders блокирует стабилизацию пока виден спиннер", () => {
  const dom = new JSDOM(
    `<!doctype html><html><body><div class="spinner">...</div></body></html>`,
    { runScripts: "dangerously" },
  );
  loadStabilizer(dom);
  const { hasVisibleLoaders } = dom.window.TrainingRecorderStabilizer;
  assert.equal(hasVisibleLoaders(dom.window.document), true);
});

test("T1.4: findClosestFrame выбирает ближайший кадр из буфера", () => {
  const frames = [
    { ts: 1000, blob: null },
    { ts: 1180, blob: null },
    { ts: 1400, blob: null },
  ];
  const closest = findClosestFrame(frames, 1200);
  assert.equal(closest?.ts, 1180);
});

test("T1.4: frame offsets и конфиг стабилизатора зафиксированы", async () => {
  const { STABILIZER_CONFIG } = await import(
    "../extension/lib/stabilizer-config.js"
  );
  assert.equal(STABILIZER_CONFIG.QUIET_WINDOW, 400);
  assert.equal(STABILIZER_CONFIG.MAX_WAIT, 8000);
  assert.deepEqual(STABILIZER_CONFIG.FRAME_OFFSETS_MS, [-120, 0, 120]);
});
