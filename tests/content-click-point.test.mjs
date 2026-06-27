import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const extensionDir = join(root, "extension");

const timelineSchema = JSON.parse(
  readFileSync(join(root, "shared/timeline.schema.json"), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateTimeline = ajv.compile(timelineSchema);

/**
 * @param {string} html
 */
function createDomEnvironment(html) {
  const dom = new JSDOM(html, {
    url: "https://example.com/warehouse",
    pretendToBeVisual: true,
    runScripts: "dangerously",
  });

  const source = readFileSync(
    join(extensionDir, "content/dom-context.js"),
    "utf8",
  );
  const scriptEl = dom.window.document.createElement("script");
  scriptEl.textContent = source;
  dom.window.document.body.appendChild(scriptEl);

  Object.assign(dom.window, {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
  });

  return dom;
}

/** @param {object} event */
function assertValidRecEvent(event) {
  const timeline = {
    meta: {
      recordingId: "rec-click-point",
      t0: Date.now(),
      url: "https://example.com/warehouse",
      title: "Click point",
      durationMs: 0,
      userAgent: "test",
      videoStartOffsetMs: 0,
      micStartOffsetMs: 0,
      videoDurationMs: 0,
      micDurationMs: 0,
    },
    events: [event],
    screenshots: [],
  };
  assert.equal(validateTimeline(timeline), true);
}

test("T-CLK-2: resolveClickTarget поднимает span до button и сохраняет clickPoint", () => {
  const dom = createDomEnvironment(`
    <!doctype html><html><body>
      <button id="close-box"><span class="icon" aria-hidden="true"></span>Закрыть короб</button>
    </body></html>
  `);
  const { document, TrainingRecorderDom: Dom } = dom.window;
  const span = document.querySelector("span.icon");
  const button = document.getElementById("close-box");
  assert.ok(span && button);

  const pointer = { clientX: 612, clientY: 198 };
  const resolved = Dom.resolveClickTarget(span, pointer);

  assert.equal(resolved.element, button);
  assert.equal(resolved.clickPoint.x, 612);
  assert.equal(resolved.clickPoint.y, 198);
});

test("T-CLK-2: createRecEvent с clickPoint — text и cssPath от кнопки", () => {
  const dom = createDomEnvironment(`
    <!doctype html><html><body>
      <button id="close-box"><span class="icon" aria-hidden="true"></span>Закрыть короб</button>
    </body></html>
  `);
  const { document, TrainingRecorderDom: Dom } = dom.window;
  const span = document.querySelector("span.icon");
  assert.ok(span);

  const { element, clickPoint } = Dom.resolveClickTarget(span, {
    clientX: 400,
    clientY: 120,
  });

  const event = Dom.createRecEvent({
    id: "evt-cp-span",
    type: "click",
    target: element,
    t0: Date.now() - 100,
    url: dom.window.location.href,
    clickPoint,
  });

  assert.equal(event.target?.text, "Закрыть короб");
  assert.equal(event.target?.tag, "button");
  assert.match(event.target?.cssPath ?? "", /#close-box/);
  assert.ok(!/span/.test(event.target?.cssPath ?? ""));
  assert.equal(event.target?.clickPoint?.x, 400);
  assert.equal(event.target?.clickPoint?.y, 120);
  assertValidRecEvent(event);
});

test("T-CLK-2: clickPoint в пределах mock viewport", () => {
  const dom = createDomEnvironment(
    `<!doctype html><html><body><button id="btn">OK</button></body></html>`,
  );
  const { document, TrainingRecorderDom: Dom } = dom.window;
  const button = document.getElementById("btn");
  assert.ok(button);

  const clickPoint = { x: 640, y: 360 };
  const event = Dom.createRecEvent({
    id: "evt-viewport",
    type: "click",
    target: button,
    t0: Date.now(),
    url: dom.window.location.href,
    clickPoint,
  });

  assert.ok(event.target?.clickPoint);
  assert.ok(event.target.clickPoint.x >= 0);
  assert.ok(event.target.clickPoint.x <= dom.window.innerWidth);
  assert.ok(event.target.clickPoint.y >= 0);
  assert.ok(event.target.clickPoint.y <= dom.window.innerHeight);
});
