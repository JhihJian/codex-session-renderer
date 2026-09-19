import { watch } from "node:fs";
import { readCommittedJsonlChunk } from "./jsonl-tail-reader.mjs";
import { deriveSessionStatusFromTurns, buildTurns } from "./session-events.mjs";
import { normalizeSessionEvent } from "./session-normalizer.mjs";

const heartbeatMs = 15_000;
const refreshMs = 1_000;

function identityFor(stat) {
  return `${stat?.dev ?? "unknown"}:${stat?.ino ?? "unknown"}`;
}

function sessionStatus(events) {
  return deriveSessionStatusFromTurns(buildTurns(events));
}

function projectLiveEvent(rawEvent, index) {
  const event = normalizeSessionEvent(rawEvent, index);
  return {
    sourceIndex: index,
    timestamp: event.timestamp,
    kind: event.kind,
    semanticKind: event.semanticKind,
    role: event.role,
    messageId: event.messageId,
    callId: event.callId,
    isDelta: event.isDelta,
    phase: event.payload?.phase || null,
    text: event.text || "",
    toolName: event.toolName || null,
    toolInput: event.toolInput || null,
    toolOutput: event.toolOutput ? String(event.toolOutput).slice(0, 2_000) : null,
    diagnostic: event.diagnostic || null,
  };
}

