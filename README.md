# Codex 会话工作台

这个小工具只读扫描 Codex 会话文件，并在浏览器里渲染成本地会话工作台。默认数据源仍是当前用户的本机 Codex Home；也可以把远程设备的 Codex Home 先刷新成本地快照，再作为独立数据源查看。

## 数据来源

- 会话元数据：`%USERPROFILE%\.codex\state_5.sqlite`，用于读取标题、工作目录、模型、推理强度和归档状态。
- 正文事件流：`%USERPROFILE%\.codex\sessions\**\*.jsonl`
- 轻量索引回退：`%USERPROFILE%\.codex\session_index.jsonl`
- 远程设备：通过环境变量配置成数据源后，刷新到本机快照目录；渲染层只读取发布后的本地快照，不直接绑定实时远程请求。
- 参考实现：Codex App 的打包前端位于 `resources\app.asar`，本项目只参考模块边界和事件分组思路，不复制原始专有源码。

## 启动

```powershell
cd D:\github\codex-session-renderer
npm start
```

默认地址：

```text
http://127.0.0.1:4789/
```

可通过环境变量覆盖端口和 Codex Home：

```powershell
$env:PORT=4790
$env:CODEX_HOME='C:\Users\user\.codex'
npm start
```

## 远程会话数据源

远程数据源通过“实时会话刷新到本地快照，历史会话只查远端索引”的方式工作。刷新失败不会删除上一份可用快照；如果已有旧快照，页面仍可继续浏览，并在数据源状态里标注失败或旧快照。

推荐的最简方式是：每台需要被查看的设备启动快照共享服务，然后在任意一台已打开页面的设备里通过“设备”面板添加对端。实例之间不区分主次；谁添加了对端，谁就能从页面刷新对端实时会话并检索对端历史索引。

被查看设备：

```powershell
cd D:\github\codex-session-renderer
$env:CODEX_SHARE_TOKEN='<同一段随机 token>'
npm run share
```

默认共享端口是 `4791`，默认只把最近 3 小时内变更过的 `sessions/**/*.jsonl` 打包进实时快照。`state_5.sqlite` 和 `session_index.jsonl` 会随实时快照一起传输，用于标题、归档、子代理关系和路径映射。

如果要改端口或实时窗口：

```powershell
$env:CODEX_SHARE_PORT=4792
$env:CODEX_SHARE_REALTIME_HOURS=6
```

如果主查看设备无法访问该端口，需要在被查看设备的 Windows 防火墙中放行 Node.js 或对应端口。

任意查看设备：

```powershell
cd D:\github\codex-session-renderer
npm start
```

启动后点击左侧数据源旁的“设备”，添加：

- 名称：例如 `office`
- 地址：例如 `192.168.1.20:4791`
- Token：对端 `CODEX_SHARE_TOKEN`

保存后页面会立即刷新数据源列表，不需要重启 `npm start`。选择 `office` 后点击“刷新远程”，服务端会从 `http://192.168.1.20:4791/api/codex-snapshot.tar?scope=realtime` 下载实时快照并发布到本机缓存。

页面保存的远端设备配置位于：

```text
%USERPROFILE%\.codex-session-renderer\config.json
```

该文件包含远端 token，应按本机私密配置处理。页面 API 只返回 `hasToken`，不会把 token 回显给浏览器表单；编辑设备时 Token 留空表示保留原 token。

左侧时间分类的“实时”展示已同步到本机的可打开会话；“一天”和“更早”会调用远端 `/api/codex-session-index` 做统一入口检索，只返回标题、时间、项目路径、模型等索引信息，不传历史正文。历史索引结果会标注“仅索引”，用于定位和搜索，不会被误当成已同步的可打开正文。

快照共享接口只响应带有 `Authorization: Bearer <token>` 的请求。没有 `CODEX_SHARE_TOKEN` 时，`npm run share` 会拒绝启动，避免误把会话正文、命令输出、项目路径和错误栈暴露到网络。

高级模式仍支持环境变量配置和两种获取方式：

- `CODEX_REMOTE_PEERS`：用 `id=host:port` 或 `id=http://host:port` 配置对端，适合无人值守部署或临时启动。

