# agent-sessions 会话展示设计学习文档

## 背景与样本

本文分析 `jazzyalex/agent-sessions` 的会话展示能力，重点学习其 Transcript、Terminal、Raw JSON、会话列表、搜索导航、图片浏览和事件检查器设计，并提炼适合 `codex-session-renderer` 吸收的实现思路。

样本信息：

- 仓库：<https://github.com/jazzyalex/agent-sessions>
- 本地样本路径：`.codex-runtime/competitors/agent-sessions`
- 样本 commit：`67492b6fc8882177e7702abbeb39f7a4b6018dd9`
- 许可：MIT License，版权声明为 `Copyright (c) 2026 Alexander Malakhov`
- 技术栈：Swift、SwiftUI、AppKit、SQLite、本地索引

`agent-sessions` 的会话展示目标是把本地 agent 历史变成一个可查找、可阅读、可审计、可回到执行现场的工作台。它对 `codex-session-renderer` 的主要价值集中在展示模型和交互结构。

## 总体页面结构

`agent-sessions` 的主窗口围绕两个主要区域组织：

1. 会话列表区域：用于筛选、搜索、排序、选择和执行会话级操作。
2. Transcript 区域：用于阅读选中会话，并提供模式切换、查找、复制、导出和跳转。

主布局由 `UnifiedSessionsView` 组织，支持横向或纵向 split view。列表和正文可以同时显示，也可以隐藏正文窗口，转成列表优先的浏览模式。

页面顶层工具栏承担全局导航能力：

- agent 来源过滤：Codex、Claude、OpenCode、Cursor、Copilot、Pi 等。
- 活跃会话过滤。
- 子代理层级展开/折叠。
- 全局搜索。
- 收藏过滤。
- Resume、打开工作目录、显示日志文件、图片浏览、Agent Cockpit、Git Context、设置等动作。

这个设计把“找会话”和“读会话”分开处理。列表关注历史集合，正文关注单个会话的理解和定位。

## 会话列表展示设计

会话列表是一个多列 `Table`，核心列包括：

- 收藏星标。
- Agent 来源。
- 会话标题。
- 日期。
- 项目。
- 消息数。
- 文件大小。

列表行不仅展示标题，还会叠加层级上下文，例如 subagent、side chat、父会话标题和项目 worktree。右键菜单提供高频会话级操作：

- Save / Remove from Saved。
- Resume in 原始 CLI。
- Focus in iTerm2。
- Open Working Directory。
- Reveal Session Log。
- Copy Session ID。
- Copy Resume Command。
- Show Git Context。
- Filter by Project。

值得学习的点：

- 列表是工作入口，不只是导航目录。
- 会话行上直接暴露“来源、项目、时间、大小、消息数”等判断信息。
- 右键菜单把“继续工作”和“审计上下文”放到同一个入口。
- 子代理层级可以在列表里显示和折叠，历史会话因此具有执行结构感。

对本项目的启发：

- 当前本项目左栏按时间和目录聚合已经有基础，可以继续增加收藏、消息数、文件大小、工具数、错误数、子代理标记等轻量列或徽标。
- 会话行右键菜单可加入“复制 session id”“复制 resume 命令”“复制 JSONL 路径”“按此项目过滤”。
- 子代理线程在左栏隐藏是合理默认，同时可提供“显示执行层级”的可切换列表模式。

## 三种正文模式

`agent-sessions` 把单个会话正文分成三个用户视角：

| 模式 | 内部枚举 | 面向任务 | 展示重点 |
| --- | --- | --- | --- |
| Session / Terminal | `SessionViewMode.terminal` | 还原 CLI 执行现场 | 用户输入、助手叙述、工具调用、工具输出、错误 |
| Text / Transcript | `SessionViewMode.transcript` | 阅读对话 | 合并后的聊天和工具文本 |
| JSON | `SessionViewMode.json` | 调试解析 | pretty JSON 或原始 JSON |

源码中 `SessionViewMode` 负责用户可见模式，`TranscriptRenderMode` 负责底层渲染模式。这个分层使视图名称可以按产品语义表达，同时保持渲染器内部的兼容。

### Transcript 模式

