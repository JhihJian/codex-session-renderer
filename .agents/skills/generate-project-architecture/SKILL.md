---
name: generate-project-architecture
description: 根据已完成的架构调查生成候选架构文档，并确认当前生效版本。
---

# 生成项目架构文档

先阅读 `docs/architecture/AGENTS.md`、[分层架构文档写作协议](../references/layered-authoring.md)和[架构图编写协议](../references/diagram-authoring.md)。没有可信调查结论时，先使用 `investigate-project-architecture`。

1. 从源码、配置、有效测试、运行资料和已生效决定形成实现事实底稿，不直接写顶层架构正文。
2. 判断能力、保证和流程是否适用。无适用价值的内容省略，不创建占位段落；冲突、未知和声明目标保留在待确认事项。
3. 先生成完整的实现参考，再从实现事实中抽象模块设计。先按项目 `docs/architecture/AGENTS.md` 建立可独立审阅的设计层，通过读者检查后再写实现定位；模块设计写清职责、所有权、依赖、失败语义、扩展边界和不负责的内容。
4. 仅从已确认的模块设计提炼架构总览，写清目的、边界、主要责任单元、核心跨模块流程和长期业务约束。先按项目 `docs/architecture/AGENTS.md` 将候选规则分类，只有明确归属于总览的已确认项目业务约束才能进入该章节；不能因为状态账本中的结论属于 `guarantee`，就直接写入顶层。字段、参数、配置、算法、调用链、测试步骤、通用架构原则和实现保障必须下沉。
5. 仅在图形比文字或表格更能降低理解成本时制图。先按读者问题选择视图并建立图组契约，不固定图的数量、工具或配色；每张图声明问题、范围、不表达的内容、节点和边语义、证据、维护方式及下钻入口。超过复杂度预警或混合多个主要问题时拆成一问一答的多张图，并执行跨图一致性和新人理解验收。
6. 执行两遍精简复核：删除填充和重复内容，再检查没有丢失条件、责任、限制、失败和后果。每条事实只保留一个完整负责位置，并建立向下追溯链接；没有合格的长期业务约束时省略该章节，不创建通用原则占位。
7. 建立或更新 `.agents/architecture/state.json`，将每项结论关联到文档层级、文档位置、依据、测试位置和影响路径，状态设为 `candidate`。
8. 运行 `node .agents/architecture-governance-tools/architecture-check.mjs`。已安装文档治理时，再运行 `node .agents/documentation-governance-tools/documentation-check.mjs`。
9. 没有关键待确认事项且所有层级和图表验收通过时，先提交候选架构及状态，再运行 `node .agents/architecture-governance-tools/architecture-workflow.mjs accept --write` 记录当前生效版本，最后提交生效状态。

输出生成的文档、待确认事项和检查结果。命令输出与工作过程保存在工作记录，不写进架构正文。