- `CODEX_REMOTE_<ID>_SNAPSHOT_PATH`：从一个本机可读目录复制 Codex Home，适合先用 rsync、scp、挂载盘或其他脚本把远程 `/root/.codex` 同步到本机。
- `CODEX_REMOTE_<ID>_SNAPSHOT_URL`：从远端 HTTP(S) 下载 `.tar`、`.tar.gz` 或 `.tgz` 快照包。服务端会用 `Authorization: Bearer ...` 请求，token 只从环境变量读取。

示例：配置一个名为 `office` 的远程设备，快照来源是本机已同步目录。

```powershell
$env:CODEX_REMOTE_SOURCES='office'
$env:CODEX_REMOTE_OFFICE_LABEL='Office 远程设备'
$env:CODEX_REMOTE_OFFICE_CODEX_HOME='/root/.codex'
$env:CODEX_REMOTE_OFFICE_SNAPSHOT_PATH='D:\codex-remote\office\.codex'
$env:CODEX_REMOTE_SNAPSHOT_ROOT='D:\codex-session-renderer-snapshots'
npm start
```

示例：配置 HTTP 快照下载。不要把 token 写入仓库文件；这里只展示变量名和占位符。

```powershell
$env:CODEX_REMOTE_SOURCES='office'
$env:CODEX_REMOTE_OFFICE_LABEL='Office 远程设备'
$env:CODEX_REMOTE_OFFICE_CODEX_HOME='/root/.codex'
$env:CODEX_REMOTE_OFFICE_SNAPSHOT_URL='https://example.invalid/codex-snapshot.tar.gz'
$env:CODEX_REMOTE_OFFICE_TOKEN_ENV='CODEX_REMOTE_OFFICE_TOKEN'
$env:CODEX_REMOTE_OFFICE_TOKEN='<runtime token>'
npm start
```

远程内容会原子发布到：

```text
%USERPROFILE%\.codex-session-renderer\remote-snapshots\<source-id>\current
```

可通过 `CODEX_REMOTE_SNAPSHOT_ROOT` 修改快照根目录。快照目录包含会话正文、命令输出、项目路径和错误栈等敏感信息，应按本机私密数据处理，不要提交到 git 或上传到公开位置。当前 `.gitignore` 已默认忽略 `*.sqlite`、`*.jsonl`、`*.log`、`.env*`、`tmp/` 等常见运行时文件；如果把快照根目录放进仓库工作区，需要额外把该目录加入忽略规则。

远程状态只暴露脱敏信息：是否刷新中、最近成功刷新时间、是否正在浏览旧快照、失败类别和简短原因。API 响应、状态文件和普通错误信息不会包含 token、认证头或会话正文。

## 项目结构

- `server.mjs`：HTTP 路由、数据源分发、会话文件定位、缓存和接口编排；底层响应、SQLite、DTO 和解析逻辑已拆到 `src/`。
- `share-server.mjs`：远端快照共享服务入口；只暴露受 Bearer token 保护的 Codex 快照下载接口。
- `src/data-sources.mjs`：本机/远程数据源配置、远程快照刷新、原子发布和脱敏状态。
- `src/renderer-config.mjs`：页面管理的远端设备配置读写、校验和脱敏输出。
- `src/snapshot-share.mjs`：按需复制实时 Codex 会话文件、写入快照元数据、打包 tar，并提供历史会话索引检索。
- `src/jsonl-reader.mjs`：UTF-8 JSONL 流式读取工具；支持按逻辑行数上限读取和按事件索引读取单条事件。
- `src/http-response.mjs`：JSON/Text 响应、错误响应、静态文件类型和路径安全解析。
- `src/sqlite-threads.mjs`：只读 SQLite 查询、线程行映射、spawn edge 读取和 SQL 字符串转义。
- `src/session-models.mjs`：服务端 API 会话 DTO、列表 DTO、线程元数据和文件 stat 合并。
- `src/text-utils.mjs`：时间、路径、首行摘要、消息正文提取和文本规范化等基础纯函数。
- `src/tool-events.mjs`：工具调用开始/结束识别、工具名/参数/输出提取、MCP 结果渲染和输出合并。
- `src/session-normalizer.mjs`：Codex JSONL 原始事件规范化、字段漂移兼容、delta 合并、图片/附件摘要、加密 reasoning 脱敏和搜索文本构建。
- `src/event-summary.mjs`：事件分类、重要事件判断、标题/预览摘要和会话事件计数。
- `src/audit-chain.mjs`：基于轻量 turn/item 模型生成 Audit Chain，集中维护审计节点、验证识别和风险启发式规则。
- `src/session-query.mjs`：面向外部项目的会话查询、筛选、分页游标、字段投影和事件增量查询参数处理。
- `src/markdown-export.mjs`：会话 Markdown 导出。
- `src/session-events.mjs`：会话事件核心解析逻辑，包括 turn 聚合、Trace 模型、精简视图模型和子代理锚定；同时重新导出旧的常用解析 API 以保持调用兼容。
- `public/`：无构建前端，包含页面、样式、交互脚本和本地 `markdown-it` 浏览器包。
- `public/app-format.js`：前端格式化、转义、高亮、路径缩短和文件名清理工具；通过浏览器全局 `window.AppFormat` 暴露，避免引入构建步骤。
- `public/tool-summary.js`：前端工具调用可读摘要规则，内置常见 `exec_command`、`apply_patch`、工具搜索等转换，并支持浏览器本地自定义规则覆盖。
- `public/execution-grouping.js`：Audit 执行链连续节点聚合规则，内置“收集文件与目录信息、搜索与定位代码、检查 Git 状态与差异”等分组，并支持浏览器本地自定义规则覆盖。
- `test/`：Node 内置测试，覆盖 JSONL 读取、HTTP/静态文件边界、SQLite 映射、服务端 DTO、事件摘要、工具协议、事件解析、前端格式化和 Markdown 导出等回归点。

