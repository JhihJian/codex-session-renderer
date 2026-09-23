import { formatIsoForTrace, limitText } from "./session-projection-shared.mjs";

// 技能节点是 Pi 会话中的持久化证据：<skill> 指令块表示技能指令已随用户消息注入上下文，
// SKILL.md 读取是普通工具调用，只在执行树里改用技能语义展示名称。
function skillDeclarationTraceNode(base, item) {
  const declaration = item.skillDeclaration;
  return {
    ...base,
    type: "skill",
    icon: "skill",
    label: "技能加载",
    title: declaration.name || "未命名 Skill",
    subtitle: [declaration.sourceFile || "SKILL.md", formatIsoForTrace(item.timestamp)].filter(Boolean).join(" · "),
    detail: {
      ...base.detail,
      note: "Pi 会话持久化的 <skill> 指令块证据：该技能指令已随用户消息注入上下文。",
    },
  };
}

function skillReadTraceTitle(item) {
  if (!item.skillRead) return null;
  return [item.skillRead.skillNameHint, item.skillRead.sourceFile || "SKILL.md"].filter(Boolean).join("/");
}

function compactTraceSkillDeclaration(declaration) {
  return {
    name: declaration.name || "未命名 Skill",
    sourceFile: declaration.sourceFile || "SKILL.md",
    instruction: limitText(declaration.instruction || ""),
    userText: limitText(declaration.userText || ""),
  };
}

function compactTraceSkillRead(read) {
  return {
    sourceFile: read.sourceFile || "SKILL.md",
    skillNameHint: read.skillNameHint || null,
  };
}

export { compactTraceSkillDeclaration, compactTraceSkillRead, skillDeclarationTraceNode, skillReadTraceTitle };
