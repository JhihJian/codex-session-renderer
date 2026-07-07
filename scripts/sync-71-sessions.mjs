#!/usr/bin/env node
import { createWriteStream, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const defaultTarget = "/home/jhihjian/.codex-session-renderer/source-snapshots/dev71/.codex";
const defaultRemoteHome = "/root/.codex";
const syncStateFile = ".codex-session-renderer-71-sync.json";
const defaultOutputCapBytes = 1024 * 1024;
const defaultChunkBytes = 512 * 1024;
const defaultMaxBatchBytes = 600 * 1024;

function usage() {
  console.log(`Usage:
  node scripts/sync-71-sessions.mjs [options]

Options:
  --target <path>           Local Codex Home snapshot path. Default: ${defaultTarget}
  --remote-home <path>      Remote Codex Home. Default: ${defaultRemoteHome}
  --runner <command>        Remote helper command. Default: codex-remote-run
  --token-env <name>        Token env passed to helper. Default: CODEX_REMOTE_TOKEN
  --login-shell <mode>      auto | always | never. Default: always
  --max-batch-bytes <n>     Max raw file bytes per tar/base64 batch. Default: ${defaultMaxBatchBytes}
  --chunk-bytes <n>         Chunk size for files larger than one batch. Default: ${defaultChunkBytes}
  --limit <n>               Sync only first N session files from the remote manifest.
  --skip-state-db           Do not sync state_5.sqlite. Useful for partial tests.
  --no-delete               Do not remove local files missing from the remote manifest.
  --dry-run                 Print the plan without downloading.
  --refresh                 POST renderer refresh endpoint after publish.
  --renderer-url <url>      Renderer base URL for --refresh. Default: http://127.0.0.1:4789
  --source-id <id>          Renderer source id for --refresh. Default: dev71
  --verbose                 Print each batch/chunk command progress.
  -h, --help                Show this help.

Examples:
  node scripts/sync-71-sessions.mjs --refresh
  node scripts/sync-71-sessions.mjs --limit 20 --skip-state-db --target /tmp/dev71-test/.codex
`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    target: process.env.CODEX_71_SNAPSHOT_PATH || defaultTarget,
    remoteHome: process.env.CODEX_71_REMOTE_HOME || defaultRemoteHome,
    runner: process.env.CODEX_71_REMOTE_RUNNER || "codex-remote-run",
    tokenEnv: process.env.CODEX_71_TOKEN_ENV || "CODEX_REMOTE_TOKEN",
    loginShell: process.env.CODEX_71_LOGIN_SHELL || "always",
    maxBatchBytes: Number(process.env.CODEX_71_MAX_BATCH_BYTES || defaultMaxBatchBytes),
    outputCapBytes: Number(process.env.CODEX_71_OUTPUT_CAP_BYTES || defaultOutputCapBytes),
    chunkBytes: Number(process.env.CODEX_71_CHUNK_BYTES || defaultChunkBytes),
    limit: null,
    includeStateDb: true,
    deleteMissing: true,
    dryRun: false,
    refresh: false,
    rendererUrl: process.env.CODEX_SESSION_RENDERER_URL || "http://127.0.0.1:4789",
    sourceId: process.env.CODEX_REMOTE_71_SOURCE_ID || "dev71",
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--target") {
      options.target = next();
    } else if (arg === "--remote-home") {
      options.remoteHome = next();
    } else if (arg === "--runner") {
      options.runner = next();
    } else if (arg === "--token-env") {
      options.tokenEnv = next();
    } else if (arg === "--login-shell") {
      options.loginShell = next();
    } else if (arg === "--max-batch-bytes") {
      options.maxBatchBytes = Number(next());
    } else if (arg === "--output-cap-bytes") {
      options.outputCapBytes = Number(next());
    } else if (arg === "--chunk-bytes") {
      options.chunkBytes = Number(next());
    } else if (arg === "--limit") {
      options.limit = Number(next());
    } else if (arg === "--skip-state-db") {
      options.includeStateDb = false;
    } else if (arg === "--no-delete") {
      options.deleteMissing = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--refresh") {
      options.refresh = true;
    } else if (arg === "--renderer-url") {
      options.rendererUrl = next();
    } else if (arg === "--source-id") {
      options.sourceId = next();
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!["auto", "always", "never"].includes(options.loginShell)) {
    throw new Error("--login-shell must be auto, always, or never");
  }
  for (const name of ["maxBatchBytes", "outputCapBytes", "chunkBytes"]) {
    if (!Number.isFinite(options[name]) || options[name] <= 0) {
      throw new Error(`${name} must be a positive number`);
    }
  }
  if (options.chunkBytes * 4 / 3 > options.outputCapBytes * 0.9) {
    throw new Error("--chunk-bytes is too large for the configured output cap");
  }
  if (options.limit != null && (!Number.isFinite(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive number");
  }
  options.target = path.resolve(options.target);
  options.rendererUrl = options.rendererUrl.replace(/\/+$/, "");
  return options;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function shellCommand(args) {
  return args.map(shellQuote).join(" ");
}

async function remoteExec(command, options) {
  const useLoginShell =
    options.loginShell === "always" ||
    (options.loginShell === "auto" && !process.env[options.tokenEnv]);
  const args = ["--quiet", "--token-env", options.tokenEnv, "--exec", command];
  const maxBuffer = Math.max(options.outputCapBytes * 4, 8 * 1024 * 1024);
  if (useLoginShell) {
    const loginCommand = `:; ${shellCommand([options.runner, ...args])}`;
    return runTextCommand("bash", ["-ilc", loginCommand], { maxBuffer });
  }
  return runTextCommand(options.runner, args, { maxBuffer });
}

function runTextCommand(command, args, options = {}) {
  const maxBuffer = options.maxBuffer || 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    function collect(chunks, streamName, chunk) {
      const nextSize = streamName === "stdout" ? stdoutBytes + chunk.length : stderrBytes + chunk.length;
      if (nextSize > maxBuffer) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`${streamName} exceeded ${maxBuffer} bytes`));
        return;
      }
      chunks.push(chunk);
      if (streamName === "stdout") stdoutBytes = nextSize;
      else stderrBytes = nextSize;
    }
    child.stdout.on("data", (chunk) => collect(stdoutChunks, "stdout", chunk));
    child.stderr.on("data", (chunk) => collect(stderrChunks, "stderr", chunk));
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

function remoteManifestCommand(remoteHome, includeStateDb = true) {
  const metadata = includeStateDb ? "state_5.sqlite session_index.jsonl" : "session_index.jsonl";
  return [
    "set -e",
    `cd ${shellQuote(remoteHome)}`,
    `for f in ${metadata}; do if [ -f "$f" ]; then stat -c '%s\\t%Y\\t%n' "$f"; fi; done`,
    "if [ -d sessions ]; then find sessions -type f -name '*.jsonl' -printf '%s\\t%T@\\t%p\\n' 2>/dev/null; fi",
  ].join("; ");
}

function parseManifest(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sizeText, mtimeText, ...pathParts] = line.split("\t");
      const relativePath = pathParts.join("\t");
      return {
        relativePath,
        size: Number(sizeText),
        mtime: Number(mtimeText),
      };
    })
    .filter((entry) => isAllowedRemotePath(entry.relativePath) && Number.isFinite(entry.size) && Number.isFinite(entry.mtime));
}