后续维护时，优先把可纯函数化的逻辑放进对应 `src/` 小模块并补测试；`server.mjs` 只负责数据来源、缓存和接口组合。前端如新增通用格式化/转义逻辑，优先放进 `public/app-format.js` 并在 `test/app-format.test.mjs` 覆盖；如新增工具调用语义化展示规则，优先放进 `public/tool-summary.js` 并在 `test/tool-summary.test.mjs` 覆盖；如新增执行链聚合规则，优先放进 `public/execution-grouping.js` 并在 `test/execution-grouping.test.mjs` 覆盖。

## 页面设计

浏览器页面按本地优先的 agent 会话工作台设计，第一屏就是可操作的三栏 split view：左侧会话列表，中间精简/Audit/Raw 三个主视图，右侧 Review Dock 复核台。界面使用系统字体、中性色背景、0.5 到 1px 轻边框、8px 工具圆角和紧凑行高，避免把工具界面做成营销卡片页。

左侧会话列表按时间分类和工作目录聚合，每行展示 agent 色点、标题、更新时间、模型和项目路径；顶部保留数据源、搜索、时间段和会话类型过滤。中间内容区只保留精简、Audit、Raw 三个主视图和内容搜索，统计条展示 Turns、Events、Important、Tools、Agents、Tokens。右侧 Review Dock 不再承担关键事件列表或会话概览职责，而是围绕当前选中对象展示“摘要 / 证据 / 关系 / 来源”四个复核页；默认状态是 Session Brief，优先暴露风险、验证、缺口和子代理入口。工具调用、工具输出和 Raw event 会先经过前端可读摘要规则转换，例如把 `Get-Content -Raw -Encoding UTF8` 显示为“读取文件内容”。Raw 视图负责会话级事件浏览，完整 Raw payload 只在 Review Dock 的“来源”页或 Raw 主视图中按需读取。

页面底部有状态条，显示当前数据源、选中会话、过滤后的 session 数和事件/turn 统计。样式支持系统浅色/深色模式，并建立统一角色色 token：蓝色用于用户输入和选中，深蓝用于助手叙述，紫色用于工具调用，绿色用于工具输出，红色用于错误风险，灰色用于元信息。为减少切换负担，主界面最多只保留三个视图：精简用于阅读，Audit 用于证据链复核，Raw 用于原始事件诊断。

## 检查与测试

```powershell
npm run check
npm test
```

`npm run check` 会对服务端入口、拆分后的 `src/` 模块和前端脚本做语法检查。`npm test` 会先运行语法检查，再运行 `node --test` 下的轻量回归测试。

当前重点回归保护包括：