Transcript 模式服务于快速阅读。它通过 `SessionTranscriptBuilder.buildPlainTerminalTranscript(..., mode: .normal)` 生成普通文本，重点展示用户和助手对话，并保留必要的工具内容。

它适合回答：

- 这轮会话主要讨论了什么？
- 用户提出了哪些需求？
- agent 最终给出的结论是什么？

Transcript 模式会减少执行现场噪音，让用户把会话当成对话记录阅读。

### Terminal / Session 模式

Terminal 模式是 `agent-sessions` 会话展示中最值得学习的部分。它以 CLI 执行现场为目标，把会话拆成 line-level 的终端日志模型：

- `TerminalLineRole.user`：用户提示。
- `TerminalLineRole.assistant`：模型叙述。
- `TerminalLineRole.toolInput`：工具调用或命令输入。
- `TerminalLineRole.toolOutput`：工具标准输出或成功输出。
- `TerminalLineRole.error`：错误、stderr、非零退出。
- `TerminalLineRole.meta`：时间戳、标签等元信息。

`TerminalBuilder` 从 `SessionTranscriptBuilder.coalescedBlocks(...)` 取得逻辑块，再生成 `TerminalLine`。每行携带：

- 稳定递增 `id`，用于滚动和跳转。
- 可见文本 `text`。
- 角色 `role`。
- `blockIndex`、`decorationGroupID` 和 `semanticKind`，用于块装饰、导航、搜索和语义高亮。

Terminal 模式的关键不在于模拟真实终端像素，而在于保留 agent 工作的执行语义。用户可以看到：

- 人类下达的指令。
- agent 的计划或说明。
- 调用了哪个工具。
- 工具输入是什么。
- 输出是否成功。
- 哪些地方失败。

### JSON 模式

JSON 模式把 Raw JSON 提升为正文的一等视图。它适合开发者排查解析器、事件映射和展示缺失问题。

相关设计点：

- JSON 作为 view mode，进入正文的核心视图切换。
- Pretty JSON 和 Raw JSON 可以切换。
- JSON 文本保留等宽字体和复制能力。
- 事件级 Inspector 同样提供 Pretty / Raw JSON 两个标签。

对本项目的启发：

- 本项目已有 Inspector 的调试 JSON 和按需事件接口，可以把“Raw JSON”提升为主视图。
- 主视图 Raw JSON 可展示当前会话的事件摘要列表，点击后按需拉取完整事件。
- Inspector 继续承担单个事件、Trace 节点和选中项的局部调试。

## 数据模型分层

`agent-sessions` 展示层的核心分层是：

```text
原始会话事件
  -> normalized SessionEvent
  -> LogicalBlock
  -> Transcript 字符串 / TerminalLine[]
  -> UI 文本、块背景、色条、导航目标、查找范围
```

### SessionEvent

`SessionEvent` 是统一事件模型。它吸收不同 agent 和不同版本的原始格式差异，向展示层提供稳定字段：

- `kind`
- `text`
- `toolName`
- `toolInput`
- `toolOutput`
- `rawJSON`
- `messageID`
- `parentID`
- `timestamp`

这种设计让 UI 面向稳定展示字段，原始 JSONL 结构由解析层吸收。

### LogicalBlock

`SessionTranscriptBuilder.LogicalBlock` 是展示前的结构化块，类型包括：

- user
- assistant
- toolCall
- toolOut
- error
- meta

coalescer 会把连续 delta、同一 message id 的 assistant 文本、同一工具输出合并成更适合阅读的块。它还会识别工具输出错误，并把 Codex 图片 marker 规范化。

这个层次对本项目很关键。当前本项目已经有 turn 和 item 聚合，但还可以新增“展示块”中间层，专门服务不同正文模式。

### TerminalLine

`TerminalLine` 是 Terminal 模式的渲染模型。它比字符串更强，因为它保留了角色、块归属和语义分类。

本项目如果实现 Terminal 视图，可以在服务端或前端生成类似结构：

```json
{
  "id": 42,
  "text": "npm test",
  "role": "toolInput",
  "turnIndex": 3,
  "itemRef": "3:5:tool-call",
  "blockId": "turn-3-tool-5",
  "semanticKind": null
}
```

这样可直接支持：

