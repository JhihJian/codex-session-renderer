import path from "node:path";
import { normalizeEventTimestamp } from "./session-normalizer.mjs";

function normalizeSlash(value) {
  return value.replaceAll("\\", "/");
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fileTimeMs(file) {
  return file?.mtimeMs ?? 0;
}

function eventTime(event) {
  return normalizeEventTimestamp(event);
}

function sessionIdFromFile(filePath) {
  const name = path.basename(normalizeSlash(filePath), ".jsonl");
  const match = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1] ?? name;
}

function sessionStartedFromFile(filePath) {
  const name = path.basename(normalizeSlash(filePath), ".jsonl");
  const match = name.match(/^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-/);
  if (match) return `${match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3")}.000Z`;
  const piMatch = name.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/);
  if (piMatch) return `${piMatch[1]}:${piMatch[2]}:${piMatch[3]}.${piMatch[4]}Z`;
  return null;
}

function firstLine(text, max = 120) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function extractContentText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.text != null) return part.text;
      if (part?.type === "input_text" || part?.type === "output_text") return part.text ?? "";
      if (part?.image_url) return `[image] ${part.image_url}`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export {
  eventTime,
  extractContentText,
  fileTimeMs,
  firstLine,
  normalizeSlash,
  normalizeText,
  sessionIdFromFile,
  sessionStartedFromFile,
  toIso,
};
