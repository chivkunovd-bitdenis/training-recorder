import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { JSDOM } from "jsdom";

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

test("T-CLK-3: click → onCapture сразу, без QUIET_WINDOW", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "dangerously",
  });
  loadStabilizer(dom);
  const { StabilizerController, CAPTURE_MODE } =
    dom.window.TrainingRecorderStabilizer;
  const captures = [];

  const stabilizer = new StabilizerController({
    t0: Date.now() - 5_000,
    document: dom.window.document,
    onCapture: (payload) => captures.push(payload),
    getNetworkActiveCount: () => 1,
  });

  stabilizer.onSignificantAction("evt-click", 420, CAPTURE_MODE.IMMEDIATE);

  assert.equal(captures.length, 1);
  assert.equal(captures[0].eventId, "evt-click");
  assert.equal(captures[0].ts, 420);
  assert.equal(captures[0].confidence, "high");
  assert.equal(captures[0].immediate, true);
  assert.equal(stabilizer.activeCandidate, null);
});

test("T-CLK-3: navigation → deferred, onCapture только после tick quiet window", () => {
  const dom = new JSDOM(
    `<!doctype html><html><body><main style="height:120px"></main></body></html>`,
    { runScripts: "dangerously" },
  );
  loadStabilizer(dom);
  const { StabilizerController, CAPTURE_MODE, CONFIG } =
    dom.window.TrainingRecorderStabilizer;
  const captures = [];

  const stabilizer = new StabilizerController({
    t0: Date.now() - 5_000,
    document: dom.window.document,
    onCapture: (payload) => captures.push(payload),
    getNetworkActiveCount: () => 0,
  });

  stabilizer.onSignificantAction("evt-nav", 900, CAPTURE_MODE.DEFERRED);
  assert.equal(captures.length, 0);

  stabilizer.lastDomMutation = Date.now() - CONFIG.QUIET_WINDOW - 50;
  stabilizer.quietSince = Date.now() - CONFIG.QUIET_WINDOW;
  stabilizer.tick();

  assert.equal(captures.length, 1);
  assert.equal(captures[0].eventId, "evt-nav");
  assert.equal(captures[0].ts, 900);
  assert.equal(captures[0].immediate, false);
});

test("T-CLK-3: modal_open → getCaptureMode null, onCapture не вызывается", () => {
  const dom = new JSDOM(
    `<!doctype html><html><body><div role="dialog">Modal</div></body></html>`,
    { runScripts: "dangerously" },
  );
  loadStabilizer(dom);
  const { StabilizerController, getCaptureMode } =
    dom.window.TrainingRecorderStabilizer;
  const dialog = dom.window.document.querySelector('[role="dialog"]');
  const captures = [];

  assert.equal(getCaptureMode("modal_open", dialog), null);

  const stabilizer = new StabilizerController({
    t0: Date.now() - 1_000,
    document: dom.window.document,
    onCapture: (payload) => captures.push(payload),
    getNetworkActiveCount: () => 0,
  });

  const mode = getCaptureMode("modal_open", dialog);
  if (mode) {
    stabilizer.onSignificantAction("evt-modal", 200, mode);
  }

  stabilizer.tick();
  assert.equal(captures.length, 0);
});

test("T-CLK-3: getCaptureMode — click button immediate, submit immediate", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "dangerously",
  });
  loadStabilizer(dom);
  const { getCaptureMode, CAPTURE_MODE } =
    dom.window.TrainingRecorderStabilizer;

  const button = dom.window.document.createElement("button");
  button.textContent = "OK";
  assert.equal(getCaptureMode("click", button), CAPTURE_MODE.IMMEDIATE);
  assert.equal(getCaptureMode("submit", button), CAPTURE_MODE.IMMEDIATE);
  assert.equal(getCaptureMode("menu_select", button), CAPTURE_MODE.IMMEDIATE);
  assert.equal(getCaptureMode("navigation", null), CAPTURE_MODE.DEFERRED);
  assert.equal(getCaptureMode("input", button), null);
  assert.equal(getCaptureMode("focus", button), null);
});

test("T-CLK-3: captureSingleFrame — один кадр, ts = время клика, candidates пустой", async () => {
  const source = readFileSync(
    join(extensionDir, "lib/frame-capture.js"),
    "utf8",
  );
  assert.match(source, /async captureSingleFrame\(/);
  assert.match(source, /candidates: \[\]/);

  const { STABILIZER_CONFIG } = await import(
    "../extension/lib/stabilizer-config.js"
  );
  assert.equal(STABILIZER_CONFIG.IMMEDIATE_CAPTURE_DELAY_MS, 0);
  assert.equal(STABILIZER_CONFIG.IMMEDIATE_CAPTURE_FALLBACK_MS, 50);
});