- 静态文件路径不能穿越 `public/` 根目录。
- SQLite thread 行映射、ID 转义和 spawn edge 过滤保持稳定。
- 子代理通知匹配会同时检查事件预览和完整 payload，避免 `preview` 缺少 `agent_path` 时漏挂载。
- 前端 HTML 高亮不会改写标签，Windows 路径缩短和下载文件名清理保持稳定。

## 设计说明

- 服务端只读访问本地文件，不写入 `.codex`。
- 数据源是一等概念：旧接口默认读取本机 `local` 数据源，新接口可显式指定 `sourceId`；前端用 `sourceId + session id` 区分会话，避免不同数据源中相同 session id 混淆。
- 远端设备可以通过页面管理，配置保存在本机私有 `config.json`；环境变量仍可作为高级配置来源。页面接口只返回 token 是否存在，不回显 token 原文。
- 远程数据源的正文只在刷新阶段访问配置好的实时快照 URL 或快照目录；普通会话列表、Review Dock 复核台和 Markdown 导出都从本地 `current` 快照读取。历史分类可按需访问远端索引接口，但索引不包含会话正文。
- 远程实时快照刷新使用 staging 目录构建，再原子切换到 `current`。刷新失败不会覆盖上一次成功快照。
- 远程 SQLite 中的远端 `rollout_path` 会按配置的远端 Codex Home 映射到本地快照 Codex Home。
- 本地工作台 API 默认绑定 `127.0.0.1`，适合作为同机只读数据源；局域网同步只开放 `npm run share` 的快照接口，并要求 Bearer token。
- 前端使用原生 HTML/CSS/JavaScript，无构建步骤；Markdown 渲染通过本地 `markdown-it` 浏览器包完成。
- 顶栏设置入口提供“展示规则设置”，用户可在浏览器本地新增、启停或删除工具摘要规则和 Audit 执行聚合规则；自定义规则优先于内置规则。摘要规则只影响 Audit、Review Dock、Raw 列表标题和前端搜索；执行聚合规则只影响 Audit 执行链中连续执行节点的折叠展示，不改变服务端 `audit.nodes`、turn/item 轻量模型、`trace.root` 或 Raw event。
- 会话列表优先读取 SQLite `threads` 表，并在 SQLite 查询层排除 `thread_spawn_edges.child_thread_id` 对应的子代理线程，避免子代理在左侧会话列表独立展示；只有 SQLite 不可用时才回退扫描文件。
- JSONL 读取使用流式逐行解析；列表回退读取前若干条事件时不会把整个大文件一次性读入内存。
- JSONL 事件会先经过规范化层形成稳定字段，兼容 `type`/`role`、多种时间字段、content parts、工具字段漂移、delta chunk、图片引用和加密 reasoning；契约见 `docs/session-event-normalization.md`。
- 解析器把 JSONL 中的 `session_meta`、`turn_context`、`event_msg`、`response_item` 聚合为 turn 和 item。
- 工具调用会合并 `function_call`、`function_call_output`、`custom_tool_call`、`custom_tool_call_output`、`mcp_tool_call_end`、`patch_apply_end` 等 Codex 事件。
- 同一 `message_id` 的 streamed/delta 消息会在规范化层合并为连续可读文本，并保留来源事件索引用于 Raw 回溯。
- 同一条用户/助手消息如果同时出现在 response item 和事件消息里，会在渲染层去重。
- 页面默认进入精简视图，并提供三种主视图：
  - 精简视图：负责日常阅读，只看用户输入、最终回复和子代理摘要；如果父会话中有 `spawn_agent` 子代理，会按父子层级内嵌展示子代理自己的用户输入和每轮最后助手消息，并在目录中按“会话 -> Turn -> 子代理 -> 子代理 Turn”展示执行层级用于快速跳转；执行层级区域会尽量使用可用视口高度展示更多目录内容。
  - Audit 视图：负责复盘，以 Turn 为一级审计单元展示“目标、执行链、审计证据、验证、风险、缺口和最终回复是否闭环”。每个 Turn 默认显示紧凑摘要，展开后分为“执行链”和“审计证据 / 闭环阶段”两块；执行链按 `trace.root` 投影工具、handoff、子代理和 lazy-child 节点，并在每个执行节点下内嵌行动、输出证据、验证、风险和缺口子层级；连续命中执行聚合规则的节点会折叠为可展开执行组，例如多次读取文件、列出目录会聚合为“执行组 · 收集文件与目录信息”。审计证据区按目标、推理、执行、证据、验证、风险/缺口、结论七个阶段展示闭环。Audit 节点按 `traceNodeId`、`itemRef`、`turnIndex` 挂载为状态徽标或证据行，无法可靠挂载的节点进入“未关联”区域。右侧 Review Dock 负责解释当前 Turn、执行节点、Audit 节点、关联项或 Raw event 的可信度、证据、关系和来源。
  - Raw 视图：负责诊断，保留原始事件查看能力；它把会话事件摘要提升为主视图，左侧按事件索引和分类浏览，右侧显示选中事件的 Pretty JSON；完整 payload 仍通过单事件接口按需读取。
