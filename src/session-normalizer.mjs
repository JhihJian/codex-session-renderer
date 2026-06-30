import { isToolCallOutput, isToolCallStart, mergeToolOutput, toolArgumentsFromPayload, toolNameFromPayload, toolOutputFromPayload } from "./tool-events.mjs";

const timeKeys = ["timestamp", "time", "ts", "created", "created_at", "datetime", "date", "event_time", "when", "at"];
const dataUriPattern = /data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)?(?:;[^,]*)?,[A-Za-z0-9+/=._~%-]+/g;

function normalizeSessionEvent(rawEvent, index = null) {
  if (rawEvent?.__normalized) return rawEvent;
  if (rawEvent?.__jsonlDiagnostic) return normalizeDiagnosticEvent(rawEvent, index);

  const raw = isObject(rawEvent) ? rawEvent : {};
  const payload = eventPayload(raw);
  const rawType = stringOrNull(raw.type);
  const payloadType = stringOrNull(payload.type);
  const role = stringOrNull(payload.role ?? raw.role);
  const kind = classifyNormalizedKind({ rawType, payloadType, role });
  const semanticKind = semanticKindFor({ kind, role });
  const textParts = extractTextParts(payload, raw);
  const attachments = extractAttachments(payload, raw);
  const reasoning = extractReasoning(payload, raw, semanticKind);
  const toolName = semanticKind === "tool_call" || semanticKind === "tool_result" ? toolNameFromPayload(payload) : null;
  const toolInput = semanticKind === "tool_call" ? stringifyMaybe(toolArgumentsFromPayload(payload)) : null;
  const toolOutput = semanticKind === "tool_result" ? stringifyMaybe(toolOutputFromPayload(payload)) : null;
  const text = textParts.join("\n\n");
  const messageId = stringOrNull(raw.message_id ?? raw.id ?? payload.message_id ?? payload.id);
  const parentId = stringOrNull(raw.parent_id ?? payload.parent_id);
  const hasDeltaIndex = raw.delta_index != null || payload.delta_index != null;
  const isDelta = Boolean(raw.delta ?? raw.chunk ?? payload.delta ?? payload.chunk ?? hasDeltaIndex);

  const normalized = {
    ...raw,
    __normalized: true,
    index,
    raw,
    payload,
    rawType,
    payloadType,
    kind,
    semanticKind,
    role,
    timestamp: normalizeEventTimestamp(raw),
    messageId,
    parentId,
    callId: stringOrNull(payload.call_id ?? raw.call_id ?? payload.id ?? raw.id),
    isDelta,
    deltaIndex: numberOrNull(raw.delta_index ?? payload.delta_index),
    text,
    textParts,
    toolName,
    toolInput,
    toolOutput,
    attachments,
    reasoning,
    encrypted: Boolean(reasoning?.encrypted),
    payloadSize: safeJsonLength(raw.payload ?? null),
    rawSize: safeJsonLength(raw),
  };
  normalized.searchText = buildSearchText(normalized);
  return normalized;
}

function normalizeDiagnosticEvent(rawEvent, index = null) {
  const payload = rawEvent.payload ?? {};
  const preview = redactSensitiveText(payload.preview || "");
  return {
    ...rawEvent,
    __normalized: true,
    index: index ?? rawEvent.index ?? null,
    raw: rawEvent,
    rawType: rawEvent.type || "jsonl_parse_error",
    payload,
    payloadType: payload.type || "jsonl_parse_error",
    kind: "jsonl_parse_error",
    semanticKind: "diagnostic",
    role: null,
    timestamp: null,
    messageId: null,
    parentId: null,
    callId: null,
    isDelta: false,
    deltaIndex: null,
    text: preview,
    textParts: preview ? [preview] : [],
    toolName: null,
    toolInput: null,
    toolOutput: null,
    attachments: [],
    reasoning: null,
    encrypted: false,
    payloadSize: safeJsonLength(payload),
    rawSize: safeJsonLength(rawEvent),
    diagnostic: {
      lineNumber: payload.lineNumber ?? rawEvent.lineNumber ?? null,
      code: payload.code || "invalid-json",
      message: payload.message || "Invalid JSONL row",
      preview,
    },
    searchText: ["jsonl_parse_error", payload.lineNumber, preview].filter(Boolean).join("\n"),
  };
}

function coalesceNormalizedEvents(events) {
  const normalized = events.map((event, index) => normalizeSessionEvent(event, event?.index ?? index));
  const result = [];
  const lastDeltaByMessage = new Map();

  for (const event of normalized) {
    if (shouldCoalesceMessageDelta(event)) {
      const key = `${event.messageId}:${event.role || ""}:${event.kind}`;
      const previous = lastDeltaByMessage.get(key);
      if (previous) {
        previous.text = mergeText(previous.text, event.text);
        previous.textParts.push(...event.textParts);
        previous.attachments.push(...event.attachments);
        previous.sourceIndexes.push(event.index);
        previous.rawEvents.push(event.raw);
        previous.timestamp = previous.timestamp || event.timestamp;
        previous.completedAt = event.timestamp || previous.completedAt || null;
        previous.searchText = buildSearchText(previous);
        continue;
      }
      const clone = {
        ...event,
        sourceIndexes: [event.index],
        rawEvents: [event.raw],
      };
      result.push(clone);
      lastDeltaByMessage.set(key, clone);
      continue;
    }
    result.push(event);
  }

  return result;
}

