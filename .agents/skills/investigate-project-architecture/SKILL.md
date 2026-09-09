---
name: investigate-project-architecture
description: 调查项目当前架构事实，为生成或维护架构文档准备可追溯的结论。
---

# 调查项目架构

先阅读根 `AGENTS.md`、`docs/architecture/AGENTS.md`、[分层架构文档写作协议](../references/layered-authoring.md)和 `.agents/architecture-workflow.config.json`。已安装文档治理时，再阅读 `.agents/documentation.md` 中的项目负责关系。

1. 确定本次范围、当前提交、已有架构文档和每类内容的唯一负责位置。
2. 阅读代码、配置、有效测试、运行资料和已生效决定。旧文档、目录名、`import` 和函数名只用于定位后续资料。
3. 先建立实现事实底稿。对每个结论记录结论类型、依据文件和可定位文本、负责模块、候选文档层级、唯一文档位置、测试位置及受影响路径；分类和归属按照项目 `docs/architecture/AGENTS.md` 执行。
4. 将结论区分为已确认事实、合理推测、声明目标、冲突和待确认事项，并区分长期业务约束、模块规则、流程约束和专题/协议/运行规则。不要把通用架构原则或实现保障自动提升为顶层长期业务约束，也不要把线索或未实现需求写成当前事实。
5. 待确认事项必须记录影响、需要的资料和后续检查位置。关键事项保留为阻断，不进入生效文档。调查阶段不生成顶层概要，不用目录名、函数名或单次测试结果直接推导设计意图。

输出调查结论和待确认事项，供 `generate-project-architecture` 或 `maintain-project-architecture` 使用。调查本身不宣布架构已生效。