- 左栏始终保持为会话列表，默认展示“实时”分类；会话列表可按实时（3 小时内）、一天（3 小时到 1 天）和更早（1 天以上或未知时间）切换，每个时间分类下再按工作目录聚合。精简视图目录会体现每个子代理是在哪个 Turn 下启动的，子代理下继续递归展示自己的 Turn。若未来出现子代理再 spawn 子代理，也会继续展开；若数据形成循环，会在目录中截断已出现过的线程以避免无限展开。
- 执行树模型使用 `thread_spawn_edges` 作为父子线程强关系，使用 `threads.agent_nickname`、`threads.agent_role`、`threads.rollout_path` 展示子代理元数据；主界面不再单独暴露 Trace 视图，Audit 和 Review Dock 按需展示执行节点。
- JSONL 中的 `spawn_agent`、`wait_agent`、`subagent_notification` 用于把子代理节点锚定到父会话时间线中。
- 精简视图会内嵌直接子代理及其下级子代理的轻量消息摘要，默认最多递归 3 层；完整子代理正文仍通过打开对应会话查看。
- 点击子代理小卡片或精简视图中的“打开会话”会按会话 ID 切换到对应子线程。
- 会话详情接口默认返回轻量渲染模型：工具参数、事件 payload 只返回预览和长度信息，避免 MB 级内容一次性进入浏览器 DOM；内部 turn/item 模型仍保留完整工具输出，供导出、Audit 和外部查询使用。
- 精简视图的用户/助手消息支持常用 Markdown 渲染，包括标题、列表、引用、行内代码、代码块、链接、粗体、斜体、删除线和 GFM 管道表格；会话标题在列表、顶部标题、详情和精简视图中支持行内 Markdown 链接、代码和强调；渲染层禁用原始 HTML，并缓存解析结果以减少大段消息重复渲染成本。
- 右侧 Review Dock 是对象级复核台，默认展示 Session Brief；选中 Turn、执行节点、Audit 节点、关联项或 Raw event 后，统一切换为“摘要 / 证据 / 关系 / 来源”四页。它不再展示关键事件列表，也不默认渲染完整 JSON。
- 完整原始事件通过 `GET /api/sessions/:id/events/:index` 按需读取；Review Dock 只有在“来源”页读取完整 Raw payload 或执行复制 JSON 动作时才请求完整事件。
- 图片和附件默认只以安全摘要进入轻量模型：data URI 会记录媒体类型和估算大小但不进入列表、搜索索引或默认 DOM；URL/文件引用只显示占位，不自动远程拉取。
- Markdown 导出通过 `GET /api/sessions/:id/markdown` 按需生成，不内嵌在详情响应中。
- 页面支持会话搜索、Session Brief、对象级复核、证据包复制、按需 Raw 来源读取和 Markdown 导出。

### Audit Chain

Audit Chain 是只读派生模型，不修改原始会话数据。服务端在会话详情里基于轻量 `turns/items` 生成 `audit.nodes` 和 `audit.counts`，前端不再把节点平铺成时间线，而是按 Turn 聚合展示。Turn 摘要展示意图、最终结果、验证状态、最高风险和工具/子代理/证据/缺口计数；展开后，“执行链”回答这个 Turn 怎么做的，并在每个执行节点下展示相关行动、证据、验证、风险和缺口；“审计证据 / 闭环阶段”按目标、推理、执行、证据、验证、风险/缺口、结论七段回答最终回复是否被支撑。前端展示 Audit 节点时会应用可读摘要规则，把高频工具调用压缩成人类可扫描的动作短语；执行链还会按可配置聚合规则把连续的同类执行节点折叠为执行组，组内节点可展开查看并继续支持 Review Dock 选择；“来源”页和复制 JSON 仍保留原始节点结构。

