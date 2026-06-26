import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { MSG } from "../extension/lib/messages.js";

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
 * @param {object} event
 */
function assertValidRecEvent(event) {
  const timeline = {
    meta: {
      recordingId: "rec-schema-check",
      t0: Date.now(),
      url: "https://example.com",
      title: "Schema check",
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
  const valid = validateTimeline(timeline);
  if (!valid) {
    assert.fail(
      `RecEvent не прошёл схему: ${JSON.stringify(validateTimeline.errors, null, 2)}`,
    );
  }
}

/**
 * @param {string} html
 */
function createDomEnvironment(html) {
  const dom = new JSDOM(html, {
    url: "https://example.com/test",
    pretendToBeVisual: true,
    runScripts: "dangerously",
  });

  const scripts = [
    "content/bridge.js",
    "content/masking.js",
    "content/dom-context.js",
  ].map((relativePath) =>
    readFileSync(join(extensionDir, relativePath), "utf8"),
  );

  for (const source of scripts) {
    const scriptEl = dom.window.document.createElement("script");
    scriptEl.textContent = source;
    dom.window.document.body.appendChild(scriptEl);
  }

  return dom;
}

function loadTestPage() {
  const html = readFileSync(join(root, "fixtures/test-page.html"), "utf8");
  return createDomEnvironment(html);
}

test("T1.2: bridge-сообщения совпадают с extension/lib/messages.js", () => {
  const dom = createDomEnvironment("<!doctype html><html><body></body></html>");
  assert.equal(
    dom.window.TrainingRecorderMSG.CONTENT_START,
    MSG.CONTENT_START,
  );
  assert.equal(dom.window.TrainingRecorderMSG.CONTENT_STOP, MSG.CONTENT_STOP);
  assert.equal(
    dom.window.TrainingRecorderMSG.CONTENT_GET_EVENTS,
    MSG.CONTENT_GET_EVENTS,
  );
});

test("T1.2: клик по кнопке даёт RecEvent с text и bbox", () => {
  const dom = loadTestPage();
  const { document, TrainingRecorderDom: Dom } = dom.window;
  const button = document.getElementById("open-modal");
  assert.ok(button);

  const t0 = Date.now() - 500;
  const event = Dom.createRecEvent({
    id: "evt-test-click",
    type: "click",
    target: button,
    t0,
    url: dom.window.location.href,
  });

  assert.equal(event.type, "click");
  assert.equal(event.target?.text, "Открыть модалку");
  assert.equal(typeof event.target?.bbox.x, "number");
  assert.equal(typeof event.target?.bbox.y, "number");
  assert.equal(typeof event.target?.bbox.w, "number");
  assert.equal(typeof event.target?.bbox.h, "number");
  assert.ok(event.ts >= 0);
  assertValidRecEvent(event);
});

test("T1.2: ввод в поле даёт label, placeholder и value", () => {
  const dom = loadTestPage();
  const { document, TrainingRecorderDom: Dom } = dom.window;
  const input = document.getElementById("company-name");
  assert.ok(input);
  input.value = "ООО Ромашка";

  const event = Dom.createRecEvent({
    id: "evt-test-input",
    type: "input",
    target: input,
    t0: Date.now() - 1000,
    url: dom.window.location.href,
    value: input.value,
  });

  assert.equal(event.type, "input");
  assert.equal(event.target?.label, "Название");
  assert.equal(event.target?.placeholder, "Название компании");
  assert.equal(event.value, "ООО Ромашка");
  assert.match(event.target?.cssPath ?? "", /#company-name|company-name/);
  assertValidRecEvent(event);
});

test("T1.2: submit формы и menu_select на select", () => {
  const dom = loadTestPage();
  const { document, TrainingRecorderDom: Dom } = dom.window;

  const form = document.getElementById("client-form");
  const select = document.getElementById("client-type");
  assert.ok(form && select);
  select.value = "b2b";

  const submitEvent = Dom.createRecEvent({
    id: "evt-test-submit",
    type: "submit",
    target: form,
    t0: Date.now() - 800,
    url: dom.window.location.href,
  });
  const menuEvent = Dom.createRecEvent({
    id: "evt-test-menu",
    type: "menu_select",
    target: select,
    t0: Date.now() - 700,
    url: dom.window.location.href,
    value: select.value,
  });

  assert.equal(submitEvent.type, "submit");
  assert.ok(submitEvent.target?.nearbyText?.includes("Создание клиента"));
  assert.equal(menuEvent.type, "menu_select");
  assert.equal(menuEvent.value, "b2b");
  assertValidRecEvent(submitEvent);
  assertValidRecEvent(menuEvent);
});

test("T1.2: видимая модалка определяется как modal_open", () => {
  const dom = loadTestPage();
  const { document, TrainingRecorderDom: Dom } = dom.window;
  const modal = document.getElementById("client-modal");
  assert.ok(modal);
  modal.hidden = false;

  assert.equal(Dom.isVisibleModal(modal), true);

  const event = Dom.createRecEvent({
    id: "evt-test-modal",
    type: "modal_open",
    target: modal,
    t0: Date.now() - 300,
    url: dom.window.location.href,
  });

  assert.equal(event.type, "modal_open");
  assert.equal(event.target?.role, "dialog");
  assertValidRecEvent(event);
});

test("T1.2: собранные события валидируются как Timeline", () => {
  const dom = loadTestPage();
  const { document, TrainingRecorderDom: Dom } = dom.window;
  const t0 = Date.now() - 2_000;
  const url = dom.window.location.href;

  const events = [
    Dom.createRecEvent({
      id: "evt-1",
      type: "click",
      target: document.getElementById("open-modal"),
      t0,
      url,
    }),
    Dom.createRecEvent({
      id: "evt-2",
      type: "input",
      target: document.getElementById("company-name"),
      t0,
      url,
      value: "Test",
    }),
    Dom.createRecEvent({
      id: "evt-3",
      type: "submit",
      target: document.getElementById("client-form"),
      t0,
      url,
    }),
  ];

  const timeline = {
    meta: {
      recordingId: "rec-test",
      t0,
      url,
      title: "Test",
      durationMs: 1500,
      userAgent: "jsdom",
      videoStartOffsetMs: 10,
      micStartOffsetMs: 12,
      videoDurationMs: 1480,
      micDurationMs: 1470,
    },
    events,
    screenshots: [],
  };

  assert.equal(validateTimeline(timeline), true);
});
