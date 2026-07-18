import assert from "node:assert/strict";
import path from "node:path";

export async function assertBoundedDiagnosticEndpoints({ baseUrl, fs, limitedEvents, limitedId, requestJson, sessionDir }) {
  assert.match(limitedEvents.body.page.snapshot, /^[A-Za-z0-9_-]+$/);
  assert.equal(limitedEvents.body.events[0].payload, undefined);
  assert.equal(limitedEvents.body.events[0].raw, undefined);
  assert.equal(limitedEvents.body.page.hasMore, true);
  const nextEvents = await requestJson(baseUrl, `/api/sources/local/query/sessions/${limitedId}/events?limit=2&cursor=${limitedEvents.body.page.nextCursor}&snapshot=${limitedEvents.body.page.snapshot}`);
  assert.equal(nextEvents.response.status, 200);
  assert.equal(nextEvents.body.events.length, 2);
  assert.equal(nextEvents.body.events[0].index > limitedEvents.body.events.at(-1).index, true);
  const beyondDetailLimit = await requestJson(
    baseUrl,
    `/api/sources/local/query/sessions/${limitedId}/events?limit=1&cursor=10000&snapshot=${limitedEvents.body.page.snapshot}`,
  );
  assert.equal(beyondDetailLimit.response.status, 200);
  assert.equal(beyondDetailLimit.body.events[0].index, 10000);
  assert.equal(beyondDetailLimit.body.page.hasMore, false);
  assert.equal(beyondDetailLimit.body.page.truncated, true);
  assert.equal(beyondDetailLimit.body.page.stopReason, "raw_event_scan_limit");
  const sourceEvent = await requestJson(
    baseUrl,
    `/api/sources/local/sessions/${limitedId}/events/10000?snapshot=${limitedEvents.body.page.snapshot}`,
  );
  assert.equal(sourceEvent.response.status, 200);
  assert.equal(sourceEvent.body.payload.message, "event-10000");
  const excessiveEvent = await requestJson(
    baseUrl,
    `/api/sources/local/sessions/${limitedId}/events/10001?snapshot=${limitedEvents.body.page.snapshot}`,
  );
  assert.equal(excessiveEvent.response.status, 413);
  assert.equal(excessiveEvent.body.details.code, "session_event_scan_limited");
  await assertStaleSnapshotIsRejected(baseUrl, limitedId, nextEvents, requestJson);
  await assertRawScanByteLimit(baseUrl, fs, requestJson, sessionDir);
}

async function assertStaleSnapshotIsRejected(baseUrl, limitedId, nextEvents, requestJson) {
  const staleEvents = await requestJson(baseUrl, `/api/sources/local/query/sessions/${limitedId}/events?limit=2&cursor=${nextEvents.body.page.nextCursor}&snapshot=stale-page-token`);
  assert.equal(staleEvents.response.status, 409);
  assert.equal(staleEvents.body.details.code, "session_snapshot_changed");
  const staleEvent = await requestJson(baseUrl, `/api/sources/local/sessions/${limitedId}/events/0?snapshot=stale-page-token`);
  assert.equal(staleEvent.response.status, 409);
  assert.equal(staleEvent.body.details.code, "session_snapshot_changed");
}

async function assertRawScanByteLimit(baseUrl, fs, requestJson, sessionDir) {
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const sessionPath = path.join(sessionDir, `rollout-2026-07-08T10-10-00-${sessionId}.jsonl`);
  const events = [
    { type: "event_msg", payload: { type: "agent_message", message: "small-first-event" } },
    { type: "event_msg", payload: { type: "agent_message", message: "x".repeat(9 * 1024 * 1024) } },
  ];
  await fs.writeFile(sessionPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  const response = await requestJson(baseUrl, `/api/sources/local/query/sessions/${sessionId}/events?limit=10`);
  assert.equal(response.response.status, 200);
  assert.equal(response.body.events.length, 1);
  assert.equal(response.body.page.hasMore, false);
  assert.equal(response.body.page.truncated, true);
  assert.equal(response.body.page.stopReason, "raw_scan_byte_limit");
}