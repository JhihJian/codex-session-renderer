# Codex 会话工作台

这个小工具只读扫描 Codex 会话文件，并在浏览器里渲染成本地会话工作台。默认数据源仍是当前用户的本机 Codex Home；也可以把远端数据源的 Codex Home 先拉取到本机缓存快照，再作为独立数据源查看。正文渲染始终只读本地快照；历史分类仅按需访问远端索引，不取历史正文。

## 数据来源

- 会话元数据：`%USERPROFILE%\.codex\state_5.sqlite`，用于读取标题、工作目录、模型、推理强度和归档状态。
- 正文事件流：`%USERPROFILE%\.codex\sessions\**\*.jsonl`
- 轻量索引回退：`%USERPROFILE%\.codex\session_index.jsonl`
- 远端数据源：通过页面或环境变量配置后，拉取到本机快照缓存目录；正文渲染只读取发布后的本地快照，不直接绑定实时远端请求，也不会修改远端；历史分类仅按需访问远端索引，不取历史正文。
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

如需让局域网内其他设备访问，可把监听地址改为所有网卡：

```powershell
$env:HOST='0.0.0.0'
$env:PORT=4789
npm start
```

Linux 用户级 systemd 部署时同样设置 `Environment=HOST=0.0.0.0`。服务会读取部署机上的 Codex 会话数据；开放到局域网前应确认访问范围。

当前开发环境是 Windows；仓库内的 systemd 单元是 Linux 部署机示例。安装前按目标机器实际路径替换模板中的 `WorkingDirectory`、`CODEX_HOME`、`ExecStart` 等绝对路径，再复制到用户级 systemd 目录：

```bash
mkdir -p ~/.config/systemd/user
install -m 0644 deploy/systemd/codex-session-renderer.service ~/.config/systemd/user/codex-session-renderer.service
systemctl --user daemon-reload
systemctl --user enable --now codex-session-renderer
```

如需开机后不登录也启动用户级服务，确认已启用 linger：

```bash
loginctl show-user "$USER" -p Linger
sudo loginctl enable-linger "$USER"
```

如果机器上已有旧的系统级 `/etc/systemd/system/codex-session-renderer.service`，迁移到用户级服务前先停用旧服务，避免两个服务争用 `4789`：

```bash
sudo systemctl disable --now codex-session-renderer
sudo systemctl daemon-reload
```

启动后，本机访问 `http://127.0.0.1:4789/`，局域网访问使用当前设备的局域网地址，例如 `http://192.168.1.92:4789/`。

## 手动更新部署

当前部署直接运行仓库工作区里的 `server.mjs`，没有构建产物。手动更新新版本时，在部署机上执行：

```bash
cd /data/dev/codex-session-renderer
git fetch origin
git merge --ff-only origin/main
npm ci
npm test
install -m 0644 deploy/systemd/codex-session-renderer.service ~/.config/systemd/user/codex-session-renderer.service
systemctl --user daemon-reload
systemctl --user restart codex-session-renderer
systemctl --user is-active codex-session-renderer
curl -fsS http://127.0.0.1:4789/api/health
```

如果 `git merge --ff-only origin/main` 提示不能快进，说明本地有未提交改动或本地分支已经分叉。先用 `git status --short` 检查，不要直接覆盖本地改动；确认要保留本地部署补丁时，先提交或 stash，再合并远端新版本。

## 远端会话数据源

远端数据源通过“实时会话拉取到本机缓存快照，历史会话仅按需查远端索引且不取正文”的方式工作。拉取失败不会删除上一份可用快照；如果已有旧快照，页面仍可继续浏览，并在数据源状态里标注失败或旧快照。

推荐的最简方式是：每台需要被查看的设备启动快照共享服务，然后在任意一台已打开页面的设备里通过“远端数据源”面板添加对端。实例之间不区分主次；谁添加了对端，谁就能从页面拉取对端实时会话快照并检索对端历史索引。

被查看设备：

```powershell
cd D:\github\codex-session-renderer
$env:CODEX_SHARE_TOKEN='<同一段随机 token>'
npm run share
```

默认共享端口是 `4791`，默认只把最近 3 小时内变更过的 `sessions/**/*.jsonl` 打包进实时快照。`state_5.sqlite` 和 `session_index.jsonl` 会随实时快照一起传输，用于标题、归档、子代理关系和路径映射。共享服务和远端快照发布使用的 `copyCodexTree` 只复制 `sessions` 目录下的 JSONL 文件，不复制 `archived_sessions`。

如果要改端口或实时窗口：

```powershell
$env:CODEX_SHARE_PORT=4792
$env:CODEX_SHARE_REALTIME_HOURS=6
```

如果主查看设备无法访问该端口，需要在被查看设备的 Windows 防火墙中放行 Node.js 或对应端口。

任意查看设备：

```powershell
cd D:\github\codex-session-renderer
npm start
```

启动后点击左侧数据源旁的“远端数据源”，添加：

- 名称：例如 `office`
- 地址：例如 `192.168.1.20:4791`
- 访问令牌：对端实际使用的共享访问令牌。推荐在共享端设置 `CODEX_SHARE_TOKEN`；如果共享端只设置了旧变量 `CODEX_REMOTE_TOKEN`，服务会兼容回退使用该值，查看端也要填写同一段访问令牌。

保存后页面会立即刷新数据源列表，不需要重启 `npm start`。选择 `office` 后点击“拉取远端快照”，服务端会从 `http://192.168.1.20:4791/api/codex-snapshot.tar?scope=realtime` 下载实时快照并发布到本机缓存；该操作会写入本机缓存，不修改远端。

页面保存的远端数据源配置位于：

```text
%USERPROFILE%\.codex-session-renderer\config.json
```

该文件包含页面管理的数据源访问令牌，应按本机私密配置处理。页面 API 只返回 `hasToken`，不会把访问令牌回显给浏览器表单；编辑远端数据源时访问令牌留空表示保留原访问令牌，关闭或切换数据源前会提示未保存更改。远端地址不要把账号、密码、token 或其他认证信息写进地址里，也不要包含查询参数或片段，认证统一使用访问令牌（Bearer token）；程序会拒绝这类地址。远端数据源面板打开时会先显示“读取远端数据源中”，读取失败会在列表和状态区保留错误，不会伪装成“暂无远端数据源”。面板里的“测试已保存连接”只使用已保存配置和访问令牌向远端发起只读健康检查，当前表单草稿不会被测试，也不会保存配置或拉取快照；“移除本机配置”只删除本机保存的配置和访问令牌，不删除远端会话、远端快照或本机已拉取的缓存快照。

左侧时间分类的“实时 <3h”展示已同步到本机的可打开会话；拉取远端实时快照默认只补最近 3 小时。“近一天”和“更早”会调用远端 `/api/codex-session-index` 做统一入口检索，只返回标题、时间、项目路径、模型等索引信息，不传历史正文。历史索引结果会在会话行标注“仅索引/未同步正文”，用于定位和搜索，不会被误当成已同步的可打开正文；点击这类行时页面会提示：历史正文需要远端扩大共享窗口或额外同步后再拉取，或者切回已有本地快照查看已同步会话。

