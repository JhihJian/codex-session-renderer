# 设计：界面可配置的会话读取路径

## 背景与目标

当前会话读取根在启动时由环境变量决定（`CODEX_HOME`、`PI_AGENT_SESSIONS_ROOT`、`PI_AGENT_TASKS_ROOT`、`PI_AGENT_EVALUATIONS_ROOT`），换根需要修改 systemd 单元并重启容器。目标是让操作者在界面上查看与修改 Pi 会话读取根，保存后立即生效，重启后保持。

不在目标内：修改原始会话文件（服务对会话保持只读）、各浏览器独立的根配置、同时挂载多个根。

「临时打开本机会话」覆盖的是偶尔查看任意路径的场景：它每次请求重建上下文、递归扫描上限 800 条、没有评估 ID 作用域和分叉血缘解析，属于降级阅读。界面配置的根必须成为正式数据源，而不是把临时路径持久化。

## 核心决策

1. 持久化采用服务端配置文件，由新环境变量 `CODEX_SESSION_RENDERER_CONFIG_PATH` 显式启用。未设置时功能整体禁用，行为与现状完全一致，既有部署零意外文件。
2. 配置内容为单个 Pi 根覆盖：一个绝对路径，支持 `*` 通配符，每个 `*` 匹配一层目录名（不匹配点开头的目录）。有效配置整体覆盖环境变量中的 Pi 根，不做逐字段合并；清除覆盖即回到环境变量默认。目录发现规则统一为：展开通配符后递归读取所有匹配目录下的 `.jsonl` 文件，会话 ID 直接取文件名中的 UUID。旧配置文件中的 `type` 字段被忽略，无需迁移。
3. 保存即热重建：校验通过后原子写配置文件，替换数据源注册表并清空来源上下文缓存。在途请求持旧引用自然结束，重建失败保留旧状态。
4. 写接口为 `PUT /api/data-source-config`，仅接受 `application/json`。HTML 表单无法发起 PUT，跨站 fetch 因服务无 CORS 头止步预检，因此跨站写不可达。该约束用测试锁定，后续不得为表单兼容改成 POST。
5. 界面入口是设置对话框新增的「数据源」标签页。保存成功后重新拉取 health 与 sources，并清空当前选中会话。

## 详细设计

### 配置文件

- 路径仅由 `CODEX_SESSION_RENDERER_CONFIG_PATH` 声明，必须是绝对路径。
- 内容示例：`{ "version": 1, "piAgentRoot": { "type": "evaluations", "path": "/srv/report-agent/tasks/sw" } }`。`piAgentRoot` 为 null 或缺失表示无覆盖。
- 读取：文件缺失视为空配置；损坏 JSON 不阻断启动，回退环境变量来源，并把解析错误写入 pi-agent 来源的 `status.error`，在界面可见。
- 写入：同目录临时文件加 rename 原子替换。目录不可写时保存失败，运行状态不变。

### 优先级与冲突

有效配置文件中的 `piAgentRoot` 整体覆盖环境变量 Pi 根（含类型）。环境变量三根互斥校验保持不变，仅约束环境变量自身。`CODEX_HOME` 与本机 Codex 来源不进入界面配置，当前无此需求，version 字段为将来扩展留位。

### API

- `GET /api/data-source-config` 返回 `{ configPath, writable, override, envDefault }`。
- `PUT /api/data-source-config` 请求体为 `{ piAgentRoot: { type, path } | null }`，成功返回更新后的配置与来源列表。
- 错误语义：非法 JSON 或字段问题返回 400 并带字段错误；非 `application/json` 返回 415；请求体超过 16KB 返回 413；路径校验失败返回 400。
- 认证沿用现有全局 Basic 或 Bearer 前置校验，无新增豁免路径。

### 校验

- 路径必须绝对。无通配符时 realpath 解析成功且为目录；含通配符时只校验第一个 `*` 之前的固定前缀是已存在目录，匹配结果允许为空（沿用 `missing_sessions_root` 软状态展示，不阻断保存）。
- 不做结构探测（如评估目录数量、会话数量）。根缺失或无会话沿用现有 `missing_sessions_root` 软状态展示，不阻断保存。
- 清除覆盖（`piAgentRoot` 为 null）不做路径校验，且在配置文件损坏时必须仍然可用，作为自救通道。

### 热重建

在 `createSessionSourceContextService` 新增 `rebuildDataSources`：以环境变量加配置重建数据源注册表，整体替换注册表并清空 `sourceContexts` 缓存。重建成功后默认来源可能翻转：配置了根则 pi-agent 为默认来源，清除则回到 local。前端现有的 health 加载逻辑已按默认来源重置选中项。重建内部抛出异常时保留旧注册表并返回 500。

### 前端

- 设置对话框新增「数据源」标签页：显示当前生效根（覆盖值或环境默认值）、路径输入（含通配符语义提示）、字段错误位、「恢复环境变量默认」按钮。
- 未启用配置文件时，页面只读展示环境默认值与未启用原因，不提供保存。
- 保存成功后调用现有 health 与 sources 拉取逻辑，清空选中会话；侧栏数据源下拉与会话列表随新来源刷新。

## 备选方案与拒绝理由

- 浏览器 localStorage 持久化：读取根是服务端文件系统事实，会话 ID 与 sourceId 进入 URL，跨浏览器或跨设备访问时各端会看到不同实例状态且共享链接失效；服务重启后还需重新注册。拒绝。
- 多根并存为多个正式来源：上一轮的切换需求语义是替换默认根；多根会引入 source id 派生、列表管理界面和默认来源规则变化，当前没有场景支撑。若之后要求新旧布局同屏浏览，再按多源扩展。
- 重启生效：没有降低换根成本，直接违背目标。
- 把 Codex home 纳入界面配置：无当前需求，属无依据扩张。

## NM108 部署变更

- 新增可写卷 `--volume /data/app/codex-session-renderer/state:/state`，并设置 `--env CODEX_SESSION_RENDERER_CONFIG_PATH=/state/data-source-config.json`。
- 无需种子配置：环境变量继续提供默认值，首次界面保存后生成配置文件。
- 回滚方式：界面清除覆盖、删除配置文件后重启，或移除新增环境变量与卷。

## 测试与验收

- 配置存储：文件缺失、损坏 JSON、非法输入（相对路径、目录不存在、路径非目录）与原子写行为。
- 优先级：覆盖、回退、null 清除后回到环境默认；环境变量互斥校验不回归。
- 热重建：重建后 `getSourceContext` 返回新对象，旧缓存不复用；重建失败保留旧状态。
- HTTP 矩阵：未认证 401、不支持的方法 405、非 JSON 415、坏 JSON 400、超限 413、合法保存后 `/api/health` 立即反映新根。
- 端到端：设置页修改根并保存后列表来自新根，取消不落盘。

## 架构治理

系统边界新增「服务可写自身配置文件，会话文件保持只读」；运行时配置新增界面配置项。实现时按仓库治理流程执行 `prepare --write` 至 `accept --write`，并同步更新 `docs/architecture/README.md`、`docs/architecture/implementation.md` 与 README 数据来源章节。
