# Codex 会话工作台

Codex 会话工作台是只读的会话浏览器。它把 Codex 与 Pi Agent 的 JSONL 会话记录整理为适合阅读的界面，帮助用户快速理解 agent 收到的任务、生成的回复、调用的工具、委派的子代理和执行时间。

## 产品决策

本项目专注于会话的展示效果，不提供风险识别、缺口推断、验证结论、缺陷登记或人工复核工作流。

原因是会话记录只能说明 agent 在一次执行中做了什么，不能可靠证明安全性、正确性或缺陷归因。把启发式信号包装成风险或复核结论会干扰用户理解原始执行过程。

产品核心目标是让会话记录更易读，并让用户以固定顺序完成理解：先连续阅读当前会话，再定位另一段会话，最后按需分析执行细节。

- 默认界面是会话目录和正文组成的两栏阅读器。目录首屏只保留数据源、搜索和会话结果，并按工作目录组织为可折叠的项目树，会话作为目录叶子显示；时间与类型条件按需展开，任务归档和数据源管理收纳到更多操作；正文不保留常驻执行目录、统计条或工具详情栏。
- 会话正文按轮次完整显示用户输入、助手消息、推理摘要、工具参数和输出，不按字符数裁剪正文。原始事件列表按页加载，选中任一事件后显示该事件的完整 JSON。
- 会话标题在目录中最多显示两行，只有实际超出时才使用省略号；路径、状态、统计和执行链路等受限概览文本在实际被截断时可悬停查看完整原文，避免长文本破坏页面布局。
- 主工作区提供并列的“正文 / 执行 / 诊断”三视图。正文默认显示；执行视图用完整主区展示执行树，并在需要时并列工具详情；诊断视图用完整主区展示统计或原始事件。工具节点直接显示参数摘要，点击后可查看完整调用参数和返回结果。
- 工具摘要规则只改善文字可读性，不改变会话事实或推导任何结论。

## 数据来源

- Codex 元数据：`~/.codex/state_5.sqlite`
- Codex 会话：`~/.codex/sessions/**/*.jsonl`
- Pi Agent 会话：自动发现 `~/.pi/agent/sessions/**/*.jsonl`，也可通过 `PI_AGENT_SESSIONS_ROOT` 或 `PI_AGENT_TASKS_ROOT` 配置。内嵌 `subagent` 调用会按轮次汇总为连续执行组，展示每次调用的任务、状态与短回报预览，完整回报按需展开，并保留原始事件跳转；会话侧栏目录和执行过程树同时展示“内嵌调用 → 子代理”节点。各处投影都不会伪装成可打开的独立子会话。Pi 会话首部的 `parentSession` 会解析为分叉链：列表中同项目的子会话缩进展示并带“分叉”徽标，详情头部提供“⤴ 分叉自 …”“分叉出 N 个会话”的跳转链接，父会话已被清理时如实标注不在当前目录。
- 远端数据源：先拉取到本地快照后只读浏览，历史范围仅查询远端索引，不读取历史正文

Pi Agent 会话目录可用时，工作台默认展示 Pi 数据源；未发现 Pi Agent 会话目录时，自动回退到本机 Codex 数据源。

原始会话文件不会被修改。Markdown 导出和浏览器展示均基于本地文件或已发布的本地快照。

## 完整详情与诊断预算

完整详情、compact/view、turns/trace 和 Markdown 导出读取当前会话的完整 JSONL，不因文件大小或事件数降级。读取前后文件签名变化时，详情返回非完整读取状态，Markdown 返回 `409`，旧结果不会进入缓存。

原始事件分页是独立诊断入口，受 `CODEX_SESSION_DIAGNOSTIC_MAX_FILE_BYTES` 和 `CODEX_SESSION_DIAGNOSTIC_MAX_EVENT_SCAN` 约束。详情并发、诊断上限和缓存可分别通过 `CODEX_SESSION_DETAIL_MAX_CONCURRENT_READS`、`CODEX_SESSION_DIAGNOSTIC_MAX_FILE_BYTES`、`CODEX_SESSION_DIAGNOSTIC_MAX_EVENT_SCAN`、`CODEX_SESSION_DETAIL_MAX_CACHE_ENTRIES` 与 `CODEX_SESSION_DETAIL_MAX_CACHE_BYTES` 配置。

## 启动

```bash
npm install
npm start
```

默认地址为 `http://127.0.0.1:4789/`。

可设置以下环境变量：

```bash
HOST=0.0.0.0 \
PORT=4789 \
CODEX_SESSION_RENDERER_TOKEN='<随机且足够长的访问令牌>' \
npm start
```

非 loopback 地址必须设置 `CODEX_SESSION_RENDERER_TOKEN`。局域网访问使用 HTTP Basic 认证，用户名为 `codex`，密码为该令牌。

## 开发检查

```bash
npm run lint
npm test
npm run test:e2e
```

主要实现位于：

- `server.mjs`：只读 HTTP API、数据源和详情协调。
- `src/session-*.mjs`：会话发现、规范化、查询、事件聚合、执行时间与 Markdown 导出。
- `public/app.js`：会话阅读、执行过程、统计和原始事件界面。
- `public/tool-summary.js`：可配置的工具调用可读摘要。
