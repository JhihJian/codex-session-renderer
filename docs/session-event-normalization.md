# Codex/Pi Agent JSONL 事件规范化契约

本项目把 Codex 和 Pi Agent 会话文件视为 UTF-8 JSONL 事件流读取。不同客户端和版本可能记录不同字段形态，因此服务端先把原始事件转换为内部稳定事件模型，再供会话摘要、Turn 聚合、Audit、Trace、Raw 视图、Markdown 导出和外部查询 API 使用。

## 稳定字段

规范化事件由 `src/session-normalizer.mjs` 生成，保留原始事件的同时提供这些稳定字段：

- `kind`：项目内部事件种类，优先来自 `type`，兼容 `payload.type`、`role` 和 `function_result` 等旧形态。
- `semanticKind`：稳定语义分类，包括 `message`、`tool_call`、`tool_result`、`reasoning`、`meta`、`diagnostic`、`event`。
- `timestamp`：统一 ISO 时间，兼容常见时间字段、ISO 字符串、秒/毫秒/微秒 epoch。
- `role`、`messageId`、`parentId`、`callId`：消息、线程和工具调用关联字段。
- `text`、`textParts`：从字符串字段和 content parts 提取的可读文本。
- `toolName`、`toolInput`、`toolOutput`：从 `tool`、`name`、`function.name`、`arguments`、`input`、`stdout`、`stderr`、`result`、`output` 等字段归一化。
- `toolCalls`：Pi Agent 把工具调用嵌入到助手消息的 `message.content[].type = "toolCall"` 中时，规范化层会提取调用 ID、名称和参数，Turn 聚合再把它们展开成独立 `tool-call` item。
- `attachments`：图片和附件的安全摘要。
- `reasoning`：reasoning 摘要和加密状态。
- `compact`：Codex 上下文压缩事件的摘要、窗口 ID、替换历史数量、被替换对话短预览和阶段。
- `raw`、`payload`、`rawSize`、`payloadSize`：原始事件引用和体积信息。
- `diagnostic`：JSONL 解析失败行的行号、错误类别和安全预览。

未知字段不会被丢弃。Raw event 仍可通过按需接口查看，规范化层只为常用视图提供稳定读法。

## 字段漂移兼容

解析层优先按 `type` 识别事件，缺失时使用 `payload.type`、`role` 或兼容映射推断。`function_result` / `tool_result` 会映射为工具输出语义，`function_call` / `tool_call` 会映射为工具调用语义。Pi Agent 的顶层 `type: "message"` 会从 `message.role` 和 `message.content` 提取用户/助手文本；`message.role: "toolResult"` 会归一化为工具输出，并用 `toolCallId` 关联前序嵌入式工具调用。

文本提取支持：

- `content` 字符串。
- `content` parts 中的字符串、`text`、`value`、`input_text`、`output_text`。
- `text`、`message`、`value`、`last_agent_message`。
- Pi Agent `message.content` 中的 `{ type: "text", text: "..." }`。

工具字段提取支持：

- 工具名：`tool`、`name`、`function.name`、MCP `invocation`。
- 参数：`arguments`、`function.arguments`、`arguments_json`、`input`。
- 输出：`stdout` / `stderr`、`result`、`output`。
- Pi Agent 工具调用：助手消息 `content` 中的 `toolCall.id/name/arguments`。
- Pi Agent 工具结果：`message.role = "toolResult"` 的 `toolCallId`、`toolName` 和文本 `content`。

## Pi Agent 会话

Pi Agent 本机数据源默认扫描 `~/.pi/agent/sessions/**/*.jsonl`，在 API 中的 `sourceId` 为 `pi-agent`。该目录通常按项目目录分组，单个 JSONL 文件名形如 `2026-07-10T04-51-55-870Z_<uuid>.jsonl`。服务端会从以下事件中提取会话列表元数据：

- `type: "session"`：会话 ID、开始时间和 `cwd`。
- `type: "session_info"`：会话标题。
- `type: "model_change"`：模型提供方和模型 ID。
- `type: "thinking_level_change"`：推理/思考等级。

