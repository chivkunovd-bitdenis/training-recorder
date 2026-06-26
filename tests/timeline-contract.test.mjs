import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const schema = JSON.parse(
  readFileSync(join(root, "shared/timeline.schema.json"), "utf8"),
);
const mockTimeline = JSON.parse(
  readFileSync(join(root, "fixtures/timeline.mock.json"), "utf8"),
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

test("fixtures/timeline.mock.json проходит валидацию по timeline.schema.json", () => {
  const valid = validate(mockTimeline);
  if (!valid) {
    assert.fail(
      `Схема отклонила мок: ${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
  assert.equal(valid, true);
});

test("невалидный timeline отклоняется схемой", () => {
  const invalid = structuredClone(mockTimeline);
  delete invalid.meta.recordingId;

  const valid = validate(invalid);
  assert.equal(valid, false);
  assert.ok(validate.errors?.length);
});
