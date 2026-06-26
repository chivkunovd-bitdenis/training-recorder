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

function assertValidTimeline(timeline) {
  const valid = validateTimeline(timeline);
  if (!valid) {
    assert.fail(
      `Timeline не прошёл схему: ${JSON.stringify(validateTimeline.errors, null, 2)}`,
    );
  }
}

test("T1.3: password маскирует value и ставит masked=true", () => {
  const dom = loadTestPage();
  const { document, TrainingRecorderDom: Dom } = dom.window;
  const password = document.getElementById("client-password");
  assert.ok(password);
  password.value = "SuperSecret123!";

  const event = Dom.createRecEvent({
    id: "evt-password",
    type: "input",
    target: password,
    t0: Date.now() - 500,
    url: dom.window.location.href,
    value: password.value,
  });

  assert.equal(event.value, "••••");
  assert.equal(event.target?.masked, true);
  assert.notEqual(event.value, "SuperSecret123!");
});

test("T1.3: email и tel маскируются по type/autocomplete", () => {
  const dom = loadTestPage();
  const { document, TrainingRecorderDom: Dom } = dom.window;

  const email = document.getElementById("client-email");
  const phone = document.getElementById("client-phone");
  assert.ok(email && phone);

  email.value = "user@secret.ru";
  phone.value = "+79001234567";

  const emailEvent = Dom.createRecEvent({
    id: "evt-email",
    type: "input",
    target: email,
    t0: Date.now() - 400,
    url: dom.window.location.href,
    value: email.value,
  });
  const phoneEvent = Dom.createRecEvent({
    id: "evt-phone",
    type: "input",
    target: phone,
    t0: Date.now() - 300,
    url: dom.window.location.href,
    value: phone.value,
  });

  assert.equal(emailEvent.value, "••••");
  assert.equal(phoneEvent.value, "••••");
  assert.equal(emailEvent.target?.masked, true);
  assert.equal(phoneEvent.target?.masked, true);
});

test("T1.3: data-sensitive контейнер убирает текст и маскирует value", () => {
  const dom = loadTestPage();
  const { document, TrainingRecorderDom: Dom } = dom.window;
  const secret = document.getElementById("secret-note");
  assert.ok(secret);
  secret.value = "Секретные данные клиента";

  const event = Dom.createRecEvent({
    id: "evt-secret",
    type: "input",
    target: secret,
    t0: Date.now() - 200,
    url: dom.window.location.href,
    value: secret.value,
  });

  assert.equal(event.value, "••••");
  assert.equal(event.target?.text, null);
  assert.equal(event.target?.nearbyText, null);
  assert.equal(event.target?.masked, true);
});

test("T1.3: обычное поле не маскируется, длинный value обрезается", () => {
  const dom = loadTestPage();
  const { document, TrainingRecorderDom: Dom, TrainingRecorderMasking: Mask } =
    dom.window;
  const company = document.getElementById("company-name");
  assert.ok(company && Mask);

  const longValue = "А".repeat(250);
  company.value = longValue;

  const event = Dom.createRecEvent({
    id: "evt-company",
    type: "input",
    target: company,
    t0: Date.now() - 100,
    url: dom.window.location.href,
    value: company.value,
  });

  assert.equal(event.target?.masked, false);
  assert.equal(event.value?.length, Mask.MAX_VALUE_LENGTH);
  assert.notEqual(event.value, "••••");
});

test("T1.3: timeline с PII-полями не содержит реальных значений", () => {
  const dom = loadTestPage();
  const { document, TrainingRecorderDom: Dom } = dom.window;
  const t0 = Date.now() - 5_000;
  const url = dom.window.location.href;

  document.getElementById("client-password").value = "Secret!";
  document.getElementById("client-email").value = "real@email.com";
  document.getElementById("client-phone").value = "+79001112233";

  const events = [
    Dom.createRecEvent({
      id: "evt-1",
      type: "input",
      target: document.getElementById("client-password"),
      t0,
      url,
      value: "Secret!",
    }),
    Dom.createRecEvent({
      id: "evt-2",
      type: "input",
      target: document.getElementById("client-email"),
      t0,
      url,
      value: "real@email.com",
    }),
    Dom.createRecEvent({
      id: "evt-3",
      type: "input",
      target: document.getElementById("client-phone"),
      t0,
      url,
      value: "+79001112233",
    }),
  ];

  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /Secret!/);
  assert.doesNotMatch(serialized, /real@email.com/);
  assert.doesNotMatch(serialized, /\+79001112233/);
  assert.ok(events.every((event) => event.target?.masked === true));
  assert.ok(events.every((event) => event.value === "••••"));

  const timeline = {
    meta: {
      recordingId: "rec-mask-test",
      t0,
      url,
      title: "Mask test",
      durationMs: 1000,
      userAgent: "jsdom",
      videoStartOffsetMs: 0,
      micStartOffsetMs: 0,
      videoDurationMs: 1000,
      micDurationMs: 1000,
    },
    events,
    screenshots: [],
  };

  assertValidTimeline(timeline);
});

test("T1.3: shouldMaskValueContent ловит ИНН и СНИЛС", () => {
  const dom = createDomEnvironment("<!doctype html><html><body></body></html>");
  const { TrainingRecorderMasking: Mask } = dom.window;

  assert.equal(Mask.shouldMaskValueContent("7707083893"), true);
  assert.equal(Mask.shouldMaskValueContent("123-456-789 01"), true);
  assert.equal(Mask.shouldMaskValueContent("ООО Ромашка"), false);
});
