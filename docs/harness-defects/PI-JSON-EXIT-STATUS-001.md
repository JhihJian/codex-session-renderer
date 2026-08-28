# PI-JSON-EXIT-STATUS-001

## 结论

Pi `0.80.6` 在非交互 JSON 模式中遇到 provider 错误时，会把结构化错误事件写到标准输出，却以退出码 `0` 结束进程。相同请求使用文本 print 模式 `-p` 会以退出码 `1` 结束。

这会使 shell、CI 和其他依赖进程状态的调用方把失败任务当作成功，而 JSON 流内同时已经明确记录了 assistant 的 `stopReason: "error"`。

## 失败谓词

```text
provider 已报告错误后，successful_exit_after_provider_error 的数量必须为 0。
```

该谓词在 fixture 中实现为 `event_count`，只依赖 Pi 实际 JSON 事件和实际子进程退出码，不接受 runner 自报的通过或失败结论。

## 可复现命令

在仓库根目录执行：

```bash
node scripts/harness-defects.mjs replay \
  --fixture examples/harness-fixtures/pi-json-exit-status/fixture.json
```

fixture 启动本机短生命周期 OpenAI-compatible provider，对固定请求返回 HTTP `400`。candidate 与 baseline 使用相同的 Pi 命令、模型、provider、API key、提示词、临时目录和禁用的扩展/skills/context files。唯一变量是输出模式：

| 组别 | 模式 | 预期外行为 |
| --- | --- | --- |
| candidate | `--mode json` | 已观察错误但退出 `0` |
| baseline | `-p` | 已观察错误且退出 `1` |

当前运行时：Pi `0.80.6`。candidate 与 baseline 各连续运行三次。

## 实际结果

本机复现结果：

| 组别 | 三次退出码 | 谓词计数 | 结论 |
| --- | --- | --- | --- |
| candidate | `0, 0, 0` | `1, 1, 1` | 稳定失败 |
| baseline | `1, 1, 1` | `0, 0, 0` | 稳定通过 |

使用 Harness MVP 登记后的实际工件位于本机 `/tmp/harness-real-pi-json-exit-status/registry.json`。其历史线索归档记录为：

- Pi 会话：`019f5ebf-9015-780d-9a2e-6ca69a0890c5`
- 来源文件：`~/.pi/agent/sessions/--data-dev-pi-web-core--/2026-07-14T03-50-40-405Z_019f5ebf-9015-780d-9a2e-6ca69a0890c5.jsonl`
- 逻辑事件：`23`，`message.role = assistant`，`stopReason = error`
- 归档 SHA-256：`493036f8e0fc12e89b2961e0f3417dd4b2e32f11ce09d05458639fddb8dc88e1`

历史会话只提供真实错误线索；确认结论由独立 fixture 的受控对照产生。

## 源码归因

Pi 的 `runPrintMode()` 同时实现 `-p` 和 `--mode json`：

- JSON 分支只订阅并写出事件，没有检查最终 assistant 状态：`dist/modes/print-mode.js:76`。
- 文本分支对最终 `stopReason === "error" || "aborted"` 设置 `exitCode = 1`：`dist/modes/print-mode.js:100`。

因此输出编码改变了同一次非交互运行的进程成功/失败语义。这是 Pi CLI/harness 控制流问题，不是模型生成质量、网络可用性或 fixture 的自定义工具行为问题。

## 独立审查

独立 subagent 在当前机器上重跑 fixture 后给出结论：**承认：是**。其确认范围包括：

- candidate/baseline 的三次稳定运行；
- Pi 版本均为 `0.80.6`；
- 固定本地 HTTP 400 provider 与单变量输出模式；
- 结构化 JSON 错误事件、进程退出码与谓词的对应关系；
- `print-mode.js` 中可定位的遗漏分支。

## 限制

fixture 通过 PATH 查找 `pi` 并记录 `pi --version`，未锁定 npm tarball 哈希。它证明当前安装的 `0.80.6` 行为；跨机器复现时应先核对版本输出。