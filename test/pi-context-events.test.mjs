import test from "node:test";
import assert from "node:assert/strict";
import { parsePiSkillInstruction, piSkillDeclarationFromEvent, piSkillReadFromToolCall } from "../src/pi-context-events.mjs";

test("Pi Skill 指令块只接受带名称和位置的完整开闭标签", () => {
  const declaration = parsePiSkillInstruction('<skill name="release-check" location="/home/user/.pi/agent/skills/release-check/SKILL.md">\n执行发布检查。\n</skill>\n\n检查当前分支。');
  assert.deepEqual(declaration, {
    name: "release-check",
    instruction: "执行发布检查。",
    userText: "检查当前分支。",
    sourceFile: "SKILL.md",
    locationKey: "/home/user/.pi/agent/skills/release-check/SKILL.md",
  });
  assert.equal(parsePiSkillInstruction('<skill name="release-check">内容</skill>'), null);
  assert.equal(parsePiSkillInstruction('前缀 <skill name="release-check" location="/x/SKILL.md">内容</skill>'), null);
  assert.equal(piSkillDeclarationFromEvent({ rawType: "message", role: "assistant", text: declaration.instruction }), null);
});

test("Pi Skill 文件读取仅识别 read 工具的 SKILL.md 路径", () => {
  assert.deepEqual(piSkillReadFromToolCall("read", '{"path":"/data/dev/project/.agents/skills/release-check/SKILL.md"}'), {
    sourceFile: "SKILL.md",
    skillNameHint: "release-check",
    locationKey: "/data/dev/project/.agents/skills/release-check/SKILL.md",
  });
  assert.equal(piSkillReadFromToolCall("bash", '{"path":"/data/dev/project/SKILL.md"}'), null);
  assert.equal(piSkillReadFromToolCall("read", '{"path":"/data/dev/project/README.md"}'), null);
  assert.equal(piSkillReadFromToolCall("read", "not json"), null);
});