function isAllowedRemotePath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) return false;
  const normalized = relativePath.split(/[\\/]+/).join("/");
  if (normalized.includes("../") || normalized === "..") return false;
  return normalized === "state_5.sqlite" || normalized === "session_index.jsonl" || /^sessions\/.+\.jsonl$/.test(normalized);
}

function normalizeRemotePath(relativePath) {
  return String(relativePath || "").split(/[\\/]+/).filter(Boolean).join("/");
}

async function readLocalState(target) {
  try {
    const statePath = path.join(target, syncStateFile);
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    return { files: {} };
  }
}

function planSync(remoteFiles, localState, options = {}) {
  const previous = localState?.files || {};
  const remoteByPath = new Map(remoteFiles.map((entry) => [normalizeRemotePath(entry.relativePath), entry]));
  const changed = [];
  for (const entry of remoteFiles) {
    const relativePath = normalizeRemotePath(entry.relativePath);
    const old = previous[relativePath];
    if (!old || Number(old.size) !== entry.size || Number(old.mtime) !== entry.mtime) {
      changed.push({ ...entry, relativePath });
    }
  }
  const deleted = [];
  if (options.deleteMissing !== false) {
    for (const relativePath of Object.keys(previous)) {
      if (isAllowedRemotePath(relativePath) && !remoteByPath.has(normalizeRemotePath(relativePath))) {
        deleted.push(normalizeRemotePath(relativePath));
      }
    }
  }
  const smallFiles = [];
  const largeFiles = [];
  for (const entry of changed) {
    if (entry.size > options.maxBatchBytes) largeFiles.push(entry);
    else smallFiles.push(entry);
  }
  return {
    changed,
    deleted,
    smallFiles,
    largeFiles,
    batches: makeBatches(smallFiles, options.maxBatchBytes),
  };
}