Pi Agent 没有 Codex 的 `state_5.sqlite` 时，会直接走 JSONL 文件扫描路径。阅读模型会把连续聊天记录按用户新输入拆分成多轮；助手消息里的 `toolCall` 会展开成工具调用，后续 `toolResult` 会合并为该工具调用的输出。Raw event 接口仍返回原始 Pi Agent JSONL 行。

## Delta 合并

规范化层提供 `coalesceNormalizedEvents`。当事件带有 `delta`、`chunk` 或 `delta_index`，且存在同一 `messageId` 时，会把同一消息的文本 chunk 合并为连续内容，同时保留 `sourceIndexes` 和 `rawEvents` 供诊断回溯。

## 助手消息保留

`agent_message` 和 `role: "assistant"` 的消息会转换为 turn item 中的 `assistant-message`。精简视图模型保留 `assistantMessages` 数组以展示每一条助手消息，同时保留 `assistantMessage` 指向最后一条助手消息作为兼容字段。若同一 Turn 内的 `token_count` 可解析出 context window 或上下文百分比，助手消息会携带 `contextUsage.percent`，渲染为 1-100% 的上下文占用率；缺少上限和百分比时不显示该字段。前端会把占用率渲染为独立徽标，超过 70% 时使用高占用提示样式。Audit 执行链会把助手消息投影为 `agent_message` 父行，工具、handoff 和子代理执行节点缩进挂载在对应助手消息下；没有助手正文时使用占位父行，避免执行节点脱离 agent 消息上下文。

## 上下文压缩事件

Codex 在上下文压缩时会写入两类事件：

- 顶层 `type: "compacted"`：保存写入下一窗口的替换摘要，可能包含 `message`、`replacement_history`、`window_number`、`first_window_id`、`previous_window_id` 和 `window_id`。
- `event_msg.payload.type: "context_compacted"`：标记压缩流程完成，通常不包含摘要正文。

规范化层会把这两类事件标记为重要事件，并生成 `compact` 字段。`replacementHistoryCount` 表示 `replacement_history` 的总条数；`replacementHistoryPreview` 只保留最多 30 条可扫描短预览，每条包含序号、role、type、turn/message 定位字段、内容类型、预览文本、原始字符数和截断标记，不把完整正文塞进轻量模型。精简视图会再用 `turn_id` 关联当前会话的 Turn，补充 `turnNumber`、Turn 时间、用户问题和最后回复摘要，让“被替换的对话”优先回答 compact 摘要覆盖了哪些 Turn 和原始问题；字符数与短 ID 只作为辅助定位信息。精简视图还会为被 `replacement_history` 命中的原始消息生成 `compressionRefs` 和 replacement 条目跳转目标，用户消息只统计自身替换条目，助手消息统计自身以及按 Audit 执行层级挂到该助手消息下的工具/执行条目，标签显示为“被替换 N 条 / event #”；点击该回标会保持在精简视图并定位到对应 `context-compact` 系统块，点击“被替换的对话”里的具体条目会跳回原始消息或对应助手消息组。Raw 来源通过该系统块里的“查看 Raw”进入。Turn 聚合会把 compact 事件保留为 `context-compact` item；Raw 视图和 Review Dock 会显示摘要正文、窗口字段、替换历史数量和同一份短预览。完整原始 payload 仍通过单事件接口按需读取。

## Codex Goal 控制包安全投影

Codex 会把持续目标的自动续跑控制包写为 `response_item / message / role=user`。控制包包含用户 objective 和较长的运行规则，不是新的用户输入。默认阅读、Turn/Audit、首任务归档、Markdown、语义事件搜索及标题派生只在已实证的 `codex-thread-goal@0.144.1` 结构完整时投影 objective；Raw event、单事件接口和 `includePayload/includeRaw` 一律保留完整原始 JSON。

已支持 profile 必须同时满足以下可信关联，任何一项不满足都失败关闭：