快照共享接口只响应带有 `Authorization: Bearer <token>` 的请求。共享端访问令牌读取顺序为 `CODEX_SHARE_TOKEN || CODEX_REMOTE_TOKEN`：推荐使用 `CODEX_SHARE_TOKEN`，保留 `CODEX_REMOTE_TOKEN` 作为兼容回退。两者都未设置时，`npm run share` 会拒绝启动，以保证会话正文、命令输出、项目路径和错误栈不会在无认证状态下暴露到网络。

高级模式仍支持环境变量配置和两种获取方式。该模式下访问令牌从运行时环境变量读取，不写入页面管理的 `config.json`：

- `CODEX_REMOTE_PEERS`：用 `id=host:port` 或 `id=http://host:port` 配置对端，适合无人值守部署或临时启动。

- `CODEX_REMOTE_<ID>_SNAPSHOT_PATH`：从一个本机可读目录复制 Codex Home，适合先用 rsync、scp、挂载盘或其他脚本把远端 `/root/.codex` 同步到本机。
- `CODEX_REMOTE_<ID>_SNAPSHOT_URL`：从远端 HTTP(S) 下载 `.tar`、`.tar.gz` 或 `.tgz` 快照包。服务端会用 `Authorization: Bearer ...` 请求，访问令牌只从环境变量读取。

示例：配置一个名为 `office` 的远端数据源，快照来源是本机已同步目录。

```powershell
$env:CODEX_REMOTE_SOURCES='office'
$env:CODEX_REMOTE_OFFICE_LABEL='Office 远端数据源'
$env:CODEX_REMOTE_OFFICE_CODEX_HOME='/root/.codex'
$env:CODEX_REMOTE_OFFICE_SNAPSHOT_PATH='D:\codex-remote\office\.codex'
$env:CODEX_REMOTE_SNAPSHOT_ROOT='D:\codex-session-renderer-snapshots'
npm start
```

示例：配置 HTTP 快照下载。不要把访问令牌写入仓库文件；这里只展示变量名和占位符。

```powershell
$env:CODEX_REMOTE_SOURCES='office'
$env:CODEX_REMOTE_OFFICE_LABEL='Office 远端数据源'
$env:CODEX_REMOTE_OFFICE_CODEX_HOME='/root/.codex'
$env:CODEX_REMOTE_OFFICE_SNAPSHOT_URL='https://example.invalid/codex-snapshot.tar.gz'
$env:CODEX_REMOTE_OFFICE_TOKEN_ENV='CODEX_REMOTE_OFFICE_TOKEN'
$env:CODEX_REMOTE_OFFICE_TOKEN='<runtime token>'
npm start
```

远端快照内容会原子发布到：

```text
%USERPROFILE%\.codex-session-renderer\remote-snapshots\<source-id>\current
```

可通过 `CODEX_REMOTE_SNAPSHOT_ROOT` 修改快照根目录。快照目录包含会话正文、命令输出、项目路径和错误栈等敏感信息，应按本机私密数据处理，不要提交到 git 或上传到公开位置。当前 `.gitignore` 已默认忽略 `*.sqlite`、`*.jsonl`、`*.log`、`.env*`、`tmp/` 等常见运行时文件；如果把快照根目录放进仓库工作区，需要额外把该目录加入忽略规则。

远端状态只暴露脱敏信息：是否正在拉取、最近成功拉取时间、是否正在浏览旧快照、失败类别和简短原因。API 响应、状态文件和普通错误信息不会包含访问令牌、认证头或会话正文。

### 无 SSH 同步 71 设备会话

如果远端 71 设备不能通过 SSH/rsync 访问，但可以通过本机 `codex-remote-run` 连接 Codex app-server，可使用仓库脚本按文件清单增量同步 `/root/.codex`。脚本会：

- 通过 `codex-remote-run --exec` 读取远端 `state_5.sqlite`、`session_index.jsonl` 和 `sessions/**/*.jsonl` 清单。
- 和本机上次同步状态比较，只拉取新增或变化的文件。
- 把小文件按批次打包为 tar/base64，单批控制在 `codex-remote-run` 默认 1 MiB 输出上限以内。
- 对超过单批上限的大文件使用 base64 chunk 分片拉取。
- 先写入 staging 目录，成功后再原子发布到目标快照目录，避免页面读到半同步状态。

运行前确保访问令牌只存在于运行时环境中，不要写进仓库文件：

```bash
export CODEX_REMOTE_TOKEN='<runtime token>'
```

当前设备上该变量通常在 login shell 中可用；如果普通非交互 shell 没继承到，脚本默认会用 `bash -ilc` 启动 `codex-remote-run`。

先做一次小规模验证：

```bash
node scripts/sync-71-sessions.mjs \
  --limit 20 \
  --skip-state-db \
  --target /home/jhihjian/.codex-session-renderer/source-snapshots/dev71-test/.codex \
  --verbose
```

正式同步默认目标为：

```text
/home/jhihjian/.codex-session-renderer/source-snapshots/dev71/.codex
```

执行增量同步：

```bash
node scripts/sync-71-sessions.mjs --verbose
```

如果已在渲染器中配置 `dev71` 数据源，可同步后直接触发刷新：

```bash
node scripts/sync-71-sessions.mjs --refresh --source-id dev71 --renderer-url http://127.0.0.1:4789
```

用户级 systemd 数据源配置示例：

```bash
mkdir -p ~/.config/systemd/user/codex-session-renderer.service.d
tee ~/.config/systemd/user/codex-session-renderer.service.d/remote-dev71.conf >/dev/null <<'EOF'
[Service]
Environment="CODEX_REMOTE_SOURCES=dev71"
Environment="CODEX_REMOTE_DEV71_LABEL=71 远端数据源"
Environment="CODEX_REMOTE_DEV71_CODEX_HOME=/root/.codex"
Environment="CODEX_REMOTE_DEV71_SNAPSHOT_PATH=/home/jhihjian/.codex-session-renderer/source-snapshots/dev71/.codex"
Environment="CODEX_REMOTE_SNAPSHOT_ROOT=/home/jhihjian/.codex-session-renderer/remote-snapshots"
EOF
systemctl --user daemon-reload
systemctl --user restart codex-session-renderer
```

验证：

```bash
curl -fsS http://127.0.0.1:4789/api/sources
curl -fsS -X POST http://127.0.0.1:4789/api/sources/dev71/refresh
curl -fsS 'http://127.0.0.1:4789/api/sources/dev71/query/sessions?limit=5&fields=id,title,changedAt,relativePath'
```

同步脚本会在目标目录写入 `.codex-session-renderer-71-sync.json` 作为增量状态。这个文件只记录相对路径、大小和修改时间，不包含访问令牌。

## 项目结构

