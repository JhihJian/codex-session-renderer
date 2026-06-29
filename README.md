# Codex 本机会话渲染器

这个小工具只读扫描 Codex 会话文件，并在浏览器里渲染成本地会话查看器。默认数据源仍是当前用户的本机 Codex Home；也可以把远程设备的 Codex Home 先刷新成本地快照，再作为独立数据源查看。

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

远程数据源通过“刷新到本地快照，再从快照读取”的方式工作。刷新失败不会删除上一份可用快照；如果已有旧快照，页面仍可继续浏览，并在数据源状态里标注失败或旧快照。

首版支持两种获取方式：

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

启动后页面左侧会出现“数据源”选择框。选择远程数据源后点击“刷新远程”，服务端会把远端内容复制或下载到本地快照目录，然后原子发布到：

```text
%USERPROFILE%\.codex-session-renderer\remote-snapshots\<source-id>\current
```

可通过 `CODEX_REMOTE_SNAPSHOT_ROOT` 修改快照根目录。快照目录包含会话正文、命令输出、项目路径和错误栈等敏感信息，应按本机私密数据处理，不要提交到 git 或上传到公开位置。当前 `.gitignore` 已默认忽略 `*.sqlite`、`*.jsonl`、`*.log`、`.env*`、`tmp/` 等常见运行时文件；如果把快照根目录放进仓库工作区，需要额外把该目录加入忽略规则。

远程状态只暴露脱敏信息：是否刷新中、最近成功刷新时间、是否正在浏览旧快照、失败类别和简短原因。API 响应、状态文件和普通错误信息不会包含 token、认证头或会话正文。

## 项目结构

- `server.mjs`：HTTP 路由、数据源分发、会话文件定位、缓存和接口编排；底层响应、SQLite、DTO 和解析逻辑已拆到 `src/`。
- `src/data-sources.mjs`：本机/远程数据源配置、远程快照刷新、原子发布和脱敏状态。
- `src/jsonl-reader.mjs`：UTF-8 JSONL 流式读取工具；支持按逻辑行数上限读取和按事件索引读取单条事件。
- `src/http-response.mjs`：JSON/Text 响应、错误响应、静态文件类型和路径安全解析。
- `src/sqlite-threads.mjs`：只读 SQLite 查询、线程行映射、spawn edge 读取和 SQL 字符串转义。
- `src/session-models.mjs`：服务端 API 会话 DTO、列表 DTO、线程元数据和文件 stat 合并。
- `src/text-utils.mjs`：时间、路径、首行摘要、消息正文提取和文本规范化等基础纯函数。
- `src/tool-events.mjs`：工具调用开始/结束识别、工具名/参数/输出提取、MCP 结果渲染和输出合并。
- `src/event-summary.mjs`：事件分类、重要事件判断、标题/预览摘要和会话事件计数。
- `src/session-query.mjs`：面向外部项目的会话查询、筛选、分页游标、字段投影和事件增量查询参数处理。
- `src/markdown-export.mjs`：会话 Markdown 导出。
- `src/session-events.mjs`：会话事件核心解析逻辑，包括 turn 聚合、Trace 模型、精简视图模型和子代理锚定；同时重新导出旧的常用解析 API 以保持调用兼容。
- `public/`：无构建前端，包含页面、样式、交互脚本和本地 `markdown-it` 浏览器包。
- `public/app-format.js`：前端格式化、转义、高亮、路径缩短和文件名清理工具；通过浏览器全局 `window.AppFormat` 暴露，避免引入构建步骤。
- `test/`：Node 内置测试，覆盖 JSONL 读取、HTTP/静态文件边界、SQLite 映射、服务端 DTO、事件摘要、工具协议、事件解析、前端格式化和 Markdown 导出等回归点。

后续维护时，优先把可纯函数化的逻辑放进对应 `src/` 小模块并补测试；`server.mjs` 只负责数据来源、缓存和接口组合。前端如新增通用格式化/转义逻辑，优先放进 `public/app-format.js` 并在 `test/app-format.test.mjs` 覆盖。

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
- 远程数据源只在刷新阶段访问配置好的快照 URL 或快照目录；普通会话列表、会话辅助面板和 Markdown 导出都从本地 `current` 快照读取。
- 远程快照刷新使用 staging 目录构建，再原子切换到 `current`。刷新失败不会覆盖上一次成功快照。
- 远程 SQLite 中的远端 `rollout_path` 会按配置的远端 Codex Home 映射到本地快照 Codex Home。
- 本地 API 默认绑定 `127.0.0.1`，适合作为同机只读数据源；如果未来开放到局域网，需要先增加鉴权和访问控制。
- 前端使用原生 HTML/CSS/JavaScript，无构建步骤；Markdown 渲染通过本地 `markdown-it` 浏览器包完成。
- 会话列表优先读取 SQLite `threads` 表，并在 SQLite 查询层排除 `thread_spawn_edges.child_thread_id` 对应的子代理线程，避免子代理在左侧会话列表独立展示；只有 SQLite 不可用时才回退扫描文件。
- JSONL 读取使用流式逐行解析；列表回退读取前若干条事件时不会把整个大文件一次性读入内存。
- 解析器把 JSONL 中的 `session_meta`、`turn_context`、`event_msg`、`response_item` 聚合为 turn 和 item。
- 工具调用会合并 `function_call`、`function_call_output`、`custom_tool_call`、`custom_tool_call_output`、`mcp_tool_call_end`、`patch_apply_end` 等 Codex 事件。
- 同一条用户/助手消息如果同时出现在 response item 和事件消息里，会在渲染层去重。
- 页面默认进入精简视图，并提供三种视图：
  - 阅读视图：按 turn 展示用户、助手、工具调用、完整工具输出和 token 统计，适合阅读对话。
  - 精简视图：只展示每轮 turn 的用户输入和该 turn 结束时的最后一条助手消息；如果父会话中有 `spawn_agent` 子代理，会按父子层级内嵌展示子代理自己的用户输入和每轮最后助手消息，并在目录中按“会话 -> Turn -> 子代理 -> 子代理 Turn”展示执行层级用于快速跳转；执行层级区域会尽量使用可用视口高度展示更多目录内容。
  - Trace 视图：按 Root Thread、Turn、Tool、Handoff、Subagent 形成可审计执行树，Turn 会显示从用户消息、子代理委派或工具调用中提取的摘要名称；默认只展开 Root，Turn 细节按需展开。
