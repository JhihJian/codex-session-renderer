const decisionRuleVersion = "harness-verification-v1";

function decideVerification(input = {}) {
  const epochs = Array.isArray(input.epochs) ? input.epochs : [];
  const reviews = Array.isArray(input.reviews) ? input.reviews : [];
  const required = ["sourceHash", "contractRef", "predicateHash", "fixtureHash", "runtimeHash"];
  if (required.some((key) => !text(input[key]))) return decision("inconclusive", "missing_frozen_manifest");
  if (epochs.length !== 2 || new Set(epochs.map((epoch) => epoch.id)).size !== 2) return decision("inconclusive", "independent_epochs_required");
  if (epochs.some((epoch) => epoch.sandboxReceipt?.enforced !== true)) return decision("blocked", "verifiable_sandbox_required");
  if (epochs.some((epoch) => !stableContrast(epoch))) return decision("inconclusive", "stable_contrast_required");
  const artifacts = epochs.flatMap((epoch) => epoch.runs.flatMap((run) => run.artifactHash || []));
  if (artifacts.length !== 12 || new Set(artifacts).size !== artifacts.length) return decision("inconclusive", "independent_artifacts_required");
  if (reviews.some((review) => review.decision === "reject")) return decision("inconclusive", "blind_review_rejected");
  if (!reviews.some((review) => review.decision === "accept" && review.blind === true && review.recomputedPredicate === true)) return decision("inconclusive", "blind_review_required");
  return decision("confirmed", "all_confirmation_gates_passed");
}

function stableContrast(epoch) {
  if (!Array.isArray(epoch.runs) || epoch.runs.length !== 6) return false;
  const candidate = epoch.runs.filter((run) => run.variant === "candidate");
  const baseline = epoch.runs.filter((run) => run.variant === "baseline");
  return candidate.length === 3 && baseline.length === 3 && candidate.every((run) => run.failed === true && text(run.artifactHash)) && baseline.every((run) => run.failed === false && text(run.artifactHash));
}
function decision(status, reason) { return { status, reason, decisionRuleVersion }; }
function text(value) { return typeof value === "string" && value.trim(); }

export { decideVerification, decisionRuleVersion };