- `server.mjs`：HTTP 路由、数据源分发、会话文件定位、缓存和接口编排；底层响应、SQLite、DTO 和解析逻辑已拆到 `src/`。
- `share-server.mjs`：远端快照共享服务入口；只暴露受 Bearer token 保护的 Codex 快照下载接口。
- `src/data-sources.mjs`：本机/远端数据源配置、远端快照拉取、原子发布和脱敏状态。
- `src/renderer-config.mjs`：页面管理的远端数据源配置读写、校验和脱敏输出。
- `src/snapshot-share.mjs`：按需复制实时 Codex 会话文件、写入快照元数据、打包 tar，并提供历史会话索引检索。
- `src/session-catalog.mjs`：本地文件回退的会话根目录发现和 live/archived 副本去重；文件回退会同时扫描 `sessions` 与 `archived_sessions`，并优先保留 live 副本。
- `src/jsonl-reader.mjs`：UTF-8 JSONL 流式读取工具；支持按逻辑行数上限读取和按事件索引读取单条事件。
- `src/http-response.mjs`：JSON/Text 响应、错误响应、静态文件类型和路径安全解析。
- `src/sqlite-threads.mjs`：只读 SQLite 查询、线程行映射、spawn edge 读取和 SQL 字符串转义。
- `src/session-models.mjs`：服务端 API 会话 DTO、列表 DTO、线程元数据和文件 stat 合并。
- `src/text-utils.mjs`：时间、路径、首行摘要、消息正文提取和文本规范化等基础纯函数。
- `src/tool-events.mjs`：工具调用开始/结束识别、工具名/参数/输出提取、MCP 结果渲染和输出合并。
- `src/session-normalizer.mjs`：Codex JSONL 原始事件规范化、字段漂移兼容、delta 合并、图片/附件摘要、加密 reasoning 脱敏和搜索文本构建。
- `src/user-message-cleanup.mjs`：Codex 自动注入用户消息的识别和清理规则，供规范化、turn 聚合、事件摘要和 Audit 意图过滤复用。
- `src/event-summary.mjs`：事件分类、重要事件判断、标题/预览摘要和会话事件计数。
- `src/audit-chain.mjs`：基于服务端完整 turn/item 模型生成 Audit Chain，集中维护审计节点、验证识别和非 evidence 风险启发式规则。
- `src/evidence-risk-rules.mjs`：证据风险规则模块，内置输出风险词、大型输出和读文件/文本搜索输出排除条件，并支持从前端设置传入本地覆盖规则。
- `src/session-query.mjs`：面向外部项目的会话查询、筛选、分页游标、字段投影和事件增量查询参数处理。
- `src/markdown-export.mjs`：会话 Markdown 导出。
- `src/session-events.mjs`：会话事件核心解析逻辑，包括 turn 聚合、Trace 模型、精简视图模型和子代理锚定；同时重新导出旧的常用解析 API 以保持调用兼容。
- `public/`：无构建前端，包含页面、样式、交互脚本和本地 `markdown-it` 浏览器包。
- `public/app-format.js`：前端格式化、转义、高亮、路径缩短和文件名清理工具；通过浏览器全局 `window.AppFormat` 暴露，避免引入构建步骤。
- `public/tool-summary.js`：前端工具调用可读摘要规则，内置常见 `exec_command`、`apply_patch`、工具搜索等转换；`apply_patch` 会解析文件级增删统计，供审计链和复核台以类 git diff stat 视图展示；高频命令输出会解析 Git 状态、搜索命中和验证结果，供复核台以结构化视图展示；同时支持浏览器本地自定义规则覆盖。
- `public/execution-grouping.js`：Audit 执行链连续节点聚合规则，内置“收集文件与目录信息、搜索与定位代码、检查 Git 状态与差异”等分组，并支持浏览器本地自定义规则覆盖。
- `public/audit-view-model.js`：Audit 执行链前端 view model 纯函数，负责助手消息父行投影、执行行投影/身份解析、执行节点挂载、`childRowIds` 层级维护、itemRef 解析和时间回退归属逻辑；通过 `test/audit-view-model.test.mjs` 覆盖。
- `public/evidence-risk-rules.js`：证据风险规则的浏览器配置模块，负责设置页展示、localStorage 保存和会话详情请求参数序列化。
- `test/`：Node 内置测试，覆盖 JSONL 读取、HTTP/静态文件边界、主服务入口 smoke、SQLite 映射、服务端 DTO、事件摘要、工具协议、事件解析、前端格式化和 Markdown 导出等回归点。

后续维护时，优先把可纯函数化的逻辑放进对应 `src/` 小模块并补测试；`server.mjs` 只负责数据来源、缓存和接口组合。前端如新增通用格式化/转义逻辑，优先放进 `public/app-format.js` 并在 `test/app-format.test.mjs` 覆盖；如新增工具调用语义化展示规则，优先放进 `public/tool-summary.js` 并在 `test/tool-summary.test.mjs` 覆盖；如新增执行链聚合规则，优先放进 `public/execution-grouping.js` 并在 `test/execution-grouping.test.mjs` 覆盖；如新增证据风险规则，需同步 `src/evidence-risk-rules.mjs`、`public/evidence-risk-rules.js` 和 `test/evidence-risk-rules.test.mjs`；如调整本地文件回退、`sessions`/`archived_sessions` 去重或自动注入用户消息清理规则，分别在 `test/session-catalog.test.mjs`、`test/session-events.test.mjs`、`test/session-normalizer.test.mjs` 或相关事件摘要/Audit 测试中补充回归保护。

## 页面设计

浏览器页面按本地优先的会话工作台设计，第一屏就是可操作的三栏布局：左侧会话列表，中间“阅读 / 审计链 / 统计 / 原始事件”四个主视图，右侧是复核台；1281px 及以上桌面宽度保留侧向复核台，桌面端可拖动复核台左侧分隔条调整宽度，宽度会保存在浏览器本地。1280px 以下会把复核台收进正文下方的流式复核区，避免 1180px 和 1024px 窄桌面继续三列挤压正文；821px 到 1280px 且高度不超过 800px 的窗口会进一步压低底部复核区，给主内容保留可读高度；820px 以下继续使用移动端面板切换。用户通过顶栏隐藏左侧会话列表或右侧复核台时，隐藏区域会同步退出键盘焦点序列；主视图、时间分类、复核页和设置页分类支持方向键与 Home/End 切换，设置弹窗关闭后焦点回到打开入口。界面使用系统字体、中性色背景、0.5 到 1px 轻边框、8px 工具圆角和紧凑行高，避免把工具界面做成营销卡片页。

左侧会话列表按时间分类和工作目录聚合，每行展示代理标识、标题、更新时间、模型和项目路径；没有工作目录的会话显示为“无项目”。顶部保留数据源、远端数据源管理、搜索、时间段和会话类型过滤；其中“标题/路径含错误词”和“标题/路径含工具词”只基于轻量列表里的标题、工作目录和相对路径做文本匹配，不代表已经读取正文统计。已读取正文且没有正在读取时，重复点击当前会话行只聚焦当前行，不会清空详情并重新请求大体量会话。中间内容区保留阅读、审计链、统计、原始事件四个主视图和内容搜索，内容类型筛选首项随视图分别显示为“全部内容 / 全部节点 / 全部事件”；阅读视图左侧执行层级大纲采用单一 Tab 入口，进入后用方向键在大纲项之间移动、Enter/Space 跳转，避免大体量会话把键盘路径撑成长列表。统计条只以紧凑状态标签展示轮次、事件、重点、工具调用、上下文压缩、子代理、上下文占用；每类原始事件的数量和按事件体积估算的约 token 量进入独立统计视图，以概要指标和表格展示。右侧复核台不再承担关键事件列表或会话概览职责，而是围绕当前选中对象展示“摘要 / 证据 / 关系 / 来源”四个复核页；默认状态是会话概览，优先暴露风险、验证、缺口和子代理入口。复核台顶栏用“复核台 / 复核对象”区分区域身份和当前对象，避免重复标题；复制引用在会话概览下提示“已复制会话引用”，对象态提示“已复制对象引用”。工具调用、工具输出和原始事件会先经过前端可读摘要规则转换，例如把 `Get-Content -Raw -Encoding UTF8` 显示为“读取文件内容”，把 `apply_patch` 显示为文件数、增删行和文件状态组成的类 `git diff --stat` 摘要；当复核台摘要页展示 `apply_patch` 正文时，会进一步按文件、hunk、添加行和删除行渲染 patch。常见 `exec_command` 输出会进入命令输出结构化视图：`git status` 展示文件状态，`rg`/`grep`/`findstr` 展示搜索命中，`npm test`、`node --test` 等验证命令展示通过/失败、计数和关键输出。原始事件视图负责会话级事件浏览，完整原始内容只在复核台的“来源”页或原始事件主视图中按需读取。

