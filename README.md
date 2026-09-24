# Codex 会话工作台

Codex 会话工作台是只读的会话浏览器。它把 Codex 与 Pi Agent 的 JSONL 会话记录整理为适合阅读的界面，帮助用户快速理解 agent 收到的任务、生成的回复、调用的工具、委派的子代理和执行时间。

## 产品决策

本项目专注于会话的展示效果，不提供风险识别、缺口推断、验证结论、缺陷登记或人工复核工作流。

原因是会话记录只能说明 agent 在一次执行中做了什么，不能可靠证明安全性、正确性或缺陷归因。把启发式信号包装成风险或复核结论会干扰用户理解原始执行过程。

产品核心目标是让会话记录更易读，并让用户以固定顺序完成理解：先连续阅读当前会话，再定位另一段会话，最后按需分析执行细节。

- 默认界面是会话目录和正文组成的两栏阅读器。目录首屏只保留数据源、搜索和会话结果，并按工作目录组织为可折叠的项目树，会话作为目录叶子显示；时间与类型条件按需展开；正文不保留常驻执行目录、统计条或工具详情栏。
- 会话状态由 JSONL 文件尾部推导：已完成、失败、已中断、等待输入为终态或空闲态；显示“运行中”要求文件仍在持续写入，超过阈值（默认 30 分钟，可用 `CODEX_SESSION_STALE_RUNNING_MS` 调整）没有新写入且缺少终态事件的会话显示“已停止”，避免把早已结束的会话误标为运行中。列表和详情共用同一规则。
- 会话正文按轮次完整显示用户输入、助手消息、推理摘要、工具参数和输出，不按字符数裁剪正文。原始事件列表按页加载，选中任一事件后显示该事件的完整 JSON。
- 正文在每轮末尾显示可证明的轮末上下文占用、生成 Token 和实际执行时长，并显示有持久化证据的上下文事件：Codex/Pi 的压缩时间和摘要、Pi 会话中的 Skill 指令块，以及 `read` 读取 `SKILL.md` 的记录与工具结果。启动时的系统提示、可用工具或 Skills 索引未写入 JSONL，不会由当前磁盘状态反推为历史事件。
- 会话标题在目录中最多显示两行，只有实际超出时才使用省略号；路径、状态、统计和执行链路等受限概览文本在实际被截断时可悬停查看完整原文，避免长文本破坏页面布局。
- 主工作区提供并列的“正文 / 执行 / 诊断”三视图。正文默认显示；执行视图用完整主区展示执行树，并在需要时并列工具详情；诊断视图用完整主区展示统计或原始事件。执行树的工具节点可按摘要规则替换展示名称，参数摘要和点击后的完整调用参数、返回结果始终保留会话中持久化的原文，并可跳转关联的 Raw 事件。Pi 的 `bash` 返回结果若已在工具运行时被截断，详情会明确标识该来源限制；完整输出所在的临时文件不属于会话记录，之后可能已被清理。Pi 会话中的 `<skill>` 指令块会作为“技能加载”节点进入执行树，点击后可查看技能指令与触发消息；读取 `SKILL.md` 的 `read` 调用标记为“技能读取”并以技能名命名。
- 诊断视图的统计页会按当前搜索和类型筛选，按转换后的工具目标汇总调用参数和返回结果的大小、估算 token、最大单次返回及同一目标出现次数。它以最近记录的上下文窗口为分母展示累计和最大单次返回的占用比例，并支持按返回结果、比例、最大单次返回或目标排序，以及检索目标和返回内容；每行可跳转到最大单次返回对应的 Raw 原始事件。时间统计诊断的“按轮次查看”以最长轮次时长为 100% 归一化条长，条内分段表示 LLM 等待与工具执行的占比，每轮开头展示该轮用户输入摘要。
- 桌面正文左侧提供固定高度的极简轮次时间轴。节点定位轮次，线段按轮次记录时长比例分配，琥珀细线标记本轮压缩，青绿细线标记内嵌子代理调用；它不复制执行细节，移动端不显示该导航。
- 工具摘要规则只改善执行视图中工具节点名称和诊断统计的可读性，不改变会话事实或推导任何结论，也不影响正文、Raw 诊断、参数预览或工具详情。内置规则覆盖 Pi Agent 的 `read`、`write` 和 `bash` 中的 `rg` 调用，包括 `pwd && rg ...` 形式。

