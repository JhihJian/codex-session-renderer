import test from "node:test";
import assert from "node:assert/strict";
import { sessionStartedFromFile } from "../src/text-utils.mjs";

test("sessionStartedFromFile parses Pi Agent timestamped session files", () => {
  assert.equal(
    sessionStartedFromFile("C:\\Users\\user\\.pi\\agent\\sessions\\--project--\\2026-07-10T04-51-55-870Z_019f4a5e-355e-798f-8e14-34b472b8615d.jsonl"),
    "2026-07-10T04:51:55.870Z",
  );
});
