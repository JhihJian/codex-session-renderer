# 实现参考

本页是架构文档的实现下钻入口，记录当前责任单元的源码、运行边界和验证位置。HTTP 参数、事件字段和兼容 profile 由对应源码契约负责。

## 服务装配

- `server.mjs` 是主 HTTP 服务入口。它装配访问控制、来源注册表、来源上下文、会话读取、静态资源和浏览器 API。
- `src/access-control.mjs` 对主服务的非 loopback 监听强制令牌，并支持 Basic 或 Bearer 请求认证；`src/http-response.mjs` 统一 HTTP 响应与错误输出。

## 数据源

`src/data-sources.mjs` 创建本机 Codex 与可选 Pi Agent 来源。Pi Agent 会话根存在时成为默认来源，否则使用本机 Codex；来源均只读。

## 会话与阅读投影

- `src/session-catalog.mjs`、`src/sqlite-threads.mjs`、`src/jsonl-reader.mjs` 和 `src/session-models.mjs` 负责目录发现、索引读取、JSONL 读取和来源化会话模型。
- `src/session-normalizer.mjs`、`src/session-events.mjs`、`src/embedded-subagents.mjs`、`src/event-summary.mjs` 与 `src/session-timing.mjs` 负责事件稳定化、轮次、子代理、摘要和时间投影。
- `src/session-detail-coordinator.mjs` 管理完整详情的文件签名、并发、取消和缓存；`src/markdown-export.mjs` 输出 Markdown。
- 事件字段、Goal profile、控制包投影、Raw 保留和完整详情/诊断预算由[事件规范化契约](../session-event-normalization.md)完整负责。

## 浏览器界面

`public/app.js` 负责会话目录、正文阅读、正文/执行/诊断三视图、详情、执行过程、时间和 Raw 诊断的浏览器状态与渲染。`public/index.html` 加载 `public/styles.css`，后者按既有层叠顺序导入 `public/styles/` 下的基础、工作区、阅读、各视图与响应式样式，使样式责任可独立定位而不改变浏览器加载入口。默认阅读面限制为紧凑目录和正文，执行与诊断在切换后占据完整主工作区。筛选与低频管理能力按需展开。`src/pi-context-events.mjs` 仅从 Pi JSONL 投影 Skill 指令块和 `SKILL.md` 读取证据，不扫描当前磁盘作为历史事实。`public/app-format.js`、`public/tool-summary.js`、`public/raw-event-cache.js` 与 `public/evidence-id.js` 提供展示格式、工具摘要、诊断缓存和稳定定位辅助。浏览器不直接读取会话来源路径。

## 验证入口

- `npm run lint` 执行 ESLint。
- `npm test` 执行语法检查、Node 单元测试和 HTTP 冒烟测试。
- `npm run test:e2e` 执行 Playwright 端到端测试。

关键验证包括：`test/session-detail-coordinator.test.mjs` 覆盖详情缓存与并发读取，`test/codex-goal-http.test.mjs` 覆盖 Goal 投影与 Raw 保留，`test/server-access-control.test.mjs` 覆盖非 loopback 服务的认证边界。