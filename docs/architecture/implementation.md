# 实现参考

## 服务装配

`server.mjs` 是主服务入口。它加载运行时限制、访问控制、数据源注册表和来源上下文缓存，并将静态资源和 HTTP API 路由到会话、远端来源及本机配置能力。`share-server.mjs` 只装配快照共享服务，避免共享职责混入主服务路由。

主服务的只读会话 API 包括健康状态、来源、会话列表、详情、事件、查询、Markdown 与提示词归档。远端对等端配置和远端刷新是受访问控制保护的管理操作。`public/app.js` 消费这些 API 并呈现工作台。

## 数据和边界

本机数据默认来自 `~/.codex`，Pi Agent 会话根可自动发现或由环境变量指定。远端来源的运行时定义来自环境变量或用户本地配置，下载内容经过快照模块验证后保存到用户目录下的私有快照根。令牌仅用于请求认证，不进入公开数据源、错误消息或浏览器配置响应。

## 会话时间统计

`src/session-events.mjs` 仅根据完整的助手回复与下一条有效用户消息边界识别等待输入。`src/session-timing.mjs` 的 `buildSessionTiming` 将工具、推导的 LLM 等待和已关联的子代理区间合并为实际运行时长，并输出单类统计及不重叠的执行构成；`public/app.js` 的 `renderTimingView` 使用该构成展示并行区间。精确字段、估算语义和 API 投影约定见 [事件规范化契约](../session-event-normalization.md)。

## 验证入口

`npm run lint` 执行静态检查，`npm test` 执行 Node 单元和 HTTP 冒烟测试，`npm run test:e2e` 执行 Playwright 端到端测试。架构状态使用这些现有测试作为可定位验证依据，不替代产品测试。