- 左栏始终保持为会话列表，默认展示“实时”分类；会话列表可按实时（3 小时内）、一天（3 小时到 1 天）和更早（1 天以上或未知时间）切换，每个时间分类下再按工作目录聚合。精简视图目录会体现每个子代理是在哪个 Turn 下启动的，子代理下继续递归展示自己的 Turn。若未来出现子代理再 spawn 子代理，也会继续展开；若数据形成循环，会在目录中截断已出现过的线程以避免无限展开。
- Trace 视图使用 `thread_spawn_edges` 作为父子线程强关系，使用 `threads.agent_nickname`、`threads.agent_role`、`threads.rollout_path` 展示子代理元数据。
- JSONL 中的 `spawn_agent`、`wait_agent`、`subagent_notification` 用于把子代理节点锚定到父会话时间线中。
- 精简视图会内嵌直接子代理及其下级子代理的轻量消息摘要，默认最多递归 3 层；Trace 和阅读视图仍不内嵌完整子代理正文。
- 点击子代理小卡片或精简视图中的“打开会话”会按会话 ID 切换到对应子线程。
- 会话详情接口默认返回轻量渲染模型：工具参数、事件 payload 只返回预览和长度信息，避免 MB 级内容一次性进入浏览器 DOM；阅读视图里的工具输出保留完整文本，不做 output 截断。
- 阅读视图和精简视图的用户/助手消息支持常用 Markdown 渲染，包括标题、列表、引用、行内代码、代码块、链接、粗体、斜体、删除线和 GFM 管道表格；会话标题在列表、顶部标题、详情、精简视图和 Trace 标题中支持行内 Markdown 链接、代码和强调；渲染层禁用原始 HTML，并缓存解析结果以减少大段消息重复渲染成本。
- 右侧 Inspector 是会话辅助面板，默认展示会话概览、当前选中内容和按 Turn 分组的关键事件；原始 JSON 降级到折叠的调试区。
- 完整原始事件通过 `GET /api/sessions/:id/events/:index` 按需读取；右侧 Inspector 点选关键事件并查看调试 JSON 时才请求完整 payload。
- Markdown 导出通过 `GET /api/sessions/:id/markdown` 按需生成，不内嵌在详情响应中。
- 页面支持会话搜索、会话概览、选中内容详情、关键事件过滤、调试 JSON 和 Markdown 导出。

## 本地 API

- `GET /api/health`：查看只读数据源和服务状态。
- `GET /api/sources`：列出本机和远程数据源、刷新状态和脱敏失败原因。
- `POST /api/sources/:sourceId/refresh`：刷新远程数据源快照；本机数据源不可刷新。
- `GET /api/sessions`：读取轻量会话列表，优先来自 SQLite。
- `GET /api/sessions/:id`：读取单个会话的轻量渲染模型、Trace 和事件摘要。
- `GET /api/sessions/:id/events/:index`：读取单个完整 JSONL 事件。
- `GET /api/sessions/:id/markdown`：按需导出完整 Markdown。

旧的 `/api/sessions...` 接口保持兼容，默认读取 `local` 数据源，也可临时用 `?sourceId=<id>` 指定数据源。新代码优先使用显式数据源接口：

- `GET /api/sources/:sourceId/sessions`
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
- `turns`：阅读视图使用的 turn/item 模型，包含工具调用预览。
- `trace`：执行树模型，适合审计工具调用、handoff 和子代理关系。
- `detail`：完整轻量详情，等价于组合返回 `session`、`turns`、`events`、`stats`、`trace`、`compact`。

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
- `q`：在标题、预览、分类和 payload 文本中做包含匹配。
- `includePayload=true`：返回完整 `payload`。
- `includeRaw=true`：返回完整原始事件。
- `fields=index,timestamp,kind,preview`：只返回指定字段；`index` 会始终保留。

注意：事件接口按 JSONL 逻辑行索引增量读取。使用筛选条件时，`page.nextCursor` 代表下一次应继续扫描的位置，不等于最后一个返回事件的 `index + 1`。

## 已知边界

- JSONL 中的 reasoning 详细内容通常是加密字段，只能展示摘要或提示。
- 当前本机样本中的 `reasoning.summary` 为空，真实推理内容在 `encrypted_content` 中，因此页面不会伪造“推理摘要”。
- Trace duration 并非所有节点都有明确开始/结束时间；缺失结束时间时会标注为估算。
- Codex App 原始 `.map` 未随包发布，因此本项目不会尝试还原官方 TSX 源码。
- 不同 Codex 版本的事件字段可能变化；解析器保留折叠的调试 JSON 用于诊断。
- HTTP 快照下载要求远端提供 Codex Home 快照包，本项目不会把远程设备暴露成通用文件浏览器。
- 远程 token 只能从运行时环境变量读取；不要写入 README、`.env.example` 之外的仓库文件、Issue 评论、日志或 API 响应。
