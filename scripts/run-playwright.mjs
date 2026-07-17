import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [path.join(projectRoot, "node_modules", "playwright", "cli.js"), ...args], {
  cwd: projectRoot,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" },
  stdio: "inherit",
});

process.exitCode = result.status ?? 1;