import { promises as fs } from "node:fs";
import path from "node:path";

const specialFixturesDir = path.join(process.cwd(), "test", "fixtures", "special-sessions");

async function readSpecialSessionFixture(name) {
  const filePath = path.join(specialFixturesDir, name);
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export {
  readSpecialSessionFixture,
  specialFixturesDir,
};