页面底部有状态条，显示当前数据源、选中会话、过滤后的会话数和事件/轮次统计；状态条会同步本机、远端、旧快照、加载和错误数据状态。列表刷新和详情读取是分离状态：会话列表接口返回后，顶部刷新按钮会恢复可用；详情读取期间由主内容占位和状态条显示“正在读取”。列表加载失败不会伪装成某个会话读取失败，主内容会显示“会话列表加载失败”，导出按钮显示未选择可导出会话。启动或刷新时如果健康检查失败，顶部、数据源状态、会话列表、主内容占位和状态条会统一显示“接口不可用 / 无法连接本机服务”，顶部“刷新列表”按钮会作为重试入口。远端历史分类加载时列表空态显示“正在检索远端历史索引”，失败时显示“历史索引失败：...”并提供重试历史索引或返回实时入口；状态条在远端历史模式下显示“历史索引 N 条 · 正文未同步”，不再用本机快照总数作为分母。当当前会话被搜索或筛选隐藏时，主内容标题下方会显示“当前会话已被筛选隐藏”提示，并提供清除筛选、返回实时入口；状态条同步提示并禁用完整 Markdown 复制/下载。样式支持系统浅色/深色模式，并建立统一角色色标记：蓝色用于用户输入和选中，深蓝用于助手叙述，紫色用于工具调用，绿色用于工具输出，红色用于错误风险，灰色用于元信息。主界面保留四个视图：阅读用于日常浏览，审计链用于证据链复核，统计用于事件类型和 token 估算分析，原始事件用于事件流诊断。

复制到剪贴板失败时，toast 只显示中文操作建议，例如“请允许浏览器访问剪贴板，或手动选中文本复制”；具体浏览器通道或降级链路只写入控制台警告，避免把技术细节暴露为用户提示。

## 检查与测试

首次检出仓库后先安装锁文件中的依赖：

```powershell
npm ci
```

完成 JavaScript 修改后依次运行：

```powershell
npm run lint
npm test
```

需要应用 ESLint 可安全自动修复的改动时运行：

```powershell
npm run lint:fix
```

`npm run lint` 使用 ESLint Flat Config 检查 Node.js 服务、无构建浏览器脚本、同步脚本和测试；正确性问题直接报错，文件规模、函数规模、复杂度、嵌套、参数量和语句量也纳入同一阻断门禁。依赖、构建产物、覆盖率目录、生成代码和压缩文件不会参与检查。

`eslint-suppressions.json` 记录接入 ESLint 前已经存在的复杂度、规模和前端遗留未使用函数，避免一次配置改造混入大范围业务重构；新增问题仍会阻断 lint。重构清除旧问题后运行 `npx eslint . --prune-suppressions` 删除失效基线，不要通过重新生成基线规避新告警。

`npm run check` 会对服务端入口、拆分后的 `src/` 模块和前端脚本做语法检查。`npm test` 会先运行语法检查，再运行 `node --test` 下的轻量回归测试。

当前重点回归保护包括：

- `server.mjs` 可被测试导入而不自动监听；HTTP smoke 会用临时 `CODEX_HOME` 覆盖 `/api/health`、会话列表、详情、单事件、Markdown 和缺失 API 状态。
- 静态文件路径不能穿越 `public/` 根目录。
- SQLite thread 行映射、ID 转义和 spawn edge 过滤保持稳定。
- 子代理通知匹配会同时检查事件预览和完整原始内容，避免 `preview` 缺少 `agent_path` 时漏挂载。
- 特殊会话样例覆盖 fork replay 前导重放、`turn_aborted` 续跑、真实重复用户输入、等待状态、图片附件和 encrypted reasoning 脱敏。
- 无 SQLite 文件回退覆盖 `sessions`/`archived_sessions` 去重，避免同一 session id 同时出现在 live 和 archived 副本时重复展示。
- 前端 HTML 高亮不会改写标签，Windows 路径缩短和下载文件名清理保持稳定。

## 设计说明