- 第一个逻辑事件是 `session_meta`，其中 `payload.session_id` 与 `payload.id` 是同一个 UUID。
- 已关联的 `event_msg.payload.type = thread_goal_updated` 同时令 `payload.threadId`、`goal.threadId` 与 session ID 相等；active goal 必须有非空 `objective`、非负计数、合法且单调的创建/更新时间与 token 用量。
- 后续控制消息必须是单个 `input_text` content part、带 UUID `internal_chat_message_metadata_passthrough.turn_id`，并且逐字匹配当前实证模板。当前 profile 只支持 `Token budget: none` / `Tokens remaining: unbounded` 的已观察模板，`Tokens used` 必须是安全整数且不低于关联状态或前一控制包。
- 同一 `threadId + objective` 仅投影一次；后续完整续跑包抑制。新的、单调推进的 `thread_goal_updated` 且 objective 改变时才可投影新的 objective。只有后继控制包完整通过后，关联状态事件才从默认派生面隐藏。

JSONL 解析失败会中断 Codex 控制状态链。未知版本、预算形态、字段缺失、错误 thread ID、状态倒退、模板附加内容、伪造文本和普通用户写出的相似标签均按普通消息保留。该协议校验提供结构可信度，不把可写 JSONL 当作密码学签名。

SQLite 或轻量索引给出疑似控制包标题时，列表只对当前可见候选作一次 24 条逻辑记录、96 KiB 的诊断前缀探测，并在读取前后核对文件签名。只有在这个固定窗口内确认完整 objective 才覆盖标题/预览；达到字节边界时，仅忽略窗口末尾由截断产生的诊断尾行，窗口内真实解析失败仍保持原标题。列表不调用完整详情、归档扫描或无界 JSONL 读取。

## 会话标题一致性

同一 `sourceId + sessionId` 的规范标题由已验证的 SQLite `threads.title` 优先确定，适用于详情、Markdown、任务归档和会话查询。列表与远端历史索引从规范标题派生固定上限的 `displayTitle` 和 `titleTruncated`，绝不输出完整 `title`；行 DOM、移动端列表、ARIA 名称和选择中的公告只能消费这两个有界字段。截断项以“标题已截断”作为额外的简短无障碍语义，当前项使用 `aria-current`。服务端列表 `q` 仍在规范标题及既有元数据上匹配，后段命中不会导致完整标题回传浏览器。

文件或轻量索引回退已经完成路径与 ID 校验后，才会把当前受列表上限约束的候选 ID 作为一次有界 SQLite 查询输入；SQLite 返回的非空标题可以补齐文件回退标题，但不会据此新增会话、路径或正文。

SQLite 不可读、没有同 ID 行或标题为空时，保留已有的索引、首条元信息和文件名回退，不能把不可验证的信息伪装成标题。历史回退仍只读取 1 条、64 KiB JSONL 前缀；标题补齐不读取正文、不调用详情协调器，也不改变远端历史仅索引的传输边界。SQLite 标题补齐后仍执行上面的严格 Codex Goal 投影，确保通过完整结构校验的 objective 覆盖控制包标题。详情解析不复用最后一次 scope 列表的标题缓存，因此 recent/all/history 的调用先后顺序不能改变详情标题。

语义事件搜索复用同一流投影：objective 可命中，控制规则和预算字段不可命中；事件响应本身仍是诊断摘要，完整控制 payload 只在按需 Raw 接口返回。

## Pi Goal-mode 安全投影

Pi Goal-mode 扩展会把控制提示词以 `type: "message"`、`message.role: "user"` 写入 Pi JSONL。它们不是普通用户的新输入：启动和目标更新包包含用户目标以及控制规则，恢复和自动续跑包没有新的用户目标。为避免将规则、`goal_id` 和续跑 marker 带入默认阅读、Audit、归档、搜索或 Markdown，本项目只对当前已实证的 `Pi session v3 + @narumitw/pi-goal@0.15.1` 完整结构包投影。

投影器要求同时满足：

- 第一个 JSONL 记录是 `type: "session"` 且 `version: 3`。
- 目标消息紧接一个 `type: "custom"`、`customType: "goal-state"` 的完整 active goal 状态，并且消息 `parentId` 精确指向该状态记录。
- 用户消息只有一个 text content part；目标 ID、XML 转义后的 objective、状态字段和四种已知完整模板（启动、更新、恢复、自动续跑）必须全部一致。

