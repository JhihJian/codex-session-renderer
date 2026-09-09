---
name: migrate-project-architecture
description: 将旧架构地图和旧架构文档迁移为 docs/architecture 下的当前架构文档。
---

# 迁移项目架构文档

先阅读 `docs/architecture/AGENTS.md`。旧资料只是待重新确认的声明，不是当前事实依据。

1. 检查旧架构地图、旧架构文档和并行决定目录，列出迁移来源与目标位置。
2. 存在 `.agents/architecture-map.config.json` 时，运行 `node .agents/architecture-governance-tools/architecture-workflow.mjs migrate --write`，生成候选状态。
3. 使用 `investigate-project-architecture` 重新确认旧资料中的每项结论，再使用 `generate-project-architecture` 写入 `docs/architecture/`。
4. 将仍有价值的决定迁入项目已有的决定负责位置；已安装决定治理时迁入对应 Agent Note。旧位置改为简短说明和链接，确认新位置成为唯一正式来源后再删除旧正文。
5. 运行 `check-project-architecture` 并在无关键待确认事项后生效。