执行聚合规则是前端展示规则，默认至少 2 个连续命中节点才会成组，内置规则覆盖文件/目录信息收集、代码搜索定位和 Git 状态/差异检查。规则包含名称、工具匹配、最少连续节点数、匹配正则、组标题模板和组摘要模板，保存在当前浏览器 localStorage；清空自定义后回退到内置规则。聚合只改变 Audit 执行链的视觉层级，不改变搜索到的原始执行节点、Audit 节点、Review Dock 来源或 Raw event。

前端按内容搜索和 Audit 专用节点类型过滤展示（全部、意图、推理、行动、证据、验证、风险、最终回复），不复用普通事件分类或 Raw 事件类型语义。搜索或筛选命中风险、证据、验证或工具节点时，会保留所在 Turn 摘要和必要执行链上下文，避免显示孤立风险列表。节点类型包括：

- `intent`：有效用户消息，代表用户意图。
- `reasoning`：reasoning 摘要或助手中间说明；加密 reasoning 只标注状态，不伪造内容。
- `action`：工具调用，包含工具名、参数预览、turn、时间和 source/event index。
- `evidence`：工具输出证据，包含输出预览、状态和输出事件索引。
- `verification`：测试、检查、构建、lint、Playwright、`node --test`、健康检查类命令或输出。
- `risk`：由启发式规则生成的风险信号节点，关联原始行动/证据/最终回复。
- `final`：每轮最后一条助手回复，作为最终声明入口。

第一版风险规则集中在 `src/audit-chain.mjs`，保持可解释和可扩展：

- 文本包含 `error`、`failed`、`fail`、`exception`、`stderr`、`失败`、`错误` 等风险词会生成风险。
- 可执行 shell/terminal/command 类工具的真实命令段疑似执行 `rm`、`del`、`Remove-Item`、`git reset`、`git clean`、`drop`、`delete`、`format`、`Format-Volume` 等危险动作时标记为中高风险；`rg/grep/findstr` 搜索文本和 `Format-Table/Format-List` 展示格式化不算危险命令；补丁或文本编辑类工具里出现这些词只标记为低风险复核信号，不代表实际执行了危险命令。
- 最终回复包含“已测试、测试通过、验证通过、完成、已修复”等声明，但本会话没有检测到 `verification` 节点时，标记“声明缺少验证证据”。
- 有工具调用但没有对应输出时，标记低到中风险。
- 工具参数、输出或 payload 被轻量模型截断时，只保留截断标记和原始事件索引，供 Review Dock 来源页或 Raw 视图按需复核；不会单独生成 Audit 节点，也不会计入风险或缺口。

风险节点只是复核信号，用来提示需要回看原始事件、工具输出或声明依据，不代表安全证明，也不等同于失败判定。

证据映射采用尽力而为策略：执行结构以 `trace.root` 为骨架，Audit 节点通过 `traceNodeId`、`itemRef` 和 `turnIndex` 投影到对应 Turn 或执行节点；`relatedNodeId` 只用于 Review Dock 中的关联跳转，不用于反推树父子关系。无法可靠挂载到执行链的 Audit 节点会显示在“未关联”区域，不会静默丢失。

Audit 节点保留 `itemRef`、`eventIndex/sourceIndex`、`traceNodeId` 和工具名；右侧 Review Dock 可复制引用、摘要、证据包或 JSON，并在存在事件索引时跳到 Raw event。完整 Raw JSON 仍通过单事件接口按需读取，不会把整条 JSONL 原文嵌入会话详情。

## 本地 API