通过校验的启动/更新只投影 `<goal_objective>` 对应的原始目标文本；恢复和自动续跑不产生用户消息。关联 `goal-state` 也不进入默认 Turn。任何未知版本、字段缺失、父子关系不符、模板附加文字、解析失败或仅仅看起来像 Goal 的用户文本都会失败关闭，保留原始文本。JSONL 没有签名，因此这只是结构一致性验证，不把可写入会话文件的一方当作密码学可信来源。

原始事件诊断保持原语义：完整 payload/Raw 和单事件接口仍返回控制包。事件搜索在有完整会话上下文时复用同一投影，因此可以命中目标文本，不能通过默认搜索命中控制规则、`goal_id` 或 continuation marker。

## 默认用户消息口径

Codex 有时会把机器上下文写进用户消息，例如 `AGENTS.md instructions`、`environment_context`、浏览器/文件包装和 subagent notification。默认阅读模型、Markdown 导出和事件搜索会先提取真实用户请求：

- 如果存在 `## My request for Codex:`，只展示其后的请求正文。
- 如果消息开头是 `AGENTS.md instructions` 并包含 `environment_context`，默认隐藏这段机器上下文，保留后续真实请求。
- 纯机器上下文、JSON 形式的 subagent notification，以及完整的 `<subagent_notification>...</subagent_notification>` 包裹通知不计为真实用户请求。短句或仿冒的 Goal continuation 前缀不是删除依据，Pi Goal-mode 只能按上一节的完整结构投影。
- Raw event 和单事件接口仍保留原始 payload，用于诊断和审计。

去重只针对明确的事件回声，例如同一条用户消息同时以 `event_msg user_message` 和 `response_item role=user` 写入；用户真实重复输入同一句话不会仅因文本相同被删除。

## 首个任务提示词归档

`src/session-prompts.mjs` 基于 `buildTurns()` 提取根会话中第一个有效的 `user-message`，作为任务归档的 `promptText`。因此首个提示词遵循与阅读视图相同的 Pi Goal 安全投影、机器上下文清理、fork replay 前缀抑制、事件回声去重和中断续跑处理口径；会话标题不作为提示词回退值，`compacted` / `context_compacted` 的 `replacement_history` 也不视为新的用户输入。

归档条目的身份是 `sourceId + sessionId`，项目键是 `sourceId + cwd`，没有 `cwd` 的会话进入“无项目”。条目同时保存 `promptPreview`、`promptTimestamp`、`promptEventIndex`、`promptTurnId`、安全附件摘要、`promptTruncated`、`promptLimitReason` 和 `promptState`。状态包括 `found`、`image-only`、`empty`、`unavailable`、`too_large`、`changing` 和 `error`。`too_large` 与 `changing` 不返回正文，因此不会把超限或读取中变化文件的敏感内容带入响应。

归档协调器以读取前后的真实文件签名（路径、大小、`mtimeMs`、`ctimeMs`）为缓存和 in-flight 去重边界。同一签名可由多个请求共享；每个请求是独立订阅，取消一个订阅不会打断其余订阅，最后一个订阅取消才中止底层流。读取后签名变化时立即返回 `changing` 且不缓存，后续请求会以新签名建立新的共享读取。缓存最多保留 400 个会话当前版本。首次归档的会话发现和响应一次最多处理 200 个会话，整个服务实例共享 4 路并发；每个文件最多读取 2 MiB 或 20,000 条非空 JSONL 记录，提示词正文上限为 12,000 字符。任何上限命中都返回 `too_large` 且不返回正文。前端在切换数据源、时间分类、刷新或离开归档时发出取消；HTTP 客户端断开也会取消其订阅。

`turn_aborted` 会终止当前 turn 并标记为 `aborted`。如果一个没有工具或助手输出的 aborted turn 后面紧跟相同首条请求的续跑 turn，默认阅读会压掉前一个空 aborted turn 里的重复请求，但保留 aborted 状态本身。

## 子代理回执

`subagent_notification` 用于把子代理完成状态回传给父会话。服务端会优先从结构化 payload 或 `<subagent_notification>...</subagent_notification>` 包裹文本中读取 `agent_path`、`status.completed`、`status.failed`、`status.error` 等字段，并把它们挂到精简视图的子代理节点上。