function makeBatches(files, maxBatchBytes = defaultMaxBatchBytes) {
  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const file of files) {
    if (current.length > 0 && currentBytes + file.size > maxBatchBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function copyTreeWithHardlinks(from, to) {
  if (!(await pathExists(from))) return;
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTreeWithHardlinks(source, target);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.link(source, target);
      } catch {
        await fs.copyFile(source, target);
      }
    }
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function extractTarGzBase64(base64Text, targetDir) {
  const archive = Buffer.from(String(base64Text || "").replace(/\s+/g, ""), "base64");
  if (archive.length === 0) throw new Error("remote archive output was empty");
  await runTarExtract(archive, targetDir);
}

function runTarExtract(archive, targetDir) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xzf", "-", "-C", targetDir], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar exited with ${code}`));
    });
    child.stdin.end(archive);
  });
}

async function fetchBatch(batch, stagingPath, options) {
  const fileList = batch.map((entry) => normalizeRemotePath(entry.relativePath)).join("\n");
  const encodedList = Buffer.from(`${fileList}\n`, "utf8").toString("base64");
  const command = [
    "set -e",
    "tmp=$(mktemp)",
    `printf %s ${shellQuote(encodedList)} | base64 -d > "$tmp"`,
    `cd ${shellQuote(options.remoteHome)}`,
    'tar -czf - -T "$tmp" | base64 -w0',
    'rm -f "$tmp"',
  ].join("; ");
  const { stdout } = await remoteExec(command, options);
  assertNotTruncated(stdout, options, `batch containing ${batch.length} files`);
  await extractTarGzBase64(stdout, stagingPath);
}

async function fetchLargeFile(entry, stagingPath, options) {
  const relativePath = normalizeRemotePath(entry.relativePath);
  const targetPath = path.join(stagingPath, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rm(targetPath, { force: true });
  const chunks = Math.ceil(entry.size / options.chunkBytes);
  for (let index = 0; index < chunks; index += 1) {
    if (options.verbose) {
      console.error(`[sync71] chunk ${index + 1}/${chunks} ${relativePath}`);
    }
    const command = [
      "set -e",
      `cd ${shellQuote(options.remoteHome)}`,
      `dd if=${shellQuote(relativePath)} bs=${Number(options.chunkBytes)} skip=${index} count=1 status=none | base64 -w0`,
    ].join("; ");
    const { stdout } = await remoteExec(command, options);
    assertNotTruncated(stdout, options, `${relativePath} chunk ${index + 1}/${chunks}`);
    const chunk = Buffer.from(String(stdout || "").replace(/\s+/g, ""), "base64");
    if (chunk.length === 0 && index < chunks - 1) {
      throw new Error(`empty chunk while downloading ${relativePath}`);
    }
    await pipeline(Readable.from(chunk), createWriteStream(targetPath, { flags: "a" }));
  }
  const stat = await fs.stat(targetPath);
  if (stat.size !== entry.size) {
    throw new Error(`downloaded size mismatch for ${relativePath}: expected ${entry.size}, got ${stat.size}`);
  }
}

function assertNotTruncated(stdout, options, label) {
  const byteLength = Buffer.byteLength(String(stdout || ""), "utf8");
  if (byteLength >= options.outputCapBytes - 16) {
    throw new Error(`${label} reached remote output cap (${byteLength} bytes); lower --max-batch-bytes or --chunk-bytes`);
  }
}

async function removeDeleted(stagingPath, deleted) {
  for (const relativePath of deleted) {
    await fs.rm(path.join(stagingPath, ...normalizeRemotePath(relativePath).split("/")), { force: true });
  }
}

function stateFromManifest(remoteFiles, options) {
  const files = {};
  for (const entry of remoteFiles) {
    const relativePath = normalizeRemotePath(entry.relativePath);
    files[relativePath] = {
      size: entry.size,
      mtime: entry.mtime,
    };
  }
  return {
    version: 1,
    remoteHome: options.remoteHome,
    syncedAt: new Date().toISOString(),
    files,
  };
}

async function writeSyncState(stagingPath, remoteFiles, options) {
  await fs.writeFile(path.join(stagingPath, syncStateFile), `${JSON.stringify(stateFromManifest(remoteFiles, options), null, 2)}\n`, "utf8");
}

async function publishStaging(stagingPath, targetPath) {
  const parent = path.dirname(targetPath);
  const previousPath = path.join(parent, `.previous-${path.basename(targetPath)}-${Date.now()}`);
  await fs.rm(previousPath, { recursive: true, force: true });
  if (await pathExists(targetPath)) {
    await fs.rename(targetPath, previousPath);
  }
  try {
    await fs.rename(stagingPath, targetPath);
  } catch (error) {
    if (await pathExists(previousPath)) {
      await fs.rename(previousPath, targetPath).catch(() => {});
    }
    throw error;
  }
  await fs.rm(previousPath, { recursive: true, force: true });
}

async function refreshRenderer(options) {
  const url = `${options.rendererUrl}/api/sources/${encodeURIComponent(options.sourceId)}/refresh`;
  const response = await fetch(url, { method: "POST" });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`renderer refresh failed: HTTP ${response.status} ${body.slice(0, 240)}`);
  }
  return body;
}

