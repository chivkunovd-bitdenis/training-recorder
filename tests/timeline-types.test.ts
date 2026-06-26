import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Timeline } from "../shared/timeline.types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mockPath = join(__dirname, "..", "fixtures/timeline.mock.json");

test("Timeline типы совместимы с мок-фикстурой", () => {
  const timeline = JSON.parse(readFileSync(mockPath, "utf8")) as Timeline;

  assert.equal(timeline.meta.recordingId, "rec-mock-client-create");
  assert.equal(timeline.events.length, 6);
  assert.equal(timeline.screenshots.length, 4);
  assert.equal(timeline.events[0].target?.text, "Создать клиента");
  assert.equal(timeline.events[3].target?.masked, true);
});
