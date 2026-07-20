import test from "node:test";
import assert from "node:assert/strict";
import "../public/evidence-id.js";

const { buildEvidenceId } = globalThis.EvidenceId;

test("evidence IDs distinguish source, session, thread path and repeated turn numbers", () => {
  const rootTurn = buildEvidenceId({
    sourceId: "local",
    sessionId: "root-session",
    threadPath: "root",
    turnNumber: 1,
    entity: "turn",
  });
  const childTurn = buildEvidenceId({
    sourceId: "local",
    sessionId: "child-session",
    threadPath: "root/turn-1/child-0",
    turnNumber: 1,
    entity: "turn",
  });
  const sameChildTurn = buildEvidenceId({
    sourceId: "local",
    sessionId: "child-session",
    threadPath: "root/turn-1/child-0",
    turnNumber: 1,
    entity: "turn",
  });

  assert.notEqual(rootTurn, childTurn);
  assert.equal(childTurn, sameChildTurn);
  assert.match(rootTurn, /^source:local\|session:root-session\|thread:root\|turn:1\|object:turn$/);
  assert.match(childTurn, /session:child-session\|thread:root%2Fturn-1%2Fchild-0\|turn:1/);
});