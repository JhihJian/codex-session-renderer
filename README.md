# Codex 会话工作台

Codex 会话工作台是只读的会话浏览器。它把 Codex 与 Pi Agent 的 JSONL 会话记录整理为适合阅读的界面，帮助用户快速理解 agent 收到的任务、生成的回复、调用的工具、委派的子代理和执行时间。

## 产品决策

本项目专注于会话的展示效果，不提供风险识别、缺口推断、验证结论、缺陷登记或人工复核工作流。

原因是会话记录只能说明 agent 在一次执行中做了什么，不能可靠证明安全性、正确性或缺陷归因。把启发式信号包装成风险或复核结论会干扰用户理解原始执行过程。

产品核心目标是让会话记录更易读，并让用户更容易了解 agent 的底层逻辑：

- 会话视图按轮次显示用户输入、助手消息、推理摘要、工具参数和输出。
- 执行过程视图展示工具、委派、子代理和耗时的层级关系。
- 统计和原始事件视图保留事件构成、时间投入及按页的原始诊断入口。
- 工具摘要规则只改善文字可读性，不改变会话事实或推导任何结论。

## 数据来源

- Codex 元数据：`~/.codex/state_5.sqlite`
- Codex 会话：`~/.codex/sessions/**/*.jsonl`
- Pi Agent 会话：自动发现 `~/.pi/agent/sessions/**/*.jsonl`，也可通过 `PI_AGENT_SESSIONS_ROOT` 或 `PI_AGENT_TASKS_ROOT` 配置
- 远端数据源：先拉取到本地快照后只读浏览，历史范围仅查询远端索引，不读取历史正文

原始会话文件不会被修改。Markdown 导出和浏览器展示均基于本地文件或已发布的本地快照。

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