function shouldCoalesceMessageDelta(event) {
  return Boolean(event.isDelta && event.messageId && event.semanticKind === "message");
}

function mergeText(previous, next) {
  if (!previous) return next || "";
  if (!next) return previous;
  return `${previous}${next}`;
}

function eventPayload(raw) {
  if (isObject(raw.payload)) return raw.payload;
  return raw;
}

function classifyNormalizedKind({ rawType, payloadType, role }) {
  if (rawType === "session_meta") return "meta";
  if (rawType === "turn_context") return "context";
  if (rawType === "jsonl_parse_error") return "jsonl_parse_error";
  const sourceType = rawType === "event_msg" || rawType === "response_item" ? payloadType : payloadType || rawType;
  if (sourceType) return compatKind(sourceType, role);
  if (role === "user") return "user_message";
  if (role === "assistant") return "agent_message";
  if (role === "system" || role === "developer") return "meta";
  return "unknown";
}

function compatKind(type, role) {
  if (type === "function_result" || type === "tool_result") return "function_call_output";
  if (type === "tool_call") return "function_call";
  if (type === "system") return "meta";
  if (type === "user") return "user_message";
  if (type === "assistant") return "agent_message";
  if (type === "message" && role === "user") return "message";
  if (type === "message" && role === "assistant") return "message";
  return type;
}

function semanticKindFor({ kind, role }) {
  if (kind === "jsonl_parse_error") return "diagnostic";
  if (isToolCallStart(kind)) return "tool_call";
  if (isToolCallOutput(kind)) return "tool_result";
  if (kind === "reasoning") return "reasoning";
  if (role === "system" || role === "developer" || kind === "meta") return "meta";
  if (kind === "user_message" || kind === "agent_message" || kind === "message" || role === "user" || role === "assistant") return "message";
  return "event";
}

function normalizeEventTimestamp(event) {
  for (const container of [event, event?.payload].filter(isObject)) {
    for (const key of timeKeys) {
      const iso = normalizeTimestampValue(container[key]);
      if (iso) return iso;
    }
  }
  return null;
}

function normalizeTimestampValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return normalizeEpoch(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return normalizeEpoch(Number(trimmed));
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function normalizeEpoch(value) {
  if (!Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  let ms = value;
  if (abs < 1e11) ms = value * 1000;
  else if (abs >= 1e15) ms = value / 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractTextParts(payload, raw) {
  const parts = [];
  const push = (value) => {
    if (value == null) return;
    const text = redactSensitiveText(String(value));
    if (text) parts.push(text);
  };

  if (payload.type === "reasoning") {
    if (Array.isArray(payload.summary)) {
      for (const part of payload.summary) push(part?.text ?? part?.value ?? (typeof part === "string" ? part : ""));
    }
    return parts;
  }

  if (Array.isArray(payload.content)) {
    for (const part of payload.content) {
      if (typeof part === "string") push(part);
      else if (isObject(part)) push(part.text ?? part.value ?? (part.type === "input_text" || part.type === "output_text" ? part.text : ""));
    }
  } else if (payload.content != null && typeof payload.content !== "object") {
    push(payload.content);
  }

  for (const key of ["text", "message", "value", "last_agent_message"]) push(payload[key]);
  if (payload !== raw) {
    for (const key of ["text", "message", "value"]) push(raw[key]);
  }

  return [...new Set(parts)];
}

function extractReasoning(payload, raw, semanticKind) {
  const source = payload.type === "reasoning" ? payload : isObject(raw.reasoning) ? raw.reasoning : null;
  if (!source && semanticKind !== "reasoning") return null;
  const encryptedContent = source?.encrypted_content ?? payload.encrypted_content ?? raw.encrypted_content;
  const summary = Array.isArray(source?.summary)
    ? source.summary.map((part) => part?.text ?? part?.value ?? (typeof part === "string" ? part : "")).filter(Boolean).join("\n")
    : "";
  return {
    encrypted: encryptedContent != null,
    encryptedLength: encryptedContent == null ? 0 : String(encryptedContent).length,
    summary,
  };
}

function extractAttachments(payload, raw) {
  const attachments = [];
  const pushImage = (value, source) => {
    const image = normalizeImageReference(value, source);
    if (image) attachments.push(image);
  };

  if (Array.isArray(payload.content)) {
    for (const part of payload.content) {
      if (!isObject(part)) continue;
      if (part.image_url != null) pushImage(part.image_url, "content.image_url");
      if (part.image_file != null) pushImage(part.image_file, "content.image_file");
      if (part.type === "input_image" && part.url) pushImage(part.url, "content.url");
    }
  }

  for (const [key, source] of [
    ["image_url", "payload.image_url"],
    ["image_file", "payload.image_file"],
    ["images", "payload.images"],
    ["local_images", "payload.local_images"],
    ["attachments", "payload.attachments"],
  ]) {
    collectAttachmentValues(payload[key]).forEach((value) => pushImage(value, source));
  }
  if (payload !== raw) {
    for (const key of ["image_url", "image_file", "images", "local_images", "attachments"]) {
      collectAttachmentValues(raw[key]).forEach((value) => pushImage(value, `raw.${key}`));
    }
  }

  return attachments;
}

function collectAttachmentValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function normalizeImageReference(value, source) {
  if (typeof value === "string") return normalizeImageUrl(value, source);
  if (!isObject(value)) return null;
  if (value.url) return normalizeImageUrl(value.url, source);
  const fileId = value.file_id || value.id;
  if (fileId) {
    return {
      kind: "file",
      source,
      fileId: String(fileId),
      label: `file image ${String(fileId).slice(0, 24)}`,
    };
  }
  if (value.path) {
    return {
      kind: "file",
      source,
      path: String(value.path),
      label: `local image ${String(value.path).split(/[\\/]/).pop() || "file"}`,
    };
  }
  return {
    kind: "unknown",
    source,
    label: "image attachment",
  };
}

function normalizeImageUrl(urlValue, source) {
  const url = String(urlValue || "");
  const data = parseDataUri(url);
  if (data) {
    return {
      kind: "inline",
      source,
      mediaType: data.mediaType,
      byteLength: data.byteLength,
      redacted: true,
      label: `inline ${data.mediaType || "image"}${data.byteLength ? ` ${data.byteLength} bytes` : ""}`,
    };
  }
  if (/^https?:\/\//i.test(url)) {
    return {
      kind: "url",
      source,
      url,
      label: `remote image ${safeUrlHost(url)}`,
    };
  }
  if (url) {
    return {
      kind: "file",
      source,
      path: url,
      label: `local image ${url.split(/[\\/]/).pop() || "file"}`,
    };
  }
  return null;
}

function parseDataUri(value) {
  const match = String(value).match(/^data:([^;,]+)?((?:;[^,]*)?),([\s\S]*)$/);
  if (!match) return null;
  const mediaType = match[1] || "application/octet-stream";
  const flags = match[2] || "";
  const data = match[3] || "";
  const byteLength = flags.includes(";base64") ? estimateBase64Bytes(data) : decodeURIComponentSafe(data).length;
  return { mediaType, byteLength };
}

function estimateBase64Bytes(value) {
  const clean = String(value).replace(/\s/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return String(value);
  }
}

function safeUrlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "url";
  }
}

function buildSearchText(event) {
  const attachmentText = event.attachments.map((attachment) => attachment.label).join("\n");
  const reasoningText = event.reasoning?.summary || (event.reasoning?.encrypted ? "encrypted reasoning present" : "");
  return [
    event.kind,
    event.semanticKind,
    event.role,
    event.rawType,
    event.payloadType,
    event.text,
    event.toolName,
    event.toolInput,
    event.toolOutput,
    attachmentText,
    reasoningText,
  ]
    .filter(Boolean)
    .map(redactSensitiveText)
    .join("\n");
}

function redactSensitiveJson(value) {
  return redactValue(value, null);
}

function redactValue(value, key) {
  if (key === "encrypted_content") return `[encrypted_content redacted length=${String(value ?? "").length}]`;
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, null));
  if (isObject(value)) {
    const copy = {};
    for (const [childKey, childValue] of Object.entries(value)) copy[childKey] = redactValue(childValue, childKey);
    return copy;
  }
  return value;
}

function redactSensitiveText(value) {
  return String(value ?? "").replace(dataUriPattern, (match, mediaType) => {
    const parsed = parseDataUri(match);
    const type = mediaType || parsed?.mediaType || "data";
    const size = parsed?.byteLength ? ` ~${parsed.byteLength} bytes` : "";
    return `[redacted data URI ${type}${size}]`;
  });
}

function safeStringifyRedacted(value, space = 2) {
  return JSON.stringify(redactSensitiveJson(value), null, space);
}

function stringifyMaybe(value) {
  if (value == null) return null;
  if (typeof value === "string") return redactSensitiveText(value);
  return safeStringifyRedacted(value);
}

function safeJsonLength(value) {
  if (value == null) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function stringOrNull(value) {
  return value == null || value === "" ? null : String(value);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export {
  coalesceNormalizedEvents,
  normalizeEventTimestamp,
  normalizeSessionEvent,
  redactSensitiveJson,
  redactSensitiveText,
  safeStringifyRedacted,
};