## 数据来源

- Codex 元数据：`~/.codex/state_5.sqlite`
- Codex 会话：`~/.codex/sessions/**/*.jsonl`
- Pi Agent 会话：自动发现 `~/.pi/agent/sessions/**/*.jsonl`，也可通过 `PI_AGENT_SESSIONS_ROOT`、`PI_AGENT_TASKS_ROOT` 或 `PI_AGENT_EVALUATIONS_ROOT` 配置。评估根目录按 `<evaluation_id>/output/pi-sessions/**/*.jsonl` 读取，`evaluation_id` 必须是 UUID，且会进入会话 ID 以避免同名文件互相覆盖。三种显式根目录配置互斥。内嵌 `subagent` 调用会按轮次汇总为连续执行组，展示每次调用的任务、状态与短回报预览，完整回报按需展开，并保留原始事件跳转；会话侧栏目录和执行过程树同时展示“内嵌调用 → 子代理”节点。各处投影都不会伪装成可打开的独立子会话。Pi 会话首部的 `parentSession` 会解析为分叉链：列表中同项目的子会话缩进展示并带“分叉”徽标，详情头部提供“⤴ 分叉自 …”“分叉出 N 个会话”的跳转链接，父会话已被清理时如实标注不在当前目录。Pi `compaction` 直接展示摘要；`<skill>` 指令块和读取 `SKILL.md` 只展示会话内可验证的声明或读取证据，不宣称启动时已加载的 Skills。


Pi Agent 会话目录可用时，工作台默认展示 Pi 数据源；未发现 Pi Agent 会话目录时，自动回退到本机 Codex 数据源。

原始会话文件不会被修改，浏览器展示均基于本地文件。

## 完整详情与诊断预算

完整详情、compact/view 和 turns/trace 读取当前会话的完整 JSONL，不因文件大小或事件数降级。详情缓存以读取开始时的文件签名区分版本，文件更新后下一次请求会重新读取。

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

### 临时打开单个会话

页面右上角“更多操作”中的“打开本机会话”可临时读取一个本机绝对路径的 `.jsonl` 会话文件或目录。输入目录时，工作台会递归列出其中的 JSONL 会话，点击后再打开具体会话。文件或目录不会加入默认会话目录、索引或配置，刷新时只会重新读取当前路径。关闭页面后临时路径不会保留。

例如：

```text
/data/work/report-agent/main/artifacts/.../pi-sessions/2026-09-21T04-21-27-146Z_01a0c232-89ea-7bf9-b447-d03517afb4ca.jsonl
```

只接受本机可读取的绝对 `.jsonl` 常规文件或目录。评测 case 目录本身如果没有 JSONL 文件不会显示会话，需要选择包含会话文件的目录，例如 `sessions/`，也可以直接选择其中的具体 JSONL 文件。

## 开发检查

```bash
npm run lint
npm test
npm run test:e2e
```

主要实现位于：

- `server.mjs`：HTTP 服务装配入口；路由分派位于 `src/session-router.mjs`，会话查询服务由 `src/session-query-service.mjs` 装配。
- `src/session-*-projection.mjs`：按轮次、紧凑阅读、执行追踪和追踪节点职责构建会话投影，`src/session-events.mjs` 保留兼容导出门面。
- `src/session-*-query-service.mjs`：按来源上下文、目录、会话目录、详情和原始事件查询拆分只读读取服务。
- `public/app.js`：浏览器初始化入口。`public/app-state.js`、`public/app-requests*.js`、`public/app-view-*.js` 与 `public/app-ui.js` 通过 `SessionWorkbench` 注册表分别承担状态、请求、视图和交互。
- `public/styles.css`：浏览器样式入口，按原有层叠顺序导入 `public/styles/` 下的基础、工作区、阅读、视图与响应式样式。
- `public/tool-summary.js`：可配置的工具调用可读摘要。