function writeEvent(res, type, payload, id = null) {
  if (res.destroyed || res.writableEnded) return false;
  try {
    if (id) res.write(`id: ${id}\n`);
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function cursor(generation, sequence) {
  return `${generation}:${sequence}`;
}

class LiveHub {
  constructor({ context, session, sessionFileStat, onEmpty }) {
    this.context = context;
    this.session = session;
    this.sessionFileStat = sessionFileStat;
    this.onEmpty = onEmpty;
    this.subscribers = new Set();
    this.state = null;
    this.refreshTimer = null;
    this.watcher = null;
    this.refreshScheduled = false;
    this.generationEpoch = 0;
  }

  async subscribe(res, signal) {
    if (!this.state) await this.initialize();
    return this.addSubscriber(res, signal);
  }

  async initialize() {
    const stat = await this.currentStat();
    if (!stat) throw Object.assign(new Error("Session not found"), { status: 404 });
    this.state = await this.snapshotState(stat);
    this.startWatching();
  }

  async currentStat() {
    return this.sessionFileStat(this.context, this.session.path, this.session.id);
  }

  async snapshotState(stat) {
    const chunk = await readCommittedJsonlChunk(this.session.path, { endOffset: stat.size });
    return this.stateFromChunk(stat, chunk);
  }

  stateFromChunk(stat, chunk) {
    return {
      identity: identityFor(stat), generation: `${identityFor(stat)}:${this.generationEpoch}`,
      offset: chunk.committedByteOffset, lineCount: chunk.lineCount, records: chunk.events,
      sequence: chunk.recordCount, observedStat: stat,
    };
  }

  payloadSnapshot() {
    return {
      generation: this.state.generation, nextSequence: this.state.sequence,
      cursor: cursor(this.state.generation, this.state.sequence), sessionStatus: sessionStatus(this.state.records),
      observedAt: new Date().toISOString(), events: this.state.records.map((event, index) => projectLiveEvent(event, index)),
    };
  }

  broadcast(type, payload, id = null) {
    for (const subscriber of [...this.subscribers]) {
      if (!writeEvent(subscriber.res, type, payload, id)) this.removeSubscriber(subscriber);
    }
  }

  scheduleRefresh() {
    if (this.refreshScheduled) return;
    this.refreshScheduled = true;
    setTimeout(() => {
      this.refreshScheduled = false;
      void this.refresh();
    }, 80).unref?.();
  }

  startWatching() {
    try {
      this.watcher = watch(this.session.path, { persistent: false }, () => this.scheduleRefresh());
      this.watcher.on("error", () => {});
    } catch {
      this.watcher = null;
    }
    this.refreshTimer = setInterval(() => void this.refresh(), refreshMs);
    this.refreshTimer.unref?.();
  }

  async reset(stat, reason) {
    this.generationEpoch += 1;
    this.state = await this.snapshotState(stat);
    this.broadcast("reset", { reason, observedAt: new Date().toISOString() });
    this.broadcast("snapshot", this.payloadSnapshot());
  }

  needsReset(stat) {
    const replaced = identityFor(stat) !== this.state.identity || stat.size < this.state.offset;
    const rewritten = stat.size === this.state.offset && stat.mtimeMs !== this.state.observedStat.mtimeMs && stat.ctimeMs !== this.state.observedStat.ctimeMs;
    return replaced ? "file_replaced" : rewritten ? "file_rewritten" : null;
  }

  async refresh() {
    if (!this.state || !this.subscribers.size) return;
    try {
      const before = await this.currentStat();
      if (!before) return;
      const reason = this.needsReset(before);
      if (reason) return this.reset(before, reason);
      if (before.size <= this.state.offset) {
        this.state.observedStat = before;
        return;
      }
      const chunk = await this.readAppend(before);
      const after = await this.currentStat();
      if (!after || identityFor(after) !== this.state.identity || after.size < this.state.offset) {
        if (after) await this.reset(after, "file_changed_during_read");
        return;
      }
      this.applyAppend(chunk, after);
    } catch {
      this.broadcast("status", { state: "degraded", message: "实时读取暂时不可用", observedAt: new Date().toISOString() });
    }
  }

  async readAppend(stat) {
    return readCommittedJsonlChunk(this.session.path, {
      startOffset: this.state.offset, endOffset: stat.size,
      startIndex: this.state.sequence, startLineNumber: this.state.lineCount,
    });
  }

  applyAppend(chunk, stat) {
    this.state.offset = chunk.committedByteOffset;
    this.state.lineCount += chunk.lineCount;
    this.state.observedStat = stat;
    for (const event of chunk.events) this.appendEvent(event);
  }

  appendEvent(event) {
    const sequence = this.state.sequence;
    this.state.records.push(event);
    this.state.sequence += 1;
    this.broadcast("append", {
      generation: this.state.generation, sequence, cursor: cursor(this.state.generation, this.state.sequence),
      sessionStatus: sessionStatus(this.state.records), observedAt: new Date().toISOString(), event: projectLiveEvent(event, sequence),
    }, cursor(this.state.generation, sequence));
  }

  addSubscriber(res, signal) {
    const subscriber = { res, signal, heartbeat: null };
    this.subscribers.add(subscriber);
    writeEvent(res, "snapshot", this.payloadSnapshot());
    subscriber.heartbeat = setInterval(() => writeEvent(res, "heartbeat", { observedAt: new Date().toISOString() }), heartbeatMs);
    subscriber.heartbeat.unref?.();
    const onAbort = () => this.removeSubscriber(subscriber);
    signal?.addEventListener("abort", onAbort, { once: true });
    subscriber.cleanup = () => signal?.removeEventListener("abort", onAbort);
    return new Promise((resolve) => { subscriber.resolve = resolve; });
  }

  removeSubscriber(subscriber) {
    if (!this.subscribers.delete(subscriber)) return;
    clearInterval(subscriber.heartbeat);
    subscriber.cleanup?.();
    subscriber.resolve?.();
    if (!this.subscribers.size) this.close();
  }

  close() {
    this.watcher?.close();
    clearInterval(this.refreshTimer);
    this.onEmpty();
  }
}

function createHub(options) {
  return new LiveHub(options);
}

export function createLiveSessionStreamService({ getSessionById, sessionFileExists, sessionFileStat }) {
  const hubs = new Map();

  async function streamSession(context, id, res, options = {}) {
    const session = await getSessionById(context, id, { signal: options.signal });
    if (!session || !await sessionFileExists(context, session, options)) return null;
    const key = `${context.source.id}:${id}`;
    let hub = hubs.get(key);
    if (!hub) {
      hub = createHub({ context, session, sessionFileStat, onEmpty: () => hubs.delete(key) });
      hubs.set(key, hub);
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.flushHeaders?.();
    await hub.subscribe(res, options.signal);
    return true;
  }

  return { streamSession, hubs };
}