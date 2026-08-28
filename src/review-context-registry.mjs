import { createHash } from "node:crypto";
import { createReviewContextLab } from "./review-context-lab.mjs";

function createReviewContextRegistryReader(options = {}) {
  const lab = createReviewContextLab(options);
  async function readOverview() {
    const state = await lab.state();
    const revision = createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 20);
    return { state: "ready", revision, contexts: state.contexts.map(summarize) };
  }
  async function readContext(id, revision) {
    const overview = await readOverview();
    if (revision !== overview.revision) { const error = new Error("复盘上下文已更新，请重新读取列表。"); error.status = 409; throw error; }
    const context = (await lab.state()).contexts.find((item) => item.id === id);
    return context ? { revision, context: detail(context) } : null;
  }
  return { readOverview, readContext };
}

function summarize(context) { return { id: context.id, status: context.status, trigger: context.trigger, task: { text: context.task.text, eventIndex: context.task.eventIndex }, correction: { text: context.correction.text, timestamp: context.correction.timestamp, eventIndex: context.correction.eventIndex }, contextComplete: context.contextComplete, source: context.source }; }
function detail(context) { return { ...summarize(context), priorAssistant: context.priorAssistant, relatedActions: context.relatedActions, source: context.source }; }

export { createReviewContextRegistryReader };