- 按角色过滤。
- 用户/工具/错误跳转。
- 块级颜色和左侧色条。
- 搜索命中滚动定位。
- 选中后 Inspector 展示来源项。

## 语义颜色系统

`TranscriptColorSystem` 是其 transcript 颜色的单一来源。它区分两类颜色：

1. 语义颜色：用户、工具调用、工具输出成功、错误、计划、代码、diff、review summary。
2. agent 品牌颜色：Codex、Claude、OpenCode、Cursor、Copilot 等。

核心映射：

| 语义 | 颜色意图 |
| --- | --- |
| user | 蓝色 |
| toolCall | 紫色 |
| toolOutputSuccess | 绿色 |
| toolOutputError / error | 红色 |
| plan | 青绿色 |
| code | 靛蓝 |
| diff | 橙色 |
| reviewSummary | 青色 |

它用样式区分 agent 叙述和工具成功输出，防止绿色品牌色和成功语义混淆。块样式通常包含：

- 轻微背景 tint。
- 左侧 4px accent strip。
- 不同块类型不同 padding。
- 当前查找结果和普通查找结果叠加高亮。

对本项目的启发：

- 建立 `--role-user`、`--role-assistant`、`--role-tool-call`、`--role-tool-output`、`--role-error` 等 CSS 变量。
- 列表、正文、Trace、Inspector 共用同一套语义色。
- 工具调用和工具输出使用不同颜色，错误输出优先红色。

## Terminal 视图的交互能力

Terminal 视图是一组可导航的长会话工作日志，提供面向角色、语义和搜索命中的定位能力。

### 角色过滤与跳转

`SessionTerminalView.RoleToggle` 支持：

- User
- Assistant
- Tools
- Errors

每个 toggle 同时显示当前项/总数，并提供上一处、下一处按钮。用户既能隐藏某类内容，也能快速跳到该类内容。

### 语义导航

除角色外，它还识别语义片段：

- Plan
- Code
- Diff
- Review

这些语义由 `SemanticKind` 表示。它让用户可以在长会话中直接跳到计划、代码块、diff 或 review summary。

### Find 与全局搜索联动

它同时处理两类搜索：

- 全局搜索：从会话列表搜索命中进入正文，并在正文中定位。
- 会话内 Find：`Cmd+F` 在当前 session 内查找，支持上一处/下一处和计数。

Terminal 模式专门维护自己的搜索快照和 line id 映射，保证搜索命中能回到正确行。

对本项目的启发：

- 现有 `itemSearch` 只是过滤内容，可以升级为“过滤 + 命中计数 + 上下跳转”。
- 阅读视图、Terminal 视图和 Trace 视图应共享搜索词，但各自维护自己的定位模型。
- 对长会话，搜索模型应独立于 DOM 可见节点，便于后续虚拟滚动。

## 块级视觉设计

`SessionTerminalView` 使用自定义 `TerminalLayoutManager` 绘制块背景和查找高亮。它的块类型包括：

- user
- userPreamble
- userInterrupt
- systemNotice
- agent
- plan
- code
- diff
- reviewSummary
- toolCall
- toolOutput
- error
- localCommand
- imageAnchor

每个块类型有自己的背景 tint、accent 色条和 padding。这样同一条长 transcript 形成“视觉地形”：

- 蓝色块表示用户输入。
- 品牌色块表示 agent 叙述。
- 紫色块表示工具调用。
- 绿色块表示成功输出。
- 红色块表示错误。
- 橙色/靛蓝/青色块表示 diff、code、plan 等语义内容。

这个设计比纯文本更适合 agent 会话，因为工具调用和输出常常很长。块级视觉让用户在滚动中快速识别结构。

本项目可用 HTML/CSS 实现同类效果：

```html
<section class="terminal-block role-tool-call">
  <div class="terminal-block-strip"></div>
  <pre>shell {"command":["powershell","-Command","npm test"]}</pre>
</section>
```

第一版可以按 block 渲染，优先形成稳定结构、角色颜色和跳转能力。

## 图片浏览与会话回跳

`agent-sessions` 把图片作为会话展示的一等对象。`CodexSessionImagesGalleryView` 的设计包含：