- 服务端只读访问本地文件，不写入 `.codex`。
- 数据源是一等概念：旧接口默认读取本机 `local` 数据源，新接口可显式指定 `sourceId`；前端用 `sourceId + session id` 区分会话，避免不同数据源中相同 session id 混淆。
- 远端数据源可以通过页面管理，配置保存在本机私有 `config.json`；环境变量仍可作为高级配置来源。页面接口只返回访问令牌是否存在，不回显访问令牌原文。“移除本机配置”只移除本机保存的远端配置和访问令牌，不删除远端会话、远端快照或本机已拉取的缓存快照。
- 远端数据源的正文只在拉取阶段访问配置好的实时快照 URL 或快照目录；普通会话列表、复核台、Markdown 导出和正文渲染都从本地 `current` 快照读取。拉取实时快照默认只补最近 3 小时。历史分类仅按需访问远端索引接口，索引只返回元数据，不包含会话正文；历史正文需要远端扩大共享窗口或额外同步后再拉取，或切回已有本地快照查看已同步会话。
- 远端实时快照拉取使用 staging 目录构建，再原子切换到 `current`。共享服务的实时快照和 `copyCodexTree` 发布的远端快照只包含 `sessions/**/*.jsonl`、`state_5.sqlite`、`session_index.jsonl` 等允许文件，不包含 `archived_sessions`；本地文件回退扫描 `sessions` 与 `archived_sessions` 是另一条读取路径。拉取失败不会覆盖上一次成功快照。同一数据源的并发拉取会复用正在进行的任务，不同数据源仍可并行，避免并发发布 `staging/current/previous` 竞态。
- 远端 SQLite 中的 `rollout_path` 会按配置的远端 Codex Home 映射到本地快照 Codex Home。
- 本地工作台默认绑定 `127.0.0.1`，适合作为同机只读数据源；可通过 `HOST` 覆盖监听地址，当前用户级 systemd 模板设置 `HOST=0.0.0.0` 用于局域网访问。独立的 `npm run share` 快照接口始终要求 Bearer token。
- 前端使用原生 HTML/CSS/JavaScript，无构建步骤；Markdown 渲染通过本地 `markdown-it` 浏览器包完成。渲染层借鉴 `earendil-works/pi/packages/tui` 的大模型输出处理思路：进入 Markdown 前会统一 tab 宽度并修剪流式输出结尾的半截代码围栏，代码块带语言栏和复制按钮，长代码、列表和表格按容器稳定换行或滚动。
- 顶栏设置入口提供“展示规则设置”，用户可在浏览器本地新增、启停或删除工具摘要规则、审计链执行聚合规则和证据风险规则；自定义规则优先于内置规则。设置页按“摘要规则 / 执行聚合 / 证据风险 / 结构化展示”分类切换，顶部概览主数字展示生效数量，辅助文字展示自定义/内置数量，当前分类只展示自己的编辑区和内置参考；证据风险页内容较长时只滚动编辑区，取消/保存 footer 固定在弹窗可见区域。结构化展示分类用只读说明列出命令输出结构化视图当前覆盖的命令类型和展示内容，便于判断哪些 `exec_command` 输出会被自动整理。摘要规则只影响审计链、复核台、原始事件列表标题和前端搜索，摘要规则名称仅用于本地管理；执行聚合规则只影响审计链执行链中连续执行节点的折叠展示，不改变服务端 `audit.nodes`、turn/item 轻量模型、`trace.root` 或原始事件；证据风险规则会随会话详情请求传给服务端，用于重新派生 `audit.nodes` 中的证据风险节点和风险计数。若浏览器 localStorage 里存在旧版本留下的非法证据风险规则，普通打开会话时前端会跳过这些非法覆盖，不再把它们序列化到详情请求；用户仍可在设置页看到并修正规则后保存。
- 会话列表优先读取 SQLite `threads` 表，并在 SQLite 查询层排除 `thread_spawn_edges.child_thread_id` 对应的子代理线程，避免子代理在左侧会话列表独立展示；SQLite 不可用或列表查询失败时回退扫描 JSONL 文件。文件回退会同时扫描 `sessions` 和 `archived_sessions`，按 session id 去重，live 副本优先，只有没有 live 副本时才把 archived 副本作为可打开会话；同时会从 `session_meta.source.subagent.thread_spawn` 继续识别父子关系和子代理昵称，默认仍只展示根会话。
- JSONL 读取使用流式逐行解析；列表回退读取前若干条事件时不会把整个大文件一次性读入内存。
- JSONL 事件会先经过规范化层形成稳定字段，兼容 `type`/`role`、多种时间字段、content parts、工具字段漂移、delta chunk、图片引用、加密 reasoning 和 Codex 上下文压缩事件；契约见 `docs/session-event-normalization.md`。
- 解析器把 JSONL 中的 `session_meta`、`turn_context`、`event_msg`、`response_item` 聚合为 turn 和 item。
- 工具调用会合并 `function_call`、`function_call_output`、`custom_tool_call`、`custom_tool_call_output`、`mcp_tool_call_end`、`patch_apply_end` 等 Codex 事件。
- 同一 `message_id` 的 streamed/delta 消息会在规范化层合并为连续可读文本，并保留来源事件索引用于原始事件回溯。
- 默认阅读、Markdown 导出和事件搜索会隐藏 Codex 自动注入的用户消息包装，例如 `AGENTS.md instructions`、`environment_context`、goal continuation 和 subagent notification；原始事件视图和单事件接口仍保留完整原始内容，方便诊断。
- 同一条用户/助手消息如果同时出现在 response item 和事件消息里，会在渲染层去重；用户真实重复输入同一句话不会只因为文本相同被删除。
- `turn_aborted` 会把当前 turn 标记为 `aborted`，不会作为普通用户可见事件展示；如果一个空 aborted turn 后立刻续跑同一首条请求，默认阅读会只保留续跑 turn 的请求。未结束但正在等待 `wait_agent`/`handoff` 或最后停在助手回复后的 turn 会标记为 `waiting`，其他未结束 turn 保持 `running`。
- 页面默认进入阅读视图，并提供四种主视图：
  - 阅读视图：负责日常阅读，展示用户输入、每一条助手消息、Codex 上下文压缩摘要和子代理摘要；如果 `token_count` 提供可解析的 context window 或百分比，助手消息标签会以独立徽标显示当时的上下文占用率，超过 70% 时使用高占用提示样式。`compacted` / `context_compacted` 会以系统块显示压缩生成的替换摘要、窗口 ID 和“被替换的对话”范围，替换范围会优先展示覆盖的轮次、角色构成、原始问题预览和最后回复摘要，字符数与 turn id 仅作为辅助定位信息；原始消息标签旁会回标“被替换 N 条 / 事件编号”，用户消息只统计自身替换条目，助手消息统计自身以及按审计链执行层级挂到该助手消息下的工具/执行条目，点击后会保持在阅读视图并定位到对应压缩系统块；“被替换的对话”里的具体条目也可点击跳回原始消息或对应助手消息组。左侧“执行层级”目录会在对应轮次下显示“上下文压缩摘要 / 上下文压缩完成”节点，点击后直接跳到正文中的压缩系统块。完整来源仍可通过系统块里的“查看原始事件”打开。若父会话中有 `spawn_agent` 子代理，会按父子层级内嵌展示子代理自己的用户输入和每轮全部助手消息，并在目录中按“会话 -> 轮次 -> 压缩事件 -> 子代理 -> 子代理轮次”展示执行层级用于快速跳转；执行层级区域会尽量使用可用视口高度展示更多目录内容。
  - 审计链视图：负责复盘，以轮次为一级审计单元展示“目标、执行链、证据、验证、风险、缺口和最终回复”。每个轮次默认显示紧凑摘要，展开后显示“执行链”，并在需要时显示“未关联 / 原始事件复核”节点；执行链先把 `assistant-message` 投影为 `agent_message` 父行，并在可解析时用独立徽标展示该助手消息当时的上下文占用率，超过 70% 时使用高占用提示样式，再把工具、handoff、子代理和 lazy-child 执行节点挂到最近的助手消息下；没有可用助手正文时会生成“未记录正文”的助手占位父行，避免执行节点裸露。每个执行节点下内嵌行动、输出证据、验证、风险和缺口子层级；连续命中执行聚合规则的节点会折叠为可展开执行组，例如多次读取文件、列出目录会聚合为“执行组 · 收集文件与目录信息”。审计链节点按 `traceNodeId`、`itemRef`、`turnIndex` 挂载为状态徽标或证据行，无法可靠挂载的节点进入“未关联”区域。审计链顶部可开启“极简模式”，该模式把每轮渲染为“轮次信息 / 固定宽度纵向上下文占用条 / 伴随面板”三列：中间色条在同一列里上下连接，旁边保留 0% / 50% / 100% 刻度，轮次交界处只增加细分界线以保留会话连贯性；条内每个纯色色段代表一次可点击操作，色段高度按该操作约 token 量归一化，颜色表达操作类型，图内不显示文字，也不展示标题、摘要、工具参数或输出正文，未记录上下文占用的操作使用斜纹色段。右侧伴随面板默认展示该轮操作数、约 token、风险、验证状态和类型 token 分布；点击色段后，伴随面板切换为选中操作的类型、约 token、上下文占用、状态、来源和短摘要。右侧复核台继续负责解释当前轮次、执行节点、审计链节点、关联项或原始事件的可信度、证据、关系和来源。
  - 统计视图：负责事件类型分析，按当前内容搜索和类型过滤统计原始事件分类，展示事件类型数、约 token 总量、事件体积和最多类型，并用表格列出每类事件的数量、约 token、平均约 token、占比和体积。token 量是基于原始事件体积、payload 体积或预览文本长度的近似估算，用于扫描会话构成，不作为计费口径。
  - 原始事件视图：负责诊断，保留原始事件查看能力；它把会话事件摘要提升为主视图，左侧按事件索引和分类浏览，右侧显示选中事件的结构化摘要和 Pretty JSON，事件列表与预览区各自独立滚动；当选中上下文压缩事件时，会优先展示压缩摘要正文、窗口信息、替换历史数量和被替换对话预览。完整原始内容仍通过单事件接口按需读取。
