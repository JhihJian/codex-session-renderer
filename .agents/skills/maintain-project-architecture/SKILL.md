---
name: maintain-project-architecture
description: 在代码、配置、测试或外部边界变化后维护项目架构文档。
---

# 维护项目架构文档

先阅读 `docs/architecture/AGENTS.md`、[分层架构文档写作协议](../references/layered-authoring.md)和[架构图编写协议](../references/diagram-authoring.md)。没有当前生效版本时，改用 `investigate-project-architecture` 和 `generate-project-architecture`。

1. 需要在写入前预览影响时，运行 `node .agents/architecture-governance-tools/architecture-workflow.mjs impact`。
2. 提交前运行 `node .agents/architecture-governance-tools/architecture-workflow.mjs prepare --write`，将受影响结论和未归属变更写入本次待处理清单。该命令是维护流程的必经入口。
3. 先复核受影响的实现参考，再判断模块职责、所有权、依赖、失败语义或边界是否变化。只有跨模块结构、核心流程或长期业务约束变化时才升级修改架构总览。
4. 只有关键责任关系、数据责任、状态转移、信任边界或跨模块流程发生变化时才更新对应图。图变化必须同步更新图组契约、证据、跨图名称/所有权和下钻链接；发现信息过载时应拆图，不要只增加颜色或连线。
5. 每项结论只能记录“已更新”“确认无影响”或“待确认”之一，并写入可定位依据。每项未归属变更也必须登记“已映射”“确认无影响”或“待确认”。更新相应层级的架构文档和状态记录；已安装决定治理且变更满足 Note 准入条件时，更新负责该决定的 Agent Note。
   - `已映射` 要求把路径加入对应结论的 `impactPaths`、证据或测试，将对应条目加入 `itemIds` 和 `assessments`，并在 `pathAssessments` 中使用 `mapped`。
   - `确认无影响` 在 `pathAssessments` 中使用 `unaffected`，写明原因和可定位依据。
   - `待确认` 使用 `pending`，架构保持候选状态并阻断生效。
6. 运行 `check-project-architecture`。关键事项未确认、层级混杂、事实重复、图表不清晰或待处理清单不完整时保持阻断，不得生效。
7. 提交架构候选及其实现变更。候选期间出现新变更时重新运行 `prepare --write` 并复核清单。
8. 检查通过后运行 `node .agents/architecture-governance-tools/architecture-workflow.mjs accept --write`，再提交生效状态。工具只允许状态文件自身在 accept 前保持未提交。

删除或重命名代码、配置或测试文件时也必须运行本流程。工具应以最后一次生效记录计算影响，不能因旧文件已经不存在而跳过维护。