- 顶部项目过滤和 agent 过滤。
- 图片总数。
- 按日期分组的缩略图网格。
- 右侧详情预览。
- Navigate to Session。
- Open in Preview。
- Copy Image Path。
- Copy Image。
- Save to Downloads。
- Save...

图片浏览器是跨会话的视觉输出索引，适合查找截图、UI 结果、设计图和视觉回归证据。

对本项目的启发：

- 服务端解析 Codex 事件时提取图片引用和 data URI 元信息。
- 会话正文里用 `[Image #1]` chip 表示图片锚点。
- 增加图片面板：按会话或日期列出图片，点击后跳回对应 turn/item。
- 默认只处理本地 data URI 或本地路径，远程 URL 需要显式启用。

## Event Inspector 设计

`EventInspectorView` 提供事件级查看：

- Pretty 标签：显示文本、工具输入、工具输出。
- Raw JSON 标签：显示 pretty JSON。
- Copy。
- Copy Raw。

这个设计保持了两个层次：

- 正文视图负责人类阅读和定位。
- Inspector 负责解释当前选中对象的来源与原始证据。

本项目已有右侧 Inspector，方向一致。可继续强化：

- 阅读/Terminal/Trace/Raw 的选中项统一进入同一个 Inspector。
- Inspector 顶部展示选中项类型、来源 turn、事件 index、时间。
- Pretty 区展示规范化字段，Raw 区按需加载完整 JSON。

## 搜索与性能策略

`agent-sessions` 对搜索和大 transcript 性能投入较多。其思路包括：

- 会话列表先加载轻量元数据。
- 搜索分阶段：优先 SQLite FTS 和元数据，必要时再解析 transcript。
- 小会话批量处理，大会话顺序处理。
- 用户点选大会话时支持 promotion，优先解析被点击的会话。
- transcript cache 让搜索使用接近用户实际看到的文本。
- 大 transcript 后续规划 block-level virtualization。

对本项目的启发：

- 列表接口继续保持轻量。
- 全文搜索可以先覆盖标题、cwd、preview、模型、agent，再扩展到事件全文。
- 大会话正文应分层加载：先展示 turn/块摘要，再按需展开工具输出和 Raw JSON。
- Terminal 视图从第一版开始保留 block id、line id 和搜索文本，为虚拟滚动预留结构。

## 与本项目现状的对照

`codex-session-renderer` 已具备：

- Codex Home 本地只读扫描。
- 远程快照数据源。
- SQLite threads 元数据读取。
- turn 聚合。
- 阅读、精简、Trace 三视图。
- 子代理关系解析和内嵌摘要。
- Inspector、关键事件、按需 Raw JSON。
- Markdown 导出。
- 外部查询 API。

可补强的展示能力：

| 能力 | 当前状态 | 学习方向 |
| --- | --- | --- |
| Terminal 线性执行现场 | 缺少独立模式 | 新增 Terminal 视图，按角色块展示用户、助手、工具、输出、错误 |
| Raw JSON 主视图 | 主要在 Inspector | 提升为主视图，支持会话级 pretty/raw |
| 角色跳转 | 主要靠内容搜索和 Trace | 增加用户/工具/错误计数与上下跳转 |
| 语义色系统 | 有基础样式但分散 | 建立全局 role color token |
| 图片展示 | 尚未系统化 | 提取图片元信息，加入 chip 和图片面板 |
| 收藏/标签 | 尚未实现 | 用 sidecar 数据库保存，不写 Codex Home |
| 搜索定位 | 列表和内容过滤为主 | 增加命中计数、当前命中、滚动定位 |

## 推荐落地方案

### 第一阶段：新增 Terminal 展示模型

新增前端或服务端模型：

```json
{
  "terminal": {
    "blocks": [
      {
        "id": "turn-1-user-0",
        "role": "user",
        "title": "用户输入",
        "text": "...",
        "turnIndex": 1,
        "itemRef": "1:0:user-message",
        "eventIndex": 12
      }
    ],
    "counts": {
      "user": 4,
      "assistant": 6,
      "tools": 12,
      "errors": 1
    }
  }
}
```

实现方式：

