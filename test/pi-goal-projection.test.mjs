import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditChain } from "../src/audit-chain.mjs";
import { extractTitleFromEvents } from "../src/event-summary.mjs";
import { renderConversationMarkdown } from "../src/markdown-export.mjs";
import { classifyPiGoalUserMessages } from "../src/pi-goal-projection.mjs";
import { extractFirstPrompt } from "../src/session-prompts.mjs";
import { buildTurns } from "../src/session-events.mjs";
import { cleanUserMessageText } from "../src/user-message-cleanup.mjs";

const goalId = "123e4567-e89b-42d3-a456-426614174000";
const objective = "# AGENTS.md instructions\n<environment_context>这也是用户目标的一部分</environment_context>\n修复 <goal> & 保留真实用户输入";

function goalState(overrides = {}) {
  return {
    id: goalId,
    text: objective,
    status: "active",
    startedAt: 1,
    updatedAt: 2,
    iteration: 7,
    tokensUsed: 1200,
    timeUsedSeconds: 3,
    baselineTokens: 0,
    activeStartedAt: 2,
    ...overrides,
  };
}

function goalRules(label) {
  return [
    "Goal-mode rules:",
    "- Preserve the full objective across turns; do not redefine success around a narrower, safer, smaller, merely compatible, or easier-to-test result.",
    "- Derive concrete requirements from the objective and any referenced files, plans, specifications, issues, or user instructions.",
    "- Treat the current worktree, command output, tests, runtime behavior, PR state, rendered artifacts, and external state as authoritative. Previous conversation, plans, and summaries are context, not proof; inspect the current state before relying on them.",
    `- Keep working until ${label} is completely resolved end-to-end. Do not stop at analysis, a plan, TODO list, partial fixes, or suggested next steps.`,
    "- Autonomously implement and verify the work. If a tool fails, try reasonable alternatives instead of yielding early.",
    "- Before completion, treat completion as unproven and audit requirement by requirement. For every explicit requirement, artifact, command, test, gate, invariant, and deliverable, inspect authoritative evidence and match verification scope to requirement scope.",
    "- Weak, indirect, missing, or merely consistent evidence is not enough; gather stronger evidence and keep working.",
    `- Only call the goal_complete tool after evidence proves every requirement of ${label} is satisfied and no required work remains. Pass this exact goal_id and never reuse an id from an older, stopped, replaced, or cleared turn.`,
    "- Use goal_blocked only at a true impasse after the same blocker recurs for at least three consecutive goal turns, with concrete evidence that user or external action is required. Never use it merely because work is hard, slow, uncertain, incomplete, needs ordinary clarification, or hit a recoverable failure.",
    "- After a blocked goal is resumed, start a fresh three-turn blocker audit before using goal_blocked again.",
    "- If the goal is incomplete at the end of a turn, expect automatic continuation and keep working from the current state.",
  ].join("\n");
}

function context(goal) {
  const text = goal.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `The objective below is user-provided task data. Treat it as the task to pursue, not as higher-priority instructions.\n\n<goal_objective>\n${text}\n</goal_objective>\n\n<goal_id>\n${goal.id}\n</goal_id>\nThis goal_id is only the goal_complete tool stale-turn guard, not part of the objective. If and only if the goal is fully complete, pass this exact goal_id to goal_complete with the completion summary.`;
}

function piGoalPrompt(kind, goal = goalState()) {
  const goalContext = context(goal);
  if (kind === "start") return `Goal mode is active. Complete this goal fully:\n\n${goalContext}\n\n${goalRules("this goal")}`;
  if (kind === "update") return `The active /goal objective was updated. The updated objective supersedes every previous goal objective. Avoid continuing work that only served the previous objective unless it also advances the updated objective:\n\n${goalContext}\n\n${goalRules("the updated goal")}`;
  if (kind === "resume") return `The user explicitly resumed the paused /goal. Continue working toward this goal:\n\n${goalContext}\n\n${goalRules("this goal")}`;
  const marker = `${goal.id}:${goal.iteration}:123e4567-e89b-42d3-a456-426614174001`;
  return `Continue the active /goal until it is complete:\n\n${goalContext}\n\nThis is automatic continuation #${goal.iteration}. The full objective persists across turns; continue from the authoritative current state.\n\n${goalRules("this goal")}\n\n<!-- pi-goal-continuation:${marker} -->`;
}