- `GET /api/health`：查看只读数据源和服务状态。
- `GET /api/sources`：列出本机和远程数据源、刷新状态和脱敏失败原因。
- `GET /api/peers`：列出页面管理的远端设备配置，token 只返回 `hasToken`。
- `POST /api/peers` / `PUT /api/peers/:id` / `DELETE /api/peers/:id`：新增、更新、删除远端设备配置，并热重载数据源。
- `POST /api/peers/:id/test`：用已保存 token 调用对端健康检查。
- `POST /api/sources/:sourceId/refresh`：刷新远程数据源快照；本机数据源不可刷新。
- `GET /api/sessions`：读取轻量会话列表，优先来自 SQLite。
- `GET /api/sessions/:id`：读取单个会话的轻量渲染模型、Trace 和事件摘要。
- `GET /api/sessions/:id/events/:index`：读取单个完整 JSONL 事件。
- `GET /api/sessions/:id/markdown`：按需导出完整 Markdown。

旧的 `/api/sessions...` 接口保持兼容，默认读取 `local` 数据源，也可临时用 `?sourceId=<id>` 指定数据源。新代码优先使用显式数据源接口：

- `GET /api/sources/:sourceId/sessions`
- `GET /api/sources/:sourceId/index?bucket=day|earlier&q=...`：代理远端历史索引检索，只返回会话元数据，不返回正文。
- `GET /api/sources/:sourceId/sessions/:id`
- `GET /api/sources/:sourceId/sessions/:id/events/:index`
- `GET /api/sources/:sourceId/sessions/:id/markdown`

### 外部查询 API

外部项目优先使用 `/api/query/*`。这些接口返回稳定的 JSON 结构，支持字段投影、分页和增量读取；旧的 `/api/sessions/*` 继续服务本项目浏览器页面。查询 API 默认读取 `local` 数据源，也可用 `?sourceId=<id>` 指定数据源，或使用显式数据源路径 `/api/sources/:sourceId/query/*`。

#### 查询会话列表

```http
GET /api/query/sessions?changedAfter=2026-06-25T00:00:00.000Z&limit=50
```

响应：

```json
{
  "sessions": [
    {
      "id": "thread-id",
      "title": "会话标题",
      "preview": "首条预览",
      "cwd": "D:\\github\\project",
      "model": "gpt-5",
      "archived": false,
      "startedAt": "2026-06-25T07:00:00.000Z",
      "updatedAt": "2026-06-25T08:00:00.000Z",
      "changedAt": "2026-06-25T08:00:00.000Z",
      "links": {
        "detail": "/api/sessions/thread-id",
        "compactView": "/api/query/sessions/thread-id/view?view=compact",
        "events": "/api/query/sessions/thread-id/events",
        "markdown": "/api/sessions/thread-id/markdown"
      }
    }
  ],
  "page": {
    "offset": 0,
    "limit": 50,
    "returned": 1,
    "total": 1,
    "nextCursor": null
  },
  "watermark": "2026-06-25T08:00:00.000Z",
  "serverTime": "2026-06-25T08:10:00.000Z"
}
```

常用参数：

- `q`：在标题、预览、工作目录、模型、来源、代理昵称/角色等字段中做包含匹配。
- `changedAfter` / `changedBefore`：按 `updatedAt || fileModifiedAt || startedAt` 筛选，适合外部项目轮询增量会话。
- `startedAfter` / `startedBefore`：按会话开始时间筛选。
- `id` / `ids`：筛选指定会话 ID，支持逗号分隔或重复参数。
- `cwd`、`title`、`model`、`source`、`threadSource`、`modelProvider`、`agentNickname`、`agentRole`：字段包含匹配。
- `archived=true|false|any`：按归档状态筛选。
- `includeChildren=true`：包含子代理线程；默认只返回根会话，和浏览器左栏保持一致。
- `isChild=true|false`、`hasChildren=true|false`：按父子线程关系筛选。
- `sort=changedAt|updatedAt|startedAt|title|id|sizeBytes`，`order=asc|desc`：排序。
- `limit`：每页数量，默认 `100`，最大 `500`。
- `cursor`：上一页响应的 `page.nextCursor`。
- `fields=id,title,changedAt,links`：只返回指定字段；`id` 会始终保留。
- `includePath=true`：额外返回本机绝对 JSONL 路径。默认不返回绝对路径，避免外部消费者不必要地耦合本机目录。

推荐增量同步方式：

1. 首次请求 `GET /api/query/sessions?limit=100`，保存响应里的 `watermark`。
2. 继续用 `cursor` 拉取剩余分页，直到 `nextCursor` 为 `null`。
3. 下一轮轮询使用 `changedAfter=<上次保存的 watermark>`。

#### 读取会话视图

