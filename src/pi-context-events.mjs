function piSkillDeclarationFromEvent(event) {
  if (event?.rawType !== "message" || event?.role !== "user") return null;
  return parsePiSkillInstruction(String(event.text || ""));
}

function parsePiSkillInstruction(text) {
  const source = String(text || "");
  const opening = /^\s*<skill\s+([^>]+)>/.exec(source);
  if (!opening) return null;
  const name = attributeValue(opening[1], "name");
  const location = attributeValue(opening[1], "location");
  if (!name || !location) return null;
  const closingOffset = source.indexOf("</skill>", opening[0].length);
  if (closingOffset < 0) return null;
  const instruction = source.slice(opening[0].length, closingOffset).trim();
  const userText = source.slice(closingOffset + "</skill>".length).trim();
  return {
    name,
    instruction,
    userText,
    sourceFile: "SKILL.md",
    locationKey: normalizePath(location),
  };
}

function piSkillReadFromToolCall(name, argumentsText) {
  if (String(name || "") !== "read") return null;
  const args = parseObject(argumentsText);
  const location = typeof args.path === "string" ? args.path : "";
  const normalized = normalizePath(location);
  if (!normalized || normalized.split("/").at(-1)?.toLowerCase() !== "skill.md") return null;
  return {
    sourceFile: "SKILL.md",
    skillNameHint: normalized.split("/").at(-2) || null,
    locationKey: normalized,
  };
}

function attributeValue(attributes, name) {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]+)"(?:\\s|$)`).exec(attributes);
  return match?.[1]?.trim() || "";
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePath(value) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

export {
  parsePiSkillInstruction,
  piSkillDeclarationFromEvent,
  piSkillReadFromToolCall,
};