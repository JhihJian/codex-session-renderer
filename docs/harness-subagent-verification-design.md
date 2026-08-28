# Harness Subagent 验证闭环设计

## 目标

将 Pi 历史会话中的结构性异常转化为可审计、可独立复核的 Agent Harness 缺陷。系统不因错误文本、单次复现或 subagent 的自然语言认可而确认缺陷；`confirmed` 只能由确定性决策器根据冻结证据、受控执行和独立验证回执写入。

本设计替换当前“候选 -> fixture -> 三次 candidate/baseline -> confirmed/rejected”的确认边界，不替换已有会话浏览、JSONL 归档或 Harness 页面。

## 现状与缺口

当前 MVP 已具备归档、候选、fixture、三次对照、登记簿和只读页面。但下列能力不足以支撑批量治理：

- fixture runner 同时控制被测调用、trace 生成和结果呈现；
- `comparison` 可由调用方直接写入登记簿；
- runner 继承宿主环境，不是可信执行环境；
- 复核可能读取候选作者的结论，不能计为独立验证；
- `confirmed` 在独立验证前生成；
- 相同 trace 的多次解释无法与独立执行区分。

现有 `PI-JSON-EXIT-STATUS-001` 保留为真实已复现缺陷和迁移样本。它进入新流程后必须重新冻结证据并取得独立 epoch 的回执，不能仅迁移旧状态。

## 核心原则

1. **候选不是缺陷。** 发现器只描述观察、来源与规则命中。
2. **规范先于对照。** 失败谓词 `F` 必须引用可审计的 CLI、协议、状态机或公开行为契约；baseline 仅提供反事实控制。
3. **原始产物优先。** 退出码、信号、stdout/stderr、事件流、文件副作用和 runtime 摘要由可信执行器采集；runner 不提供通过/失败布尔值。
4. **验证必须独立。** 盲审 subagent 不接收上游结论，独立 epoch 的执行产物必须拥有不同 `runId` 和哈希。
5. **只有控制器写终态。** agent 只能提交结构化候选、断言、fixture 或审查意见。
6. **无法验证不是驳回。** 缺少沙箱、基线、契约或稳定结果时进入 `blocked` 或 `inconclusive`。

## 状态机

```text
candidate
  -> evidence_ready
  -> assertion_ready
  -> fixture_ready
  -> reproduced
  -> independently_replicated
  -> confirmed

任意阶段可转：blocked | inconclusive
已形成反证可转：rejected
```

终态不可原地覆盖。新的检测规则、fixture 或 runtime 必须创建关联 revision，并使用 `supersedes` 指向旧候选。

| 状态 | 进入条件 | 退出条件 |
| --- | --- | --- |
| `candidate` | 检测规则命中冻结会话 | 证据整理完成 |
| `evidence_ready` | 来源哈希、事件坐标和反证范围完整 | 断言可表达或不可表达 |
| `assertion_ready` | `F` 与契约引用均已冻结 | fixture 清单可构建 |
| `fixture_ready` | fixture/runtime/谓词求值器均有哈希 | 可信执行完成 |
| `reproduced` | 首个 sandbox epoch 满足稳定运行条件 | 盲审与第二 epoch 完成 |
| `independently_replicated` | 盲审接受，第二 epoch 结果一致 | 决策器裁决 |
| `confirmed` | 全部确认门槛满足 | 终态 |
| `rejected` | 反证已证明候选不成立 | 终态 |
| `blocked` | 缺少安全执行条件或外部依赖 | 补齐条件后重试 |
| `inconclusive` | 运行不稳定、验证冲突或契约不足 | 新 revision 或人工裁决 |

## 组件边界

```text
会话快照 -> 发现器 -> 证据冻结器 -> 断言 agent -> fixture agent
                                            |             |
                                            v             v
                                      证据账本 <- 可信执行器 <- sandbox adapter
                                            |             |
                                            v             v
                                      盲审 subagent <- 独立执行 epoch
                                            |
                                            v
                                      决策引擎 -> 登记簿投影 -> 只读页面
```

### 会话发现器

输入是稳定 JSONL 快照和版本化规则，输出仅为候选草案：

```json
{
  "detectorId": "provider-error-exit-status",
  "detectorVersion": "2",
  "sourceSha256": "...",
  "eventCoordinate": { "logicalIndex": 23 },
  "observation": "...",
  "dedupeKey": "sha256(source,detector,version)"
}
```

首批规则仅覆盖重复 tool call、缺失 tool result、异常退出码、取消后执行与上下文投影不变量。`provider-error-exit-status` 是会话级待验证线索：仅在终态 assistant 为 `error` 时产生一条候选，并明确归档未提供非交互进程退出码。它不是已确认的退出码异常。其他事件级规则仍以事件坐标去重。文本风险词只用于排序，不能产生 `evidence_ready`。

### 证据冻结器

为候选生成只读证据包：原始 JSONL 字节哈希、事件区间、事件坐标、规则版本、候选描述、反证事件范围和来源 manifest。证据包生成后不可修改。

