# Codex 本机会话渲染器

这个小工具只读扫描当前用户的 Codex 会话文件，并在浏览器里渲染成本地会话查看器。

## 数据来源

- 会话元数据：`%USERPROFILE%\.codex\state_5.sqlite`，用于读取标题、工作目录、模型、推理强度和归档状态。
- 正文事件流：`%USERPROFILE%\.codex\sessions\**\*.jsonl`
- 轻量索引回退：`%USERPROFILE%\.codex\session_index.jsonl`
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

## 项目结构

- `server.mjs`：HTTP 路由、会话文件定位、缓存和接口编排；底层响应、SQLite、DTO 和解析逻辑已拆到 `src/`。
- `src/jsonl-reader.mjs`：UTF-8 JSONL 流式读取工具；支持按逻辑行数上限读取和按事件索引读取单条事件。
- `src/http-response.mjs`：JSON/Text 响应、错误响应、静态文件类型和路径安全解析。
- `src/sqlite-threads.mjs`：只读 SQLite 查询、线程行映射、spawn edge 读取和 SQL 字符串转义。
- `src/session-models.mjs`：服务端 API 会话 DTO、列表 DTO、线程元数据和文件 stat 合并。
- `src/text-utils.mjs`：时间、路径、首行摘要、消息正文提取和文本规范化等基础纯函数。
- `src/tool-events.mjs`：工具调用开始/结束识别、工具名/参数/输出提取、MCP 结果渲染和输出合并。
- `src/event-summary.mjs`：事件分类、重要事件判断、标题/预览摘要和会话事件计数。
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
- 前端使用原生 HTML/CSS/JavaScript，无构建步骤；Markdown 渲染通过本地 `markdown-it` 浏览器包完成。
- 会话列表优先读取 SQLite `threads` 表，并在 SQLite 查询层排除 `thread_spawn_edges.child_thread_id` 对应的子代理线程，避免子代理在左侧会话列表独立展示；只有 SQLite 不可用时才回退扫描文件。
- JSONL 读取使用流式逐行解析；列表回退读取前若干条事件时不会把整个大文件一次性读入内存。
- 解析器把 JSONL 中的 `session_meta`、`turn_context`、`event_msg`、`response_item` 聚合为 turn 和 item。
- 工具调用会合并 `function_call`、`function_call_output`、`custom_tool_call`、`custom_tool_call_output`、`mcp_tool_call_end`、`patch_apply_end` 等 Codex 事件。
- 同一条用户/助手消息如果同时出现在 response item 和事件消息里，会在渲染层去重。
- 页面默认进入精简视图，并提供三种视图：
  - 阅读视图：按 turn 展示用户、助手、工具调用、输出和 token 统计，适合阅读对话。
  - 精简视图：只展示每轮 turn 的用户输入和该 turn 结束时的最后一条助手消息；如果父会话中有 `spawn_agent` 子代理，会按父子层级内嵌展示子代理自己的用户输入和每轮最后助手消息，并在目录中按“会话 -> Turn -> 子代理 -> 子代理 Turn”展示执行层级用于快速跳转；执行层级区域会尽量使用可用视口高度展示更多目录内容。
  - Trace 视图：按 Root Thread、Turn、Tool、Handoff、Subagent 形成可审计执行树，Turn 会显示从用户消息、子代理委派或工具调用中提取的摘要名称；默认只展开 Root，Turn 细节按需展开。
- 左栏始终保持为会话列表，默认展示“实时”分类；会话列表可按实时（3 小时内）、一天（3 小时到 1 天）和更早（1 天以上或未知时间）切换，每个时间分类下再按工作目录聚合。精简视图目录会体现每个子代理是在哪个 Turn 下启动的，子代理下继续递归展示自己的 Turn。若未来出现子代理再 spawn 子代理，也会继续展开；若数据形成循环，会在目录中截断已出现过的线程以避免无限展开。
- Trace 视图使用 `thread_spawn_edges` 作为父子线程强关系，使用 `threads.agent_nickname`、`threads.agent_role`、`threads.rollout_path` 展示子代理元数据。
- JSONL 中的 `spawn_agent`、`wait_agent`、`subagent_notification` 用于把子代理节点锚定到父会话时间线中。
- 精简视图会内嵌直接子代理及其下级子代理的轻量消息摘要，默认最多递归 3 层；Trace 和阅读视图仍不内嵌完整子代理正文。
- 点击子代理小卡片或精简视图中的“打开会话”会按会话 ID 切换到对应子线程。
- 会话详情接口默认返回轻量渲染模型：工具参数、工具输出、事件 payload 只返回预览和长度信息，避免 MB 级内容一次性进入浏览器 DOM。
- 阅读视图和精简视图的用户/助手消息支持常用 Markdown 渲染，包括标题、列表、引用、行内代码、代码块、链接、粗体、斜体、删除线和 GFM 管道表格；会话标题在列表、顶部标题、详情、精简视图和 Trace 标题中支持行内 Markdown 链接、代码和强调；渲染层禁用原始 HTML，并缓存解析结果以减少大段消息重复渲染成本。
- 完整原始事件通过 `GET /api/sessions/:id/events/:index` 按需读取；右侧 Inspector 点选事件时才请求完整 payload。
- Markdown 导出通过 `GET /api/sessions/:id/markdown` 按需生成，不内嵌在详情响应中。
- 页面支持会话搜索、详情查看、事件检查器、重要事件过滤和 Markdown 导出。

## 本地 API

- `GET /api/health`：查看只读数据源和服务状态。
- `GET /api/sessions`：读取轻量会话列表，优先来自 SQLite。
- `GET /api/sessions/:id`：读取单个会话的轻量渲染模型、Trace 和事件摘要。
- `GET /api/sessions/:id/events/:index`：读取单个完整 JSONL 事件。
- `GET /api/sessions/:id/markdown`：按需导出完整 Markdown。

## 已知边界

- JSONL 中的 reasoning 详细内容通常是加密字段，只能展示摘要或提示。
- 当前本机样本中的 `reasoning.summary` 为空，真实推理内容在 `encrypted_content` 中，因此页面不会伪造“推理摘要”。
- Trace duration 并非所有节点都有明确开始/结束时间；缺失结束时间时会标注为估算。
- Codex App 原始 `.map` 未随包发布，因此本项目不会尝试还原官方 TSX 源码。
- 不同 Codex 版本的事件字段可能变化；解析器保留原始事件检查器用于诊断。
