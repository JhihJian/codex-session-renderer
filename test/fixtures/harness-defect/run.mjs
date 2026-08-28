import { promises as fs } from "node:fs";

const config = JSON.parse(process.env.HARNESS_DEFECT_CONFIG || "{}");
const variant = process.env.HARNESS_DEFECT_VARIANT || "unknown";
const workdir = process.env.HARNESS_DEFECT_WORKDIR || ".";

await fs.writeFile(`${workdir}/execution.json`, JSON.stringify({ variant, config }), "utf8");
process.stdout.write(`${JSON.stringify({
  trace: config.failed === true ? [{ type: "tool_execution_end", variant }] : [],
})}\n`);