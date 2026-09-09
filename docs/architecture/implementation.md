# 实现参考

本页是架构文档的实现下钻入口，记录当前责任单元的源码、运行边界和验证位置。它不替代模块设计，也不完整列举 HTTP 参数、事件字段或环境变量。

## 服务装配

- `server.mjs` 是主 HTTP 服务入口。它装配访问控制、来源注册表、来源上下文、会话读取、任务归档、远端管理、静态资源和浏览器 API。
- `share-server.mjs` 只装配快照共享服务。缺少 `CODEX_SHARE_TOKEN` 时进程以失败状态退出，不启动监听。
- `src/access-control.mjs` 对主服务的非 loopback 监听强制令牌，并支持 Basic 或 Bearer 请求认证；`src/http-response.mjs` 统一 HTTP 响应与错误输出。

## 数据源与远端发布

- `src/data-sources.mjs` 创建本机、Pi Agent 和远端来源，定义来源版本、私有快照、刷新、验证及发布。
- `src/renderer-config.mjs` 将远端连接定义原子写入用户私有配置，并在公开视图删除令牌。
- `src/remote-http.mjs`、`src/snapshot-budget.mjs`、`src/snapshot-build-coordinator.mjs` 和 `src/snapshot-root-commit-coordinator.mjs` 负责期限、取消、资源预算、共享构建和当前快照提交。
- `src/snapshot-share.mjs` 与 `src/remote-session-index.mjs` 分别提供受保护的快照归档和历史索引。历史索引只返回紧凑元数据，不能替代当前快照的会话正文。

## 会话与阅读投影

- `src/session-catalog.mjs`、`src/sqlite-threads.mjs`、`src/jsonl-reader.mjs` 和 `src/session-models.mjs` 负责目录发现、索引读取、JSONL 读取和来源化会话模型。
- `src/session-normalizer.mjs`、`src/session-events.mjs`、`src/embedded-subagents.mjs`、`src/event-summary.mjs` 与 `src/session-timing.mjs` 负责事件稳定化、轮次、子代理、摘要和时间投影。
- `src/session-detail-coordinator.mjs` 管理完整详情的文件签名、并发、取消和缓存；`src/markdown-export.mjs` 输出 Markdown。
- 事件字段、Goal profile、控制包投影、Raw 保留和完整详情/诊断预算由[事件规范化契约](../session-event-normalization.md)完整负责。

## 任务归档

- `src/prompt-archive-coordinator.mjs` 负责有界首任务读取、共享订阅、取消、签名失效和缓存。
- `src/session-prompts.mjs` 负责首个有效用户任务及其归档条目。
- `src/pi-goal-projection.mjs` 负责严格投影 Codex/Pi Goal 的 objective，并在结构不符时保留原始语义。

## 浏览器界面

`public/app.js` 负责会话、详情、执行过程、时间、归档、远端来源和 Raw 诊断的浏览器状态与渲染。`public/app-format.js`、`public/tool-summary.js`、`public/raw-event-cache.js` 与 `public/evidence-id.js` 提供展示格式、工具摘要、诊断缓存和稳定定位辅助。浏览器不保存远端令牌，也不直接读取会话来源路径。

## 验证入口

- `npm run lint` 执行 ESLint。
- `npm test` 执行语法检查、Node 单元测试和 HTTP 冒烟测试。
- `npm run test:e2e` 执行 Playwright 端到端测试。

关键验证包括：`test/session-detail-coordinator.test.mjs` 覆盖稳定详情读取，`test/prompt-archive-coordinator.test.mjs` 覆盖归档预算与取消，`test/codex-goal-http.test.mjs` 覆盖 Goal 投影与 Raw 保留，`test/snapshot-publication.test.mjs` 和 `test/snapshot-security.test.mjs` 覆盖快照发布与安全边界，`test/remote-refresh-http-cancellation.test.mjs` 覆盖刷新取消不发布暂存数据。