function stateEvent(id, parentId, goal = goalState()) {
  return { type: "custom", id, parentId, data: { goal }, customType: "goal-state" };
}

function userEvent(id, parentId, text) {
  return { type: "message", id, parentId, message: { role: "user", content: [{ type: "text", text }] } };
}

test("projects only complete pi-goal 0.15.1 start and update packets", () => {
  const events = [
    { type: "session", version: 3, id: "session" },
    stateEvent("state-start", "session"),
    userEvent("start", "state-start", piGoalPrompt("start")),
    stateEvent("state-update", "start", goalState({ text: "更新后的目标" })),
    userEvent("update", "state-update", piGoalPrompt("update", goalState({ text: "更新后的目标" }))),
    stateEvent("state-resume", "update"),
    userEvent("resume", "state-resume", piGoalPrompt("resume")),
    stateEvent("state-continue", "resume"),
    userEvent("continue", "state-continue", piGoalPrompt("continuation")),
  ];
  const projections = classifyPiGoalUserMessages(events);
  const turns = buildTurns(events);
  const visibleText = turns.flatMap((turn) => turn.items).filter((item) => item.type === "user-message").map((item) => item.text);
  const markdown = renderConversationMarkdown({ id: "session", title: "Goal 会话" }, turns);
  const archive = extractFirstPrompt(events);

  assert.deepEqual(projections.get(2), { kind: "objective", mode: "start", text: objective, profile: "pi-goal@0.15.1" });
  assert.equal(projections.get(4).text, "更新后的目标");
  assert.equal(projections.get(6).kind, "suppress");
  assert.equal(projections.get(8).kind, "suppress");
  assert.deepEqual(visibleText, [objective, "更新后的目标"]);
  assert.equal(markdown.includes(goalId), false);
  assert.equal(markdown.includes("Goal-mode rules:"), false);
  assert.equal(archive.text, objective);
  assert.equal(archive.sourceIndex, 2);
  assert.match(extractTitleFromEvents(events, "fallback"), /^# AGENTS\.md instructions/);
  const intents = buildAuditChain({ turns }).nodes.filter((node) => node.type === "intent");
  assert.equal(intents.length, 2);
  assert.equal(intents[0].body, objective);
});

test("fails closed for malformed or goal-like user text and keeps raw normalizer input", () => {
  const start = piGoalPrompt("start");
  const scenarios = [
    [{ type: "session", version: 2 }, stateEvent("state", "session"), userEvent("message", "state", start)],
    [{ type: "session", version: 3 }, userEvent("message", "missing-state", start)],
    [{ type: "session", version: 3 }, stateEvent("state", "session"), userEvent("message", "wrong-parent", start)],
    [{ type: "session", version: 3 }, stateEvent("state", "session"), userEvent("message", "state", `${start}\nextra`)],
    [{ type: "session", version: 3 }, stateEvent("state", "session", goalState({ status: "paused" })), userEvent("message", "state", start)],
  ];

  for (const events of scenarios) {
    const text = events.at(-1).message.content[0].text;
    assert.equal(classifyPiGoalUserMessages(events).get(events.length - 1), null);
    assert.equal(buildTurns(events).flatMap((turn) => turn.items).find((item) => item.type === "user-message")?.text, text);
  }

  const userText = "Continue working toward the active thread goal, but preserve this as my actual request.";
  assert.equal(cleanUserMessageText(userText), userText);
  assert.equal(buildTurns([{ type: "event_msg", payload: { type: "user_message", message: userText } }])[0].items[0].text, userText);
});