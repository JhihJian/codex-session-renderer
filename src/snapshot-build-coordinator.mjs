import path from "node:path";
import { promises as fs } from "node:fs";
import { createAbortError, throwIfAborted } from "./remote-http.mjs";

function createSnapshotBuildCoordinator(options = {}) {
  const maxConcurrent = Math.max(1, Number(options.maxConcurrent) || 1);
  const maxQueued = Math.max(0, Number(options.maxQueued) || 0);
  const fsApi = options.fsApi || fs;
  const tasks = new Map();
  const queue = [];
  let active = 0;

  async function cleanup(task) {
    if (tasks.get(task.key) === task) tasks.delete(task.key);
    if (task.archivePath) await fsApi.rm(path.dirname(task.archivePath), { recursive: true, force: true }).catch(() => {});
  }

  function drain() {
    while (active < maxConcurrent && queue.length > 0) {
      const task = queue.shift();
      if (task.controller.signal.aborted) {
        void cleanup(task);
        continue;
      }
      active += 1;
      task.state = "building";
      Promise.resolve()
        .then(() => task.build(task.controller.signal))
        .then((archivePath) => {
          task.archivePath = archivePath;
          task.state = "ready";
          task.resolve(archivePath);
        }, (error) => {
          task.state = "failed";
          task.reject(error);
        })
        .finally(() => {
          active -= 1;
          if ((task.state === "failed" || task.leases.size === 0) && tasks.get(task.key) === task) void cleanup(task);
          drain();
        });
    }
  }

  function acquire(key, build, signal) {
    throwIfAborted(signal);
    let task = tasks.get(key);
    if (!task) {
      if (queue.length >= maxQueued && active >= maxConcurrent) {
        const error = new Error("Snapshot build queue is full");
        error.status = 503;
        error.code = "snapshot_build_queue_full";
        throw error;
      }
      let resolve;
      let reject;
      task = {
        key,
        build,
        controller: new AbortController(),
        leases: new Set(),
        state: "queued",
        archivePath: null,
        promise: new Promise((resolvePromise, rejectPromise) => {
          resolve = resolvePromise;
          reject = rejectPromise;
        }),
        resolve,
        reject,
      };
      tasks.set(key, task);
      queue.push(task);
      drain();
    }
    return new Promise((resolve, reject) => {
      const lease = { active: true };
      task.leases.add(lease);
      const release = async () => {
        if (!lease.active) return;
        lease.active = false;
        task.leases.delete(lease);
        signal?.removeEventListener("abort", onAbort);
        if (task.leases.size !== 0) return;
        if (task.state === "queued" || task.state === "building") task.controller.abort();
        if (task.state !== "building" && tasks.get(task.key) === task) await cleanup(task);
      };
      const onAbort = () => {
        void release();
        reject(createAbortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      task.promise.then(
        (archivePath) => {
          if (!lease.active) return;
          signal?.removeEventListener("abort", onAbort);
          resolve({ archivePath, release });
        },
        (error) => {
          if (!lease.active) return;
          void release();
          reject(error);
        },
      );
    });
  }

  return { acquire, tasks };
}

export { createSnapshotBuildCoordinator };