### 断言 agent

输入为冻结证据包和允许引用的契约库。输出必须是结构化断言：

```json
{
  "contractRef": "pi-cli-print-mode-exit-status-v1",
  "predicate": {
    "id": "nonzero_exit_after_provider_error",
    "evaluator": "event-count-v1",
    "input": "trusted-execution-artifacts",
    "expected": 0
  },
  "machineDecidable": true
}
```

无法表达为机器断言时输出 `machineDecidable: false`，控制器转为 `inconclusive`。

### Fixture agent

输入为断言和批准的 runtime 模板。输出 fixture tree manifest，不直接运行：fixture 文件哈希、谓词求值器哈希、provider/tool stub 声明、candidate/baseline argv、依赖锁文件和 runtime 二进制摘要。

fixture agent 的写入范围仅限任务目录。它不能读取真实会话目录、宿主 HOME、登记簿或网络凭据。

### 可信执行器

可信执行器不是 subagent。它读取冻结 manifest，以新 sandbox epoch 运行 candidate/baseline 各三次，捕获：

- argv、runtime 二进制 SHA-256 与版本；
- 清洗后的环境变量白名单；
- 退出码、信号、stdout/stderr 限长摘要；
- 原始 JSON event stream；
- 文件写入清单、网络策略回执、资源统计；
- 每次运行的 artifact SHA-256。

谓词求值器在 runner 之外，从上述原始产物计算 `F`。执行器输出 `runId`、`evidenceId` 与原始 artifact 引用，不能写 `confirmed`。

### 盲审 subagent

盲审输入不含候选作者的结论、初始 fixture agent 说明、旧审查文本和状态。它只能看到冻结契约、谓词、原始执行产物和哈希清单，并独立重算 `F`。

输出为 `accept`、`reject` 或 `inconclusive`，附证据引用。若需要“独立验证”标签，控制器必须请求另一 sandbox epoch 的重跑，不能把对同一 trace 的第二次阅读计为独立证据。

## Sandbox 契约

可信执行器必须提供可验证的 sandbox policy：

- 无宿主 `HOME`、凭据、SSH agent、全局 Pi 配置和真实会话目录；
- fixture 只读，任务输出仅写入临时层；
- 默认无网络，仅允许 manifest 显式声明的 loopback provider；
- 固定 argv 与二进制哈希，不接受 shell 字符串；
- wall-clock、CPU、内存、PID、文件数、输出字节数限制；
- 超时杀死整个进程组，保存超时证据并转 `inconclusive`；
- 路径逃逸、符号链接、未声明二进制或网络策略失败均转 `blocked`。

没有可证明 sandbox 的环境，自动流程不得运行，只能停在 `blocked`。

## 证据账本与投影

新增追加式 `ledger.jsonl` 作为事实源。每条记录包含：

```text
entryId, previousHash, payloadHash, timestamp, actor,
candidateId, stateTransition, policyVersion,
evidenceIds, parentEvidenceIds, sandboxPolicyDigest
```

`registry.json` 变为由账本重建的查询投影。启动或审计时发现哈希断链、投影不一致、未知状态转换时失败关闭。相同原始产物哈希只能计为一次执行证据，多次解释只记录为 `reviewed`。

## 决策规则

非 LLM 决策引擎仅在下列条件全部成立时转 `confirmed`：

1. 候选来源、契约、谓词、fixture 和 runtime 均已冻结并有哈希；
2. 两个不重叠 sandbox epoch 均执行 candidate/baseline 各三次；
3. 两个 epoch 中 candidate 稳定触发 `F`，baseline 稳定不触发 `F`；
4. 盲审 subagent 接受并独立重算 `F`；
5. 证据去重器确认执行产物、epoch 与审查输入不重叠；
6. 没有 `reject` 或冲突的盲审回执。

基线同样违反契约、或原始证据反证候选时转 `rejected`。执行失败、环境漂移、结果不稳定、契约不足或验证冲突转 `inconclusive`，不写入 `rejected`。

## API 与页面

页面和 API 保持只读。新增投影字段：状态时间线、规则版本、契约引用、fixture/runtime/sandbox 哈希、epoch/run/evidence ID、盲审结论、原因码与决策规则版本。

页面不得执行 subagent、fixture 或写登记簿。CLI 仅提供显式 `scan`、`dispatch`、`ingest-agent-result`、`verify`、`decide`、`replay`、`audit` 和人工裁决命令。

## 验收

- 相同会话和规则重复扫描不创建重复候选；
- 每个 `confirmed` 可追溯到两个独立 epoch 的原始产物；
- 删除任何必需证据、契约或 sandbox 回执后，决策器拒绝确认；
- subagent 伪造布尔结果、trace 或状态时不能绕过可信执行器；
- 无 sandbox、超时、验证冲突均可见地进入 `blocked` 或 `inconclusive`；
- API 与页面不暴露绝对路径、凭据或执行入口；
- 账本可重建投影，断链或篡改被检测到。