- 左栏始终保持为会话列表，默认展示“实时 <3h”分类；会话列表可按实时（3 小时内）、近一天（3 小时到 1 天）和更早（1 天以上或未知时间）切换，每个时间分类下再按工作目录聚合。本机数据源各时间分类都可直接打开正文；远端数据源的“近一天/更早”为历史索引入口，只显示元数据，不包含正文，会话行会标注“仅索引/未同步正文”。阅读视图目录会体现每个子代理是在哪个轮次下启动的，子代理下继续递归展示自己的轮次。若未来出现子代理再 spawn 子代理，也会继续展开；若数据形成循环，会在目录中截断已出现过的线程以避免无限展开。
- 执行树模型优先使用 `thread_spawn_edges` 作为父子线程强关系，使用 `threads.agent_nickname`、`threads.agent_role`、`threads.rollout_path` 展示子代理元数据；当线程行缺少昵称/角色时，会从子会话 JSONL 的 `session_meta.source.subagent.thread_spawn.agent_nickname` 和 `agent_role` 补齐。主界面不再单独暴露执行树视图，审计链和复核台按需展示执行节点。
- JSONL 中的 `spawn_agent`、`wait_agent`、`subagent_notification` 用于把子代理节点锚定到父会话时间线中。
- 阅读视图会内嵌直接子代理及其下级子代理的轻量消息摘要，默认最多递归 3 层；完整子代理正文仍通过打开对应会话查看。
- 类型过滤提供“上下文压缩”，可一键查看所有 `compacted` 和 `context_compacted` 事件；统计条同步显示上下文压缩事件数量。
- 点击子代理小卡片或阅读视图中的“打开会话”会按会话 ID 切换到对应子线程。
- 会话详情接口的共享 `turns/items` 模型保留完整用户/助手文本、工具参数和工具输出，供审计链、复核台、Markdown 导出和外部查询使用；阅读视图、事件摘要、原始内容预览和原始来源仍按各自场景限长，避免摘要型区域被超大内容撑满。
- 阅读视图的用户/助手消息支持常用 Markdown 渲染，包括标题、列表、引用、行内代码、代码块、链接、粗体、斜体、删除线和 GFM 管道表格；会话标题在列表、顶部标题、详情和阅读视图中支持行内 Markdown 链接、代码和强调；渲染层禁用原始 HTML，并缓存解析结果以减少大段消息重复渲染成本。
- 右侧复核台是对象级复核台，默认展示会话概览；选中轮次、执行节点、审计链节点、关联项或原始事件后，统一切换为“摘要 / 证据 / 关系 / 来源”四页。摘要页优先展示审计链节点的完整 `body` 正文，长内容由复核台整体滚动，不在摘要框内截断；其中 `apply_patch` 正文会使用 patch 专用视图，而不是拆成普通摘要条目；高频命令输出会使用命令输出结构化视图展示状态、指标和关键行，而不是直接显示一整段终端文本；桌面端复核台宽度支持拖拽和键盘方向键调整；它不再展示关键事件列表，也不默认渲染完整 JSON。
- 完整原始事件通过 `GET /api/sessions/:id/events/:index` 按需读取；复核台只有在“来源”页读取完整原始内容或执行复制 JSON 动作时才请求完整事件。
- 图片和附件默认只以安全摘要进入轻量模型：data URI 会记录媒体类型和估算大小但不进入列表、搜索索引或默认 DOM；URL/文件引用只显示占位，不自动远程拉取。
- Markdown 导出通过 `GET /api/sessions/:id/markdown` 按需生成，不内嵌在详情响应中。
- 页面支持会话搜索、会话概览、对象级复核、证据包复制、按需原始来源读取和 Markdown 导出。复制入口只有在浏览器剪贴板或 fallback 复制成功后才提示“已复制”，失败时统一提示“复制失败：...”；复制或下载完整 Markdown 成功时会提示其中包含会话正文、路径和命令输出。选择新会话时会先显示加载状态并禁用导出，读取失败不会保留上一会话内容误导用户。

### Audit Chain

Audit Chain 是只读派生模型，不修改原始会话数据。服务端在会话详情里基于内部完整 `turns/items` 生成 `audit.nodes` 和 `audit.counts`；返回给普通视图的 `turns/items` 仍是轻量渲染模型。审计链节点的 `summary` 保持短摘要用于主列表和搜索，`body`、`argumentsBody`、`outputBody` 保留完整正文供复核台摘要页展示。证据风险规则保存在浏览器 localStorage，前端请求会话详情时会把规则序列化到查询参数，服务端按规则指纹区分缓存并重新派生 Audit。前端不再把节点平铺成时间线，而是按轮次聚合展示。轮次摘要展示意图、最终结果、验证状态、最高风险和工具/子代理/证据/缺口计数；展开后，“执行链”回答这个轮次怎么做的，助手消息作为执行上下文父行，所有工具、命令、handoff 和子代理执行节点缩进挂载在对应 `agent_message` 下，并在每个执行节点下展示相关行动、证据、验证、风险和缺口；修改文件类行动会在执行链和复核台中显示文件状态、路径、增删行和 stat bar，减少用户打开原始 patch 才能判断改动范围的成本。前端展示审计链节点时会应用可读摘要规则，把高频工具调用压缩成人类可扫描的动作短语；执行链还会按可配置聚合规则把连续的同类执行节点折叠为执行组，组内节点可展开查看并继续支持复核台选择；“来源”页和复制 JSON 仍保留原始节点结构。设置页保存自定义摘要规则、执行聚合规则和证据风险规则前会校验必填字段和 JavaScript 正则；校验失败时不会保存到 localStorage，不会关闭弹窗，错误会显示在对应字段旁。

执行聚合规则是前端展示规则，默认至少 2 个连续命中节点才会成组，内置规则覆盖文件/目录信息收集、代码搜索定位和 Git 状态/差异检查。规则包含名称、工具匹配、最少连续节点数、匹配正则、组标题模板和组摘要模板，保存前会校验名称、匹配正则和 `/.../flags` 工具正则，校验通过后保存在当前浏览器 localStorage；清空自定义后回退到内置规则。聚合只改变审计链执行链的视觉层级，不改变搜索到的原始执行节点、审计链节点、复核台来源或原始事件。

证据风险规则是服务端 Audit 派生规则，默认内置“工具输出风险词”和“工具输出过大”两项。风险词规则可配置工具匹配、风险等级、状态失败等级、风险词正则、非零失败正则、参与扫描的字段，以及“忽略输出正文的命令正则”；默认忽略 `cat`、`Get-Content`、`rg`、`grep`、`findstr`、`Select-String` 等文件读取和文本搜索命令的输出正文，但仍保留状态字段失败信号。大型输出规则可配置扫描字段和字符阈值。设置页在证据风险分类中展示当前生效规则和内置规则参考；内置规则编辑项是本地覆盖，保存后会覆盖同名内置规则。未保存更改判定只比较会写入 localStorage 的自定义规则或内置规则覆盖，单纯为了编辑器展示而注入的内置证据风险规则不会启用保存按钮。保存前会校验名称、参与扫描字段、字符阈值、风险词正则和非零失败/忽略命令等可选正则，错误配置不会保存，也不会被 normalize 静默替换成默认值；保存成功后当前会话详情会重新请求，Audit 风险节点即时按新规则重算；如果规则已保存但当前会话按新规则重新读取失败，设置页会提示“展示规则已保存，但当前会话重新读取失败：...”，不会误报为保存失败。

