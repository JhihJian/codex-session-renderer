const sessionId = "33333333-3333-4333-8333-333333333333";
const sessionTitle = "确定性 Chromium 验证会话";
const sessionEvents = [
  {
    timestamp: "2025-01-02T03:04:05.000Z",
    type: "session_meta",
    payload: {
      cwd: "/workspace/chromium-contract",
      originator: "codex_cli",
      model: "gpt-5",
    },
  },
  {
    timestamp: "2025-01-02T03:04:06.000Z",
    type: "event_msg",
    payload: { type: "task_started", turn_id: "e2e-turn" },
  },
  {
    timestamp: "2025-01-02T03:04:07.000Z",
    type: "event_msg",
    payload: { type: "user_message", message: "验证工作台的 Chromium 交互契约" },
  },
  {
    timestamp: "2025-01-02T03:04:08.000Z",
    type: "event_msg",
    payload: { type: "agent_message", message: "已使用固定隔离样本加载工作台。" },
  },
  {
    timestamp: "2025-01-02T03:04:09.000Z",
    type: "response_item",
    payload: { type: "function_call", name: "exec_command", call_id: "e2e-check", arguments: "{\"cmd\":\"npm test\"}" },
  },
  {
    timestamp: "2025-01-02T03:04:10.000Z",
    type: "response_item",
    payload: { type: "function_call_output", call_id: "e2e-check", output: "tests 1\npass 1\nfail 0" },
  },
  {
    timestamp: "2025-01-02T03:04:11.000Z",
    type: "event_msg",
    payload: { type: "task_complete", last_agent_message: "验证完成。" },
  },
];

export { sessionEvents, sessionId, sessionTitle };