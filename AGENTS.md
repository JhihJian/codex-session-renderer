<!-- governance-product:project-architecture-governance:start -->
## 架构治理

架构调查、生成、维护、检查和迁移只能使用 [五个架构 Skill](.agents/skills/)。正式架构规则只由 [docs/architecture/AGENTS.md](docs/architecture/AGENTS.md) 维护；状态和影响分析由 `.agents/architecture-workflow.config.json` 配置。

代码、配置、测试或外部边界改变后，运行 `prepare --write` 建立待处理清单，处理每个受影响结论和未归属变更后才可 `accept --write`。`impact` 只用于写入前预览。不要以目录名、旧文档或 import 线索代替可定位的事实依据。

完成架构文档或状态记录修改后，运行：

```sh
node .agents/architecture-governance-tools/architecture-check.mjs
```
<!-- governance-product:project-architecture-governance:end -->