async function sync71(options) {
  const targetPath = options.target;
  const parent = path.dirname(targetPath);
  const stagingPath = path.join(parent, `.staging-${path.basename(targetPath)}-${Date.now()}-${process.pid}`);
  await fs.mkdir(parent, { recursive: true });

  console.error(`[sync71] reading remote manifest from ${options.remoteHome}`);
  const { stdout } = await remoteExec(remoteManifestCommand(options.remoteHome, options.includeStateDb), options);
  let remoteFiles = parseManifest(stdout);
  remoteFiles.sort((a, b) => normalizeRemotePath(a.relativePath).localeCompare(normalizeRemotePath(b.relativePath)));

  if (options.limit != null) {
    const metadata = remoteFiles.filter((entry) => !normalizeRemotePath(entry.relativePath).startsWith("sessions/"));
    const sessions = remoteFiles
      .filter((entry) => normalizeRemotePath(entry.relativePath).startsWith("sessions/"))
      .toSorted((a, b) => b.mtime - a.mtime)
      .slice(0, options.limit)
      .toSorted((a, b) => normalizeRemotePath(a.relativePath).localeCompare(normalizeRemotePath(b.relativePath)));
    remoteFiles = [...metadata, ...sessions];
  }

  const localState = await readLocalState(targetPath);
  const plan = planSync(remoteFiles, localState, options);
  const summary = {
    remoteFiles: remoteFiles.length,
    changed: plan.changed.length,
    deleted: plan.deleted.length,
    batches: plan.batches.length,
    largeFiles: plan.largeFiles.length,
    target: targetPath,
  };
  console.error(`[sync71] plan ${JSON.stringify(summary)}`);

  if (options.dryRun) return { ...summary, dryRun: true };

  await fs.rm(stagingPath, { recursive: true, force: true });
  await copyTreeWithHardlinks(targetPath, stagingPath);
  await fs.mkdir(stagingPath, { recursive: true });

  try {
    await removeDeleted(stagingPath, plan.deleted);
    for (let index = 0; index < plan.batches.length; index += 1) {
      const batch = plan.batches[index];
      if (options.verbose) {
        const bytes = batch.reduce((sum, entry) => sum + entry.size, 0);
        console.error(`[sync71] batch ${index + 1}/${plan.batches.length} files=${batch.length} bytes=${bytes}`);
      }
      await fetchBatch(batch, stagingPath, options);
    }
    for (const entry of plan.largeFiles) {
      await fetchLargeFile(entry, stagingPath, options);
    }
    await writeSyncState(stagingPath, remoteFiles, options);
    await publishStaging(stagingPath, targetPath);
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  let refreshResult = null;
  if (options.refresh) {
    refreshResult = await refreshRenderer(options);
    console.error(`[sync71] renderer refresh ok for ${options.sourceId}`);
  }
  return { ...summary, refreshResult };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    usage();
    return;
  }
  const result = await sync71(options);
  console.log(JSON.stringify(result, null, 2));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(`sync-71-sessions: ${error.message || error}`);
    process.exitCode = 1;
  });
}

export {
  makeBatches,
  normalizeRemotePath,
  parseArgs,
  parseManifest,
  planSync,
  remoteManifestCommand,
  shellQuote,
  stateFromManifest,
  sync71,
};
