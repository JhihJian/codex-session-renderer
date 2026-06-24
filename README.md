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

## 设计说明

- 服务端只读访问本地文件，不写入 `.codex`。
- 前端使用原生 HTML/CSS/JavaScript，无构建步骤。
- 会话列表优先读取 SQLite `threads` 表，不再默认遍历全部 JSONL；只有 SQLite 不可用时才回退扫描文件。
- 解析器把 JSONL 中的 `session_meta`、`turn_context`、`event_msg`、`response_item` 聚合为 turn 和 item。
- 工具调用会合并 `function_call`、`function_call_output`、`custom_tool_call`、`custom_tool_call_output`、`mcp_tool_call_end`、`patch_apply_end` 等 Codex 事件。
- 同一条用户/助手消息如果同时出现在 response item 和事件消息里，会在渲染层去重。
- 页面提供两种视图：
  - 阅读视图：按 turn 展示用户、助手、工具调用、输出和 token 统计，适合阅读对话。
  - Trace 视图：按 Root Thread、Turn、Tool、Handoff、Subagent 形成可审计执行树，Turn 会显示从用户消息、子代理委派或工具调用中提取的摘要名称；默认只展开 Root，Turn 细节按需展开。
- 左栏会在选中会话后显示“当前层级”树；在父会话中显示直接子代理，在子代理会话中保留同一父会话下的兄弟子代理，便于横向切换审计。
- Trace 视图使用 `thread_spawn_edges` 作为父子线程强关系，使用 `threads.agent_nickname`、`threads.agent_role`、`threads.rollout_path` 展示子代理元数据。
- JSONL 中的 `spawn_agent`、`wait_agent`、`subagent_notification` 用于把子代理节点锚定到父会话时间线中。
- 子代理正文不内嵌到父会话详情响应里；点击子代理小卡片会按会话 ID 懒加载对应子线程。
- 会话详情接口默认返回轻量渲染模型：工具参数、工具输出、事件 payload 只返回预览和长度信息，避免 MB 级内容一次性进入浏览器 DOM。
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
