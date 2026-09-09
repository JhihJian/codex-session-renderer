---
name: check-project-architecture
description: 只读检查项目架构文档、依据、待确认事项和生效版本。
---

# 检查项目架构文档

先阅读 `docs/architecture/AGENTS.md`、[分层架构文档写作协议](../references/layered-authoring.md)和[架构图编写协议](../references/diagram-authoring.md)。本 Skill 不修改架构文档、状态记录或业务实现。

1. 运行统一只读入口 `node .agents/architecture-governance-tools/architecture-check.mjs`。
2. 已安装文档治理时，运行 `node .agents/documentation-governance-tools/documentation-check.mjs`。
3. 发布前、重大依赖升级后或长期未确认时，运行 `node .agents/architecture-governance-tools/architecture-workflow.mjs audit`。
4. 先按项目 `docs/architecture/AGENTS.md` 对模块设计执行不依赖源码的读者检查，再语义检查总览、模块设计和实现参考是否层级混杂，是否存在填充段落、重复事实、无适用条目、将通用原则或实现保障写入长期业务约束、缺少向下追溯或未保留失败后果。
5. 语义检查图表是否一图一问、范围明确、节点代表责任单元、边具有明确动词和方向、关键关系有证据、图例完整，且没有把实现全集堆进顶层图；图组还要检查阅读顺序、复杂度预警、跨图名称/所有权一致和当前态/目标态分离。
6. 报告当前状态、生效提交、失效文件、关键待确认事项和未处理的变更影响。检查失败时只说明修复条件，不将失败说成架构已经生效。