- 复用当前 `turns/items`。
- `user-message` -> user block。
- `assistant-message` -> assistant block。
- `tool-call` -> toolCall block。
- `tool-output` -> toolOutput 或 error block。
- `reasoning`、`token-count` -> meta block。

### 第二阶段：新增主视图切换

将当前视图从：

```text
阅读 / 精简 / Trace
```

扩展为：

```text
精简 / 阅读 / Terminal / Trace / Raw
```

默认仍可保持精简视图。Terminal 面向执行复盘，Trace 面向树状审计，Raw 面向调试。

### 第三阶段：实现角色导航

在 Terminal 视图顶部加入：

- User `1/4`
- Agent `1/6`
- Tools `1/12`
- Errors `0/1`

每项提供启用/隐藏和上一处/下一处跳转。第一版可只做跳转，不做隐藏。

### 第四阶段：统一色彩 token

在 CSS 中新增：

```css
:root {
  --role-user: #2563eb;
  --role-assistant: #1f4f99;
  --role-tool-call: #7c3aed;
  --role-tool-output: #15803d;
  --role-error: #dc2626;
  --role-meta: #6b7280;
  --role-plan: #0f766e;
  --role-code: #4f46e5;
  --role-diff: #ea580c;
}
```

列表徽标、Terminal 块、Trace 节点和 Inspector 标签都引用这套变量。

### 第五阶段：图片附件

先实现元信息级能力：

- 解析 image marker、data URI、image_url。
- 正文显示图片 chip。
- Inspector 显示图片类型、大小、来源事件。

再实现图片面板：

- 当前会话图片列表。
- 跨会话图片索引。
- 点击图片跳回会话块。

## 可复用与需重写的边界

可复用的是设计思想：

- 三模式正文。
- LogicalBlock 到 TerminalLine 的分层。
- 语义色系统。
- 角色导航。
- 图片浏览和回跳。
- Inspector 的 Pretty / Raw 分层。

需要按本项目重写的是实现：

- SwiftUI/AppKit 视图要改写为 HTML/CSS/JS。
- `NSTextView`、`NSLayoutManager`、`NSPasteboard`、Quick Look 相关逻辑要替换为浏览器 DOM、CSS、Clipboard API 和下载链接。
- `SessionEvent` 到 `LogicalBlock` 的转换要基于本项目现有 `turns/items/events`。
- macOS 专属 Resume、iTerm2 focus、Finder 操作要改成 Windows/本地 Web 友好的命令复制和路径显示。

后续借用其代码片段或文案时，在本项目保留 MIT 许可证归属。基于设计学习进行重新实现时，可只保留本文的竞品学习记录。

## 设计原则总结

1. 会话展示应服务三个问题：找到哪段历史、读懂发生了什么、定位执行证据。
2. Transcript 适合阅读，Terminal 适合复盘执行，Trace 适合审计结构，Raw 适合排查解析。
3. 工具调用和工具输出应成为一等展示对象，颜色和块结构需要稳定一致。
4. 长会话的导航能力和展示能力同等重要，计数、跳转、搜索命中应成为正文工具栏的一部分。
5. 图片、文件路径、错误输出和子代理关系都是 agent 工作证据，应进入展示模型。
6. 展示层应建立中间模型，减少 UI 对原始 JSONL 字段的直接依赖。

## 参考文件

样本仓库中的重点参考文件：

- `README.md`
- `docs/session-viewer-terminal-raw.md`
- `docs/transcript-color-reference.md`
- `docs/search-architecture.md`
- `docs/session-images-v2.md`
- `docs/superpowers/plans/2026-05-28-transcript-virtualization-plan.md`
- `AgentSessions/Services/SessionViewMode.swift`
- `AgentSessions/Services/SessionTranscriptBuilder.swift`
- `AgentSessions/Services/TerminalModels.swift`
- `AgentSessions/Services/TranscriptColorSystem.swift`
- `AgentSessions/Views/UnifiedSessionsView.swift`
- `AgentSessions/Views/TranscriptPlainView.swift`
- `AgentSessions/Views/SessionTerminalView.swift`
- `AgentSessions/Views/EventInspectorView.swift`
- `AgentSessions/Views/CodexSessionImagesGalleryView.swift`
- `AgentSessions/Search/SearchCoordinator.swift`
