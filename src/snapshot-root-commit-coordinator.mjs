import path from "node:path";

function createSnapshotRootCommitCoordinator() {
  const activeRoots = new Set();

  function run(snapshotRoot, operation) {
    const root = path.resolve(snapshotRoot);
    if (activeRoots.has(root)) throw new Error(`Snapshot root commit re-entered: ${root}`);
    activeRoots.add(root);
    try {
      const result = operation();
      if (result?.then) throw new Error("Snapshot root commit must not yield.");
      return result;
    } finally {
      activeRoots.delete(root);
    }
  }

  return { run };
}

export { createSnapshotRootCommitCoordinator };