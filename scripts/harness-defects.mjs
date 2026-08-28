import path from "node:path";
import { createHarnessDefectLab } from "../src/harness-defect-lab.mjs";
import { runHarnessFixture } from "../src/harness-reproduction-runner.mjs";

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
    "  node scripts/harness-defects.mjs list [--lab <dir>]",
  ].join("\n");
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