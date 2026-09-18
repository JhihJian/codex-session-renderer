# 实现参考

本页是架构文档的实现下钻入口，记录当前责任单元的源码、运行边界和验证位置。HTTP 参数、事件字段和兼容 profile 由对应源码契约负责。

## 服务装配

- `server.mjs` 是主 HTTP 服务装配入口。`src/session-router.mjs` 负责 HTTP 方法、路径、取消订阅、响应映射和静态资源回退；`src/session-query-service.mjs` 装配只读会话查询接口。
- `src/access-control.mjs` 对主服务的非 loopback 监听强制令牌，并支持 Basic 或 Bearer 请求认证；`src/http-response.mjs` 统一 HTTP 响应与错误输出。

## 数据源

`src/data-sources.mjs` 创建本机 Codex 与可选 Pi Agent 来源。Pi Agent 会话根存在时成为默认来源，否则使用本机 Codex；来源均只读。

## 会话与阅读投影

- `src/session-catalog.mjs`、`src/sqlite-threads.mjs`、`src/jsonl-reader.mjs` 和 `src/session-models.mjs` 负责目录发现、索引读取、JSONL 读取和来源化会话模型。
- `src/session-normalizer.mjs`、`src/session-events.mjs`、`src/embedded-subagents.mjs`、`src/event-summary.mjs` 与 `src/session-timing.mjs` 负责事件稳定化、子代理、摘要和时间投影。`src/session-events.mjs` 保持历史 API；其投影实现按 `session-turn-projection.mjs`、`session-compact-reading-projection.mjs`、`session-execution-trace-projection.mjs`、`session-trace-node-projection.mjs` 和 `session-projection-shared.mjs` 的单向依赖拆分。
- `src/session-source-context-service.mjs`、`src/session-directory-query-service.mjs`、`src/session-catalog-query-service.mjs`、`src/session-detail-query-service.mjs` 与 `src/session-event-query-service.mjs` 分别负责来源状态、目录、列表、详情和 Raw 事件查询；它们由查询服务装配层对路由公开。
- `src/session-detail-coordinator.mjs` 管理完整详情的文件签名、并发、取消和缓存。
- 事件字段、Goal profile、控制包投影、Raw 保留和完整详情/诊断预算由[事件规范化契约](../session-event-normalization.md)完整负责。

## 浏览器界面

`public/app.js` 只负责初始化。`public/app-state.js` 持有浏览器状态和共享格式化依赖，`public/app-requests*.js` 负责来源、列表、详情与 Raw 请求，`public/app-view-*.js` 负责会话目录、正文、紧凑阅读、执行、统计、诊断、终端和设置渲染，`public/app-ui.js` 绑定交互。它们按 `public/index.html` 中的依赖顺序通过 `window.SessionWorkbench` 显式注册能力。工具摘要由 `public/tool-summary.js` 保持稳定门面，规则、文本提取、补丁解析和命令输出模型分别由 `public/tool-summary-{rules,text,patch,command-output}.js` 提供，按依赖顺序注册内部能力；`public/package.json` 仅为 Node 测试保留同一门面的 CommonJS 入口。样式仍由 `public/index.html` 加载 `public/styles.css`，后者按既有层叠顺序导入 `public/styles/` 下的基础、工作区、阅读、各视图与响应式样式。默认阅读面限制为紧凑目录和正文，执行与诊断在切换后占据完整主工作区。筛选与低频管理能力按需展开。`src/pi-context-events.mjs` 仅从 Pi JSONL 投影 Skill 指令块和 `SKILL.md` 读取证据，不扫描当前磁盘作为历史事实。`public/app-format.js`、`public/tool-summary.js`、`public/raw-event-cache.js` 与 `public/evidence-id.js` 提供展示格式、工具摘要、诊断缓存和稳定定位辅助。浏览器不直接读取会话来源路径。

## 验证入口

- `npm run lint` 执行 ESLint。
- `npm test` 执行语法检查、Node 单元测试和 HTTP 冒烟测试。
- `npm run test:e2e` 执行 Playwright 端到端测试。

关键验证包括：`test/session-detail-coordinator.test.mjs` 覆盖详情缓存与并发读取，`test/codex-goal-http.test.mjs` 覆盖 Goal 投影与 Raw 保留，`test/server-access-control.test.mjs` 覆盖非 loopback 服务的认证边界。