```http
GET /api/query/sessions/:id/view?view=compact&maxDepth=3
```

`view` 可选：

- `compact`：精简视图，只包含每轮有效用户输入、最后助手回复和内嵌子代理摘要，适合大多数外部阅读场景。
- `turns`：turn/item 阅读模型，包含工具调用预览，供导出、Audit 和外部查询使用。
- `audit`：审计链模型，包含意图、推理、行动、证据、验证、风险和最终回复节点，适合外部工具做证据链复核。
- `trace`：执行树模型，适合审计工具调用、handoff 和子代理关系；这是外部查询 API 能力，不再作为浏览器主视图入口展示。
- `detail`：完整轻量详情，等价于组合返回 `session`、`turns`、`events`、`stats`、`trace`、`compact`、`audit`。

`maxDepth` 控制精简视图递归内嵌子代理层数，默认 `3`，最大 `8`。

#### 增量读取会话事件

```http
GET /api/query/sessions/:id/events?cursor=0&limit=100
```

响应：

```json
{
  "session": {
    "id": "thread-id",
    "title": "会话标题",
    "changedAt": "2026-06-25T08:00:00.000Z"
  },
  "events": [
    {
      "index": 0,
      "timestamp": "2026-06-25T07:00:00.000Z",
      "kind": "user_message",
      "important": true,
      "type": "event_msg",
      "payloadType": "user_message",
      "role": null,
      "title": "user_message",
      "preview": "用户输入",
      "payloadSize": 128
    }
  ],
  "page": {
    "cursor": 0,
    "limit": 100,
    "maxScan": 5000,
    "scanned": 100,
    "returned": 100,
    "nextCursor": 100,
    "hasMore": true
  },
  "serverTime": "2026-06-25T08:10:00.000Z"
}
```

事件参数：

- `cursor`：从指定事件逻辑索引开始读取。也可用 `after=123` 表示从 `124` 开始。
- `limit`：最多返回事件数，默认 `100`，最大 `1000`。
- `maxScan`：筛选条件很窄时最多向后扫描的事件数，默认 `5000`，最大 `50000`。
- `kind` / `kinds`：按事件分类筛选，如 `user_message`、`agent_message`、`function_call`。
- `type` / `types`：按 JSONL 顶层 `type` 筛选，如 `event_msg`、`response_item`。
- `payloadType` / `payloadTypes`：按 `payload.type` 筛选。
- `role` / `roles`：按 `payload.role` 筛选。
- `important=true|false|any`：按重要事件筛选；`onlyImportant=true` 是兼容别名。
- `from` / `to`：按事件时间范围筛选。
- `q`：在标题、预览、分类和规范化搜索文本中做包含匹配；默认不索引 `encrypted_content` 或 data URI 原文。
- `includePayload=true`：返回完整 `payload`。
- `includeRaw=true`：返回完整原始事件。
- `fields=index,timestamp,kind,preview`：只返回指定字段；`index` 会始终保留。

注意：事件接口按 JSONL 逻辑行索引增量读取。使用筛选条件时，`page.nextCursor` 代表下一次应继续扫描的位置，不等于最后一个返回事件的 `index + 1`。查询路径会保留 JSONL 解析失败行的诊断事件，`kind` 为 `jsonl_parse_error`，包含行号、错误类别和安全预览。

## 已知边界

- JSONL 中的 reasoning 详细内容通常是加密字段，只能展示摘要或提示。
- 当前本机样本中的 `reasoning.summary` 为空，真实推理内容在 `encrypted_content` 中，因此页面不会伪造“推理摘要”；默认搜索和轻量预览不会包含 `encrypted_content` 原文。
- Trace duration 并非所有节点都有明确开始/结束时间；缺失结束时间时会标注为估算。
- Codex App 原始 `.map` 未随包发布，因此本项目不会尝试还原官方 TSX 源码。
- 不同 Codex 版本的事件字段可能变化；Raw 主视图和 Review Dock 的来源页保留按需 JSON 诊断入口。
- HTTP 快照下载要求远端提供 Codex Home 快照包，本项目不会把远程设备暴露成通用文件浏览器。
- 远程 token 只能从运行时环境变量读取；不要写入 README、`.env.example` 之外的仓库文件、Issue 评论、日志或 API 响应。