精简视图展示子代理时会把这类通知渲染成“子代理回报”摘要块：状态显示为已完成、失败、运行中或状态通知；正文按 Markdown 展示，长正文会有长度上限和滚动区域；Raw event 仍可从来源事件查看完整原始记录。这样子代理回报不会混入用户输入，也不会以原始 JSON 占据阅读视图。

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

## 会话时间投入

完整详情额外返回 `timing` 投影，用于诊断页展示会话墙钟时长、时间区间覆盖、分类投入、并行关系和数据质量。`timing.session.durationMs` 是首个有效时间点到最后有效时间点的墙钟区间；`coverageMs` 使用所有可关联执行区间的并集计算。工具、委派和子代理可能并行执行，因此分类的 `nodeDurationMs` 累加值可以大于 `coverageMs`，页面同时显示 `overlapMs` 和并行峰值。工具区间之外的时间不再作为单一的不可读总数，而是拆成按轮次排序的“时间缺口（模型处理 / 等待）”；这些区间明确标注没有原始事件，避免伪造工具归因。

每个分类保留 `nodeRefs`，包括 `traceNodeId`、轮次索引和原始事件索引，前端可从时间投入条跳转到 Audit 或 Raw。时间区间的 `durationKind` 使用 `observed`、`estimated`、`partial` 和 `unavailable`，会话和分类的 `confidence` 使用 `observed`、`mixed`、`estimated` 和 `unavailable`。缺少开始或结束事件的项目计入质量摘要，并以部分区间或估算状态展示。

`GET /api/query/sessions/:id/view?view=timing` 返回与详情中相同的 `timing` 投影。搜索、类型筛选和事件统计不改变完整会话时间口径。详情读取和文件签名校验仍然是 timing 的版本边界，文件变化时前端清理旧的时间分析结果。

## 完整详情与诊断预算

详情、compact/view、turns/audit 和 Markdown 导出完整读取当前 JSONL，不按文件字节数或事件数降级。服务端通过同一个协调器在读取前后比较文件签名，保留全局 4 路读取闸门与稳定完整派生的 24 条/48 MiB 版本 LRU；单个结果超过缓存总预算时只是不写入缓存，不能拒绝展示。具体环境变量和默认值见 README 的“完整详情读取与诊断预算”。

文件在读取或派生期间变化、读取失败和取消都不会产生缓存条目，也不会把已读旧内容当作当前详情。文件变化时详情和外部 view 返回 `complete: false` 及 `readState.code = session_file_changed`，Markdown 返回 `409`；这不是大小或事件数能力降级。原始事件分页始终是独立诊断入口，使用同一并发闸门，但只受 `CODEX_SESSION_DIAGNOSTIC_MAX_FILE_BYTES` 单次字节预算、页大小和 `CODEX_SESSION_DIAGNOSTIC_MAX_EVENT_SCAN` 扫描预算约束；预算到达会返回诊断状态或 `413/session_event_scan_limited`，不会影响完整详情。单条事件读取也支持 `AbortSignal`、快照校验和这些诊断预算。

## 测试要求

修改规范化逻辑时至少覆盖：

- 字段漂移的文本、时间、工具名、参数和输出。
- `function_call` / `function_result` 兼容映射。
- Pi Agent `message.content` 文本、嵌入式 `toolCall` 和 `toolResult`。
- Pi v3 的完整 `pi-goal@0.15.1` 启动/更新、恢复/自动续跑、安全失败关闭、目标搜索、原始单事件保留以及大文件前缀归档。
- Codex `thread_goal_updated -> response_item` 完整控制包、同目标续跑抑制、标题前缀探测、失败关闭、Turn/Audit/归档/Markdown/搜索投影、HTTP Raw 单事件保留和 Chromium 阅读路径。
- 同一 `messageId` 的 delta 合并。
- data URI 图片摘要和默认脱敏。
- `encrypted_content` 不进入搜索文本。
- Codex `compacted` / `context_compacted` 事件能进入重要事件、搜索、Turn item 和精简视图摘要，暴露可截断的被替换对话预览，并能按消息/助手消息组把后续压缩引用回标到原始消息。
- JSONL 解析失败行的诊断事件。