前端按内容搜索和审计链专用节点类型过滤展示（全部、意图、推理、行动、证据、验证、风险、最终回复），不复用普通事件分类或原始事件类型语义。搜索或筛选命中风险、证据、验证或工具节点时，会保留所在轮次摘要和必要执行链上下文，避免显示孤立风险列表。节点类型包括：

- `intent`：有效用户消息，代表用户意图。
- `reasoning`：reasoning 摘要或助手中间说明；加密 reasoning 只标注状态，不伪造内容。
- `action`：工具调用，包含工具名、参数预览、turn、时间和 source/event index。
- `evidence`：工具输出证据，包含输出预览、状态和输出事件索引。
- `verification`：测试、检查、构建、lint、Playwright、`node --test`、健康检查类命令或输出。
- `risk`：由启发式规则生成的风险信号节点，关联原始行动/证据/最终回复。
- `final`：每轮最后一条助手回复，作为最终声明入口。

风险规则保持可解释和可扩展，其中证据风险规则集中在 `src/evidence-risk-rules.mjs`：

- 普通工具输出或状态包含 `error`、`failed`、`fail`、`exception`、`stderr`、`失败`、`错误` 等风险词会生成风险；文件读取命令和文本搜索命令的输出正文不参与这条风险词扫描，避免把代码或搜索命中的文本误判为执行风险。
- 可执行 shell/terminal/command 类工具的真实命令段疑似执行 `rm`、`del`、`Remove-Item`、`git reset`、`git clean`、`drop`、`delete`、`format`、`Format-Volume` 等危险动作时标记为中高风险；`rg/grep/findstr` 搜索文本和 `Format-Table/Format-List` 展示格式化不算危险命令；补丁或文本编辑类工具里出现这些词只标记为低风险复核信号，不代表实际执行了危险命令。
- 最终回复包含“已测试、测试通过、验证通过、完成、已修复”等声明，但本会话没有检测到 `verification` 节点时，标记“声明缺少验证证据”。
- 有工具调用但没有对应输出时，标记低到中风险。
- 工具参数、输出或原始内容被轻量模型截断时，只保留截断标记和原始事件索引，供复核台来源页或原始事件视图按需复核；不会单独生成审计链节点，也不会计入风险或缺口。

风险节点只是复核信号，用来提示需要回看原始事件、工具输出或声明依据，不代表安全证明，也不等同于失败判定。

证据映射采用尽力而为策略：执行结构以 `trace.root` 为骨架，审计链节点通过 `traceNodeId`、`itemRef` 和 `turnIndex` 投影到对应轮次或执行节点；`relatedNodeId` 只用于复核台中的关联跳转，不用于反推树父子关系。无法可靠挂载到执行链的审计链节点会显示在“未关联”区域，不会静默丢失。

审计链节点保留 `itemRef`、`eventIndex/sourceIndex`、`traceNodeId`、工具名和完整正文 `body`；右侧复核台可复制会话引用或对象引用、摘要、证据包或 JSON，并在存在事件索引时跳到原始事件。完整原始 JSON 仍通过单事件接口按需读取，不会把整条 JSONL 原文嵌入会话详情。

## 本地 API

只读 API 只接受 `GET`，错误方法统一返回 `405` JSON error。写接口保持各自声明的方法：远端数据源配置使用 `GET/POST/PUT/DELETE`，连通性测试和远端快照拉取使用 `POST`。静态文件当前只接受 `GET`，不单独支持 `HEAD`。通用错误响应保持 `{ "error": "<中文提示>", "details": ... }` 结构，前端优先展示中文 `error` 文案；例如 `405` 返回“请求方法不允许”，数据源、会话、事件不存在分别返回“数据源不存在”“会话不存在”“事件不存在”，无效 `evidenceRiskRules` 返回“evidenceRiskRules 参数无效”，静态 404 返回“未找到资源”。`details` 可保留调试字段，但不作为普通用户提示来源。

- `GET /api/health`：查看只读数据源和服务状态。
- `GET /api/sources`：列出本机和远端数据源、快照拉取状态和脱敏失败原因。
- `GET /api/peers`：列出页面管理的远端数据源配置，token 只返回 `hasToken`。
- `POST /api/peers` / `PUT /api/peers/:id` / `DELETE /api/peers/:id`：新增、更新、移除本机保存的远端数据源配置，并热重载数据源；删除接口只移除本机配置和 token，不删除远端会话、远端快照或本机已拉取的缓存快照。
- `POST /api/peers/:id/test`：用已保存 token 调用对端只读健康检查；当前表单草稿不会参与测试，不保存配置，不拉取快照。
- `POST /api/sources/:sourceId/refresh`：拉取远端数据源快照到本机缓存；本机数据源不可拉取。
- `GET /api/sessions`：读取轻量会话列表，优先来自 SQLite。
- `GET /api/sessions/:id`：读取单个会话的轻量渲染模型、Trace 和事件摘要。
- `GET /api/sessions/:id/events/:index`：读取单个完整 JSONL 事件。
- `GET /api/sessions/:id/markdown`：按需导出完整 Markdown。

旧的 `/api/sessions...` 接口保持兼容，默认读取 `local` 数据源，也可临时用 `?sourceId=<id>` 指定数据源。新代码优先使用显式数据源接口：

- `GET /api/sources/:sourceId/sessions`
- `GET /api/sources/:sourceId/index?bucket=day|earlier&q=...`：代理远端历史索引检索，只返回会话元数据，不返回正文。
- `GET /api/sources/:sourceId/sessions/:id`
- `GET /api/sources/:sourceId/sessions/:id/events/:index`
- `GET /api/sources/:sourceId/sessions/:id/markdown`

### 外部查询 API

外部项目优先使用 `/api/query/*`。这些接口返回稳定的 JSON 结构，支持字段投影、分页和增量读取；旧的 `/api/sessions/*` 继续服务本项目浏览器页面。查询 API 默认读取 `local` 数据源，也可用 `?sourceId=<id>` 指定数据源，或使用显式数据源路径 `/api/sources/:sourceId/query/*`。

响应中的 `links` 会跟随查询入口保持数据源边界：默认 `/api/query/sessions` 返回兼容旧接口的 `/api/sessions...` 和 `/api/query...` 链接；显式数据源路径 `/api/sources/:sourceId/query/*` 返回 `/api/sources/:sourceId/...` 链接。旧查询入口如果用 `?sourceId=<非 local>` 明确读取远端数据源，也会返回 source-scoped links，避免外部调用者后续跳回本机 `local` 数据源。

#### 查询会话列表

```http
GET /api/query/sessions?changedAfter=2026-06-25T00:00:00.000Z&limit=50
```

响应：

