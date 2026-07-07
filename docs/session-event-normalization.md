# Codex JSONL 事件规范化契约

本项目把 Codex 会话文件视为 UTF-8 JSONL 事件流读取。不同 Codex 客户端和版本可能记录不同字段形态，因此服务端先把原始事件转换为内部稳定事件模型，再供会话摘要、Turn 聚合、Audit、Trace、Raw 视图、Markdown 导出和外部查询 API 使用。

## 稳定字段

规范化事件由 `src/session-normalizer.mjs` 生成，保留原始事件的同时提供这些稳定字段：

- `kind`：项目内部事件种类，优先来自 `type`，兼容 `payload.type`、`role` 和 `function_result` 等旧形态。
- `semanticKind`：稳定语义分类，包括 `message`、`tool_call`、`tool_result`、`reasoning`、`meta`、`diagnostic`、`event`。
- `timestamp`：统一 ISO 时间，兼容常见时间字段、ISO 字符串、秒/毫秒/微秒 epoch。
- `role`、`messageId`、`parentId`、`callId`：消息、线程和工具调用关联字段。
- `text`、`textParts`：从字符串字段和 content parts 提取的可读文本。
- `toolName`、`toolInput`、`toolOutput`：从 `tool`、`name`、`function.name`、`arguments`、`input`、`stdout`、`stderr`、`result`、`output` 等字段归一化。
- `attachments`：图片和附件的安全摘要。
- `reasoning`：reasoning 摘要和加密状态。
- `raw`、`payload`、`rawSize`、`payloadSize`：原始事件引用和体积信息。
- `diagnostic`：JSONL 解析失败行的行号、错误类别和安全预览。

未知字段不会被丢弃。Raw event 仍可通过按需接口查看，规范化层只为常用视图提供稳定读法。

## 字段漂移兼容

解析层优先按 `type` 识别事件，缺失时使用 `payload.type`、`role` 或兼容映射推断。`function_result` / `tool_result` 会映射为工具输出语义，`function_call` / `tool_call` 会映射为工具调用语义。

文本提取支持：

- `content` 字符串。
- `content` parts 中的字符串、`text`、`value`、`input_text`、`output_text`。
- `text`、`message`、`value`、`last_agent_message`。

工具字段提取支持：

- 工具名：`tool`、`name`、`function.name`、MCP `invocation`。
- 参数：`arguments`、`function.arguments`、`arguments_json`、`input`。
- 输出：`stdout` / `stderr`、`result`、`output`。

## Delta 合并

规范化层提供 `coalesceNormalizedEvents`。当事件带有 `delta`、`chunk` 或 `delta_index`，且存在同一 `messageId` 时，会把同一消息的文本 chunk 合并为连续内容，同时保留 `sourceIndexes` 和 `rawEvents` 供诊断回溯。

## 助手消息保留

`agent_message` 和 `role: "assistant"` 的消息会转换为 turn item 中的 `assistant-message`。精简视图模型保留 `assistantMessages` 数组以展示每一条助手消息，同时保留 `assistantMessage` 指向最后一条助手消息作为兼容字段。若同一 Turn 内的 `token_count` 可解析出 context window 或上下文百分比，助手消息会携带 `contextUsage.percent`，渲染为 1-100% 的上下文占用率；缺少上限和百分比时不显示该字段。前端会把占用率渲染为独立徽标，超过 70% 时使用高占用提示样式。Audit 执行链会把助手消息投影为 `agent_message` 父行，工具、handoff 和子代理执行节点缩进挂载在对应助手消息下；没有助手正文时使用占位父行，避免执行节点脱离 agent 消息上下文。

## 默认用户消息口径

Codex 有时会把机器上下文写进用户消息，例如 `AGENTS.md instructions`、`environment_context`、goal continuation、浏览器/文件包装和 subagent notification。默认阅读模型、Markdown 导出和事件搜索会先提取真实用户请求：

- 如果存在 `## My request for Codex:`，只展示其后的请求正文。
- 如果消息开头是 `AGENTS.md instructions` 并包含 `environment_context`，默认隐藏这段机器上下文，保留后续真实请求。
- 纯机器上下文、goal continuation 和 subagent notification 不计为真实用户请求。
- Raw event 和单事件接口仍保留原始 payload，用于诊断和审计。

去重只针对明确的事件回声，例如同一条用户消息同时以 `event_msg user_message` 和 `response_item role=user` 写入；用户真实重复输入同一句话不会仅因文本相同被删除。

`turn_aborted` 会终止当前 turn 并标记为 `aborted`。如果一个没有工具或助手输出的 aborted turn 后面紧跟相同首条请求的续跑 turn，默认阅读会压掉前一个空 aborted turn 里的重复请求，但保留 aborted 状态本身。

## 图片与附件

图片只进入安全摘要，默认不把大体积内容放入列表、轻量详情或搜索文本：

- data URI：记录为 `kind: "inline"`，保留媒体类型和估算字节数，标记 `redacted: true`。
- HTTP(S) URL：记录为 `kind: "url"`，显示引用来源，不自动远程拉取。
- 文件 ID 或本地路径：记录为 `kind: "file"`。
- 不可识别附件：记录为 `kind: "unknown"`。

Raw event 仍可按需查看完整原始 JSON。默认视图、事件预览和搜索文本会把 data URI 替换为有界的 redacted marker。

## 加密 Reasoning

`encrypted_content` 是敏感不透明字段：

- 不进入默认搜索文本。
- 轻量模型只暴露是否存在、字符长度和来源事件。
- 有 `summary` 时展示摘要；没有摘要时只提示加密内容存在。
- Raw event 按需接口仍返回原始事件，调用者需要按私密数据处理。

规范化层提供 redaction 工具，默认 payload 预览会把 `encrypted_content` 替换成长度标记。

## 解析失败行

旧的 `readJsonl` 继续保持兼容行为：跳过无法解析的行。需要诊断能力的路径使用：

- `readJsonlWithDiagnostics`
- `readJsonlLineWithDiagnostics`
- `readJsonlRange(..., { includeInvalid: true })`

这些读取方式会把无法解析的非空 JSONL 行转换为 `jsonl_parse_error` 诊断事件，保留逻辑索引、物理行号、错误类别和安全预览。这样 Raw/查询路径可以提示数据质量问题，而不是静默丢失。

## 测试要求

修改规范化逻辑时至少覆盖：

- 字段漂移的文本、时间、工具名、参数和输出。
- `function_call` / `function_result` 兼容映射。
- 同一 `messageId` 的 delta 合并。
- data URI 图片摘要和默认脱敏。
- `encrypted_content` 不进入搜索文本。
- JSONL 解析失败行的诊断事件。
