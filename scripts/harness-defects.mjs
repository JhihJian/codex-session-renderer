import path from "node:path";
import { promises as fs } from "node:fs";
import { createHarnessDefectLab } from "../src/harness-defect-lab.mjs";
import { discoverHarnessCandidates } from "../src/harness-candidate-discovery.mjs";
import { runHarnessFixture } from "../src/harness-reproduction-runner.mjs";
import { validateSubagentResult } from "../src/harness-subagent-contracts.mjs";

try {
  const { command, options } = parseArguments(process.argv.slice(2));
  const lab = createHarnessDefectLab({ rootDir: options.lab });
  if (command === "archive") {
    const archive = await lab.archiveSession({
      sourcePath: options.source,
      sourceId: options["source-id"],
      sessionId: options.session,
    });
    print({ archive });
  } else if (command === "candidate") {
    const candidate = await lab.createCandidate({
      archiveId: options.archive,
      eventIndex: options.event,
      observation: options.observation,
      suspectedRule: options.rule,
    });
    print({ candidate });
  } else if (command === "run") {
    const fixturePath = requiredOption(options.fixture, "fixture");
    let result;
    try {
      const fixtureReference = portableFixtureReference(fixturePath);
      result = await runHarnessFixture(fixturePath, {
        command: replayCommand(fixtureReference),
        fixtureReference,
      });
    } catch (error) {
      print(await lab.rejectCandidate({ candidateId: options.candidate, fixturePath, reason: error.message }));
    }
    if (result) print(await lab.recordReproduction({ candidateId: options.candidate, fixture: result.fixture, comparison: result.comparison }));
  } else if (command === "scan") {
    print(await scanSource(lab, options));
  } else if (command === "scan-all") {
    print(await scanAll(lab, options));
  } else if (command === "dispatch") {
    print({ candidateId: requiredOption(options.candidate, "candidate"), task: requiredOption(options.task, "task"), state: "queued" });
  } else if (command === "ingest-agent-result") {
    const result = validateSubagentResult(JSON.parse(await (await import("node:fs/promises")).readFile(requiredOption(options.input, "input"), "utf8")));
    if (result.kind === "assertion") print(await lab.submitAssertion(result));
    else if (result.kind === "fixture") print(await lab.submitFixture(result));
    else if (result.kind === "review") print(await lab.recordBlindReview({ ...result, blind: true }));
    else print(await lab.recordEvidence({ candidateId: result.candidateId, kind: "agent_candidate", sha256: result.sourceHash, data: result }));
  } else if (command === "verify") {
    print({
      candidateId: requiredOption(options.candidate, "candidate"),
      status: "blocked",
      reason: "external_sandbox_backend_required",
      message: "CLI 不接受手工 epoch JSON；只能由受信任 sandbox backend 调用控制器写入执行证据。",
    });
  } else if (command === "decide") {
    print(await lab.decideCandidate({ candidateId: options.candidate, defectId: options.defect, title: options.title }));
  } else if (command === "audit") {
    print(await lab.audit());
  } else if (command === "replay") {
    print(await runHarnessFixture(requiredOption(options.fixture, "fixture")));

  } else if (command === "list") {
    print(await lab.list());
  } else {
    throw new Error(usage());
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function parseArguments(args) {
  const [command, ...rest] = args;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`无法识别的参数：${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (key === "dry-run") { options[key] = true; continue; }
    if (!key || !value || value.startsWith("--")) throw new Error(`参数 --${key} 缺少值。`);
    options[key] = value;
    index += 1;
  }
  return { command, options: { ...options, lab: path.resolve(options.lab || ".harness-defects") } };
}

function requiredOption(value, name) {
  if (!value) throw new Error(`参数 --${name} 不能为空。`);
  return value;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  return [
    "用法：",
    "  node scripts/harness-defects.mjs archive --source <session.jsonl> --source-id pi-agent --session <session-id> [--lab <dir>]",
    "  node scripts/harness-defects.mjs candidate --archive <archive-id> --event <index> --observation <text> --rule <text> [--lab <dir>]",
    "  node scripts/harness-defects.mjs run --candidate <candidate-id> --fixture <fixture.json> [--lab <dir>]",
    "  node scripts/harness-defects.mjs replay --fixture <fixture.json>",
    "  node scripts/harness-defects.mjs scan --source <session.jsonl> --source-id <id> --session <id> [--detector <id[,id]|all>] [--lab <dir>]",
    "  node scripts/harness-defects.mjs scan-all --root <sessions-dir> [--source-id <id>] [--detector <id[,id]|all>] [--dry-run] [--lab <dir>]",
    "  node scripts/harness-defects.mjs dispatch --candidate <id> --task <assertion|fixture|review> [--lab <dir>]",
    "  node scripts/harness-defects.mjs ingest-agent-result --input <result.json> [--lab <dir>]",
    "  node scripts/harness-defects.mjs verify --candidate <id> [--lab <dir>]",
    "  node scripts/harness-defects.mjs decide --candidate <id> --defect <id> --title <text> [--lab <dir>]",
    "  node scripts/harness-defects.mjs audit [--lab <dir>]",
    "  node scripts/harness-defects.mjs list [--lab <dir>]",
  ].join("\n");
}

async function scanSource(lab, options) {
  const archive = await lab.archiveSession({ sourcePath: requiredOption(options.source, "source"), sourceId: requiredOption(options["source-id"], "source-id"), sessionId: requiredOption(options.session, "session") });
  const discovery = await discoverHarnessCandidates({ archivePath: archive.archivePath, sourceHash: archive.sha256, detectorIds: options.detector || "all" });
  const registered = await lab.createCandidates({ archiveId: archive.id, candidates: discovery.matches });
  return { archive: { id: archive.id, sha256: archive.sha256 }, scan: scanSummary(discovery, registered), candidates: registered.candidates };
}

async function scanAll(lab, options) {
  const root = path.resolve(requiredOption(options.root, "root"));
  const files = await jsonlFiles(root);
  const summary = { root, dryRun: options["dry-run"] === true, filesDiscovered: files.length, filesScanned: 0, filesFailed: 0, eventsScanned: 0, invalidLines: 0, matches: 0, created: 0, deduped: 0, detectorMatches: {}, failures: [] };
  for (const sourcePath of files) {
    try {
      const result = summary.dryRun
        ? { scan: scanSummary(await discoverHarnessCandidates({ archivePath: sourcePath, detectorIds: options.detector || "all" })) }
        : await scanSource(lab, { ...options, source: sourcePath, "source-id": options["source-id"] || "pi-agent", session: sessionIdFromPath(sourcePath) });
      summary.filesScanned += 1;
      for (const key of ["eventsScanned", "invalidLines", "matches", "created", "deduped"]) summary[key] += result.scan[key];
      for (const detector of result.scan.detectors) summary.detectorMatches[detector.id] = (summary.detectorMatches[detector.id] || 0) + result.scan.matchesByDetector[detector.id];
    } catch (error) {
      summary.filesFailed += 1;
      summary.failures.push({ file: path.relative(root, sourcePath), error: String(error.message) });
    }
  }
  return summary;
}

function scanSummary(discovery, registered = { created: 0, deduped: 0 }) {
  const matchesByDetector = Object.fromEntries(discovery.detectors.map((detector) => [detector.id, 0]));
  for (const match of discovery.matches) matchesByDetector[match.detectorId] += 1;
  return { eventsScanned: discovery.eventsScanned, invalidLines: discovery.invalidLines, detectors: discovery.detectors, matches: discovery.matches.length, created: registered.created, deduped: registered.deduped, matchesByDetector };
}

async function jsonlFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await jsonlFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(target);
  }
  return files.sort();
}

function sessionIdFromPath(sourcePath) {
  const name = path.basename(sourcePath, ".jsonl");
  return name.includes("_") ? name.slice(name.lastIndexOf("_") + 1) : name;
}

function replayCommand(fixtureReference) {
  return `npm run harness:defects -- replay --fixture ${shellQuote(fixtureReference)}`;
}

function portableFixtureReference(fixturePath) {
  const relative = path.relative(process.cwd(), path.resolve(fixturePath));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("登记 confirmed 前，fixture 必须位于当前仓库目录中。");
  }
  return relative.split(path.sep).join("/");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}