```json
{
  "sessions": [
    {
      "id": "thread-id",
      "title": "会话标题",
      "preview": "首条预览",
      "cwd": "D:\\github\\project",
      "model": "gpt-5",
      "archived": false,
      "startedAt": "2026-06-25T07:00:00.000Z",
      "updatedAt": "2026-06-25T08:00:00.000Z",
      "changedAt": "2026-06-25T08:00:00.000Z",
      "links": {
        "detail": "/api/sessions/thread-id",
        "compactView": "/api/query/sessions/thread-id/view?view=compact",
        "events": "/api/query/sessions/thread-id/events",
        "markdown": "/api/sessions/thread-id/markdown"
      }
    }
  ],
  "page": {
    "offset": 0,
    "limit": 50,
    "returned": 1,
    "total": 1,
    "nextCursor": null
  },
  "watermark": "2026-06-25T08:00:00.000Z",
  "serverTime": "2026-06-25T08:10:00.000Z"
}
```

显式数据源查询示例：

```http
GET /api/sources/dev71/query/sessions?limit=5&fields=id,title,changedAt,links
```

其中 `links.detail`、`links.compactView`、`links.events`、`links.markdown` 会分别指向 `/api/sources/dev71/sessions/:id`、`/api/sources/dev71/query/sessions/:id/view?view=compact`、`/api/sources/dev71/query/sessions/:id/events` 和 `/api/sources/dev71/sessions/:id/markdown`。

常用参数：

- `q`：在标题、预览、工作目录、模型、来源、代理昵称/角色等字段中做包含匹配。
- `changedAfter` / `changedBefore`：按 `updatedAt || fileModifiedAt || startedAt` 筛选，适合外部项目轮询增量会话。
- `startedAfter` / `startedBefore`：按会话开始时间筛选。
- `id` / `ids`：筛选指定会话 ID，支持逗号分隔或重复参数。
- `cwd`、`title`、`model`、`source`、`threadSource`、`modelProvider`、`agentNickname`、`agentRole`：字段包含匹配。
- `archived=true|false|any`：按归档状态筛选。
- `includeChildren=true`：包含子代理线程；默认只返回根会话，和浏览器左栏保持一致。
- `isChild=true|false`、`hasChildren=true|false`：按父子线程关系筛选。
- `sort=changedAt|updatedAt|startedAt|title|id|sizeBytes`，`order=asc|desc`：排序。
- `limit`：每页数量，默认 `100`，最大 `500`。
- `cursor`：上一页响应的 `page.nextCursor`。
- `fields=id,title,changedAt,links`：只返回指定字段；`id` 会始终保留。
- `includePath=true`：额外返回本机绝对 JSONL 路径。默认不返回绝对路径，避免外部消费者不必要地耦合本机目录。

推荐增量同步方式：

1. 首次请求 `GET /api/query/sessions?limit=100`，保存响应里的 `watermark`。
2. 继续用 `cursor` 拉取剩余分页，直到 `nextCursor` 为 `null`。
3. 下一轮轮询使用 `changedAfter=<上次保存的 watermark>`。

#### 读取会话视图

```http
GET /api/query/sessions/:id/view?view=compact&maxDepth=3
```

`view` 可选：

- `compact`：精简视图，包含每轮有效用户输入、全部助手消息和内嵌子代理摘要，适合大多数外部阅读场景。
- `turns`：turn/item 阅读模型，包含工具调用预览，供导出、Audit 和外部查询使用。
- `audit`：审计链模型，包含意图、推理、行动、证据、验证、风险和最终回复节点，适合外部工具做证据链复核。
- `trace`：执行树模型，适合审计工具调用、handoff 和子代理关系；这是外部查询 API 能力，不再作为浏览器主视图入口展示。
- `detail`：完整轻量详情，等价于组合返回 `session`、`turns`、`events`、`stats`、`trace`、`compact`、`audit`。

`maxDepth` 控制精简视图递归内嵌子代理层数，默认 `3`，最大 `8`。

#### 增量读取会话事件

```http
GET /api/query/sessions/:id/events?cursor=0&limit=100
```

响应：

```json
{
  "session": {
    "id": "thread-id",
    "title": "会话标题",
    "changedAt": "2026-06-25T08:00:00.000Z"
  },
  "events": [
    {
      "index": 0,
      "timestamp": "2026-06-25T07:00:00.000Z",
      "kind": "user_message",
      "important": true,
      "type": "event_msg",
      "payloadType": "user_message",
      "role": null,
      "title": "user_message",
      "preview": "用户输入",
      "payloadSize": 128
    }
  ],
  "page": {
    "cursor": 0,
    "limit": 100,
    "maxScan": 5000,
    "scanned": 100,
    "returned": 100,
    "nextCursor": 100,
    "hasMore": true
  },
  "serverTime": "2026-06-25T08:10:00.000Z"
}
```

事件参数：

- `cursor`：从指定事件逻辑索引开始读取。也可用 `after=123` 表示从 `124` 开始。
- `limit`：最多返回事件数，默认 `100`，最大 `1000`。
- `maxScan`：筛选条件很窄时最多向后扫描的事件数，默认 `5000`，最大 `50000`。
- `kind` / `kinds`：按事件分类筛选，如 `user_message`、`agent_message`、`function_call`。
- `type` / `types`：按 JSONL 顶层 `type` 筛选，如 `event_msg`、`response_item`。
- `payloadType` / `payloadTypes`：按 `payload.type` 筛选。
- `role` / `roles`：按 `payload.role` 筛选。
- `important=true|false|any`：按重要事件筛选；`onlyImportant=true` 是兼容别名。
- `from` / `to`：按事件时间范围筛选。
- `q`：在标题、预览、分类和规范化搜索文本中做包含匹配；默认不索引 `encrypted_content` 或 data URI 原文。
- `includePayload=true`：返回完整 `payload`。
- `includeRaw=true`：返回完整原始事件。
- `fields=index,timestamp,kind,preview`：只返回指定字段；`index` 会始终保留。

注意：事件接口按 JSONL 逻辑行索引增量读取。使用筛选条件时，`page.nextCursor` 代表下一次应继续扫描的位置，不等于最后一个返回事件的 `index + 1`。查询路径会保留 JSONL 解析失败行的诊断事件，`kind` 为 `jsonl_parse_error`，包含行号、错误类别和安全预览。

## 已知边界

- JSONL 中的 reasoning 详细内容通常是加密字段，只能展示摘要或提示。
- 当前本机样本中的 `reasoning.summary` 为空，真实推理内容在 `encrypted_content` 中，因此页面不会伪造“推理摘要”；默认搜索和轻量预览不会包含 `encrypted_content` 原文。
- Trace duration 并非所有节点都有明确开始/结束时间；缺失结束时间时会标注为估算。
- Codex App 原始 `.map` 未随包发布，因此本项目不会尝试还原官方 TSX 源码。
- 不同 Codex 版本的事件字段可能变化；原始事件主视图和复核台的来源页保留按需 JSON 诊断入口。
- HTTP 快照下载要求远端提供 Codex Home 快照包，本项目不会把远端设备暴露成通用文件浏览器。
- 页面管理的数据源访问令牌保存在本机私有 `%USERPROFILE%\.codex-session-renderer\config.json`；高级环境变量模式从运行时环境读取 token。两种模式都不要把真实 token 写入 README、`.env.example` 之外的仓库文件、Issue 评论、日志或 API 响应。
