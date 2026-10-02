import {
  MAX_FOLLOW_UP_CONTEXT_LENGTH,
  buildCurrentPlanFollowUpContext,
} from "./follow-up-context";
import type {
  CodexResultKey,
  CofficeWorkspace,
  VerificationCheckReceipt,
  VerificationTarget,
} from "./coffice-workspace";

const PROFILE_LABELS = {
  test: "Tests",
  typecheck: "Type check",
  lint: "Lint",
  build: "Production build",
} as const;

export type FailedCheckRepairContextResult =
  | { kind: "ready"; text: string; fingerprint: string }
  | {
      kind: "unavailable";
      reason:
        | "no_open_context"
        | "ambiguous_open_context"
        | "target_mismatch"
        | "result_not_current"
        | "no_verification_receipt"
        | "latest_verification_not_failed"
        | "unsupported_verification_profile"
        | "invalid_verification_receipt";
    }
  | { kind: "too_large"; length: number; maxLength: number };

function sameResultKey(left: CodexResultKey, right: CodexResultKey): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function sameTarget(
  left: VerificationTarget,
  right: VerificationTarget,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.objectiveId === right.objectiveId &&
    left.workItemId === right.workItemId &&
    left.attemptId === right.attemptId &&
    sameResultKey(left.resultKey, right.resultKey)
  );
}

function failureLabel(check: VerificationCheckReceipt): string {
  if (check.failureKind === "timeout") return "Timed out";
  if (check.failureKind === "launch") return "Could not start";
  return check.exitCode === undefined
    ? "Failed · project script"
    : `Failed · exit ${check.exitCode}`;
}

function opaqueFingerprint(source: readonly unknown[]): string {
  const input = JSON.stringify(source);
  let first = 0x9e3779b9;
  let second = 0x85ebca6b;
  let third = 0xc2b2ae35;
  let fourth = 0x27d4eb2f;
  for (let index = 0; index < input.length; index += 1) {
    const unit = input.charCodeAt(index);
    first = Math.imul(first ^ unit, 0x85ebca6b);
    second = Math.imul(second ^ unit, 0xc2b2ae35);
    third = Math.imul(third ^ unit, 0x27d4eb2f);
    fourth = Math.imul(fourth ^ unit, 0x165667b1);
  }
  first = Math.imul(first ^ (first >>> 16), 0x85ebca6b) ^ second;
  second = Math.imul(second ^ (second >>> 13), 0xc2b2ae35) ^ third;
  third = Math.imul(third ^ (third >>> 16), 0x85ebca6b) ^ fourth;
  fourth = Math.imul(fourth ^ (fourth >>> 13), 0xc2b2ae35) ^ first;
  return `repair-v1-${[first, second, third, fourth]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("")}`;
}

/**
 * Builds a non-truncated repair draft for the latest failed fixed-profile
 * verification of one current exact result. Only Coffice plan fields and the
 * receipt's bounded structural outcome participate; private execution content
 * and opaque identities never appear in the returned text.
 */
export function buildFailedCheckRepairFollowUpContext(
  workspace: CofficeWorkspace | null,
  taskId: string,
  target: VerificationTarget,
): FailedCheckRepairContextResult {
  const plan = buildCurrentPlanFollowUpContext(workspace, taskId);
  if (plan.kind === "unavailable") return plan;

  const openContexts = [];
  for (const project of workspace?.projects ?? []) {
    for (const objective of project.objectives) {
      for (const workItem of objective.workItems) {
        for (const attempt of workItem.attempts) {
          if (
            attempt.codexTaskId === taskId &&
            attempt.unlinkedAt === undefined
          ) {
            openContexts.push({ project, objective, workItem, attempt });
          }
        }
      }
    }
  }
  const context = openContexts[0];
  if (
    !context ||
    context.project.id !== target.projectId ||
    context.objective.id !== target.objectiveId ||
    context.workItem.id !== target.workItemId ||
    context.attempt.id !== target.attemptId
  ) {
    return { kind: "unavailable", reason: "target_mismatch" };
  }
  const currentResult = context.attempt.resultCycles.at(-1);
  if (!currentResult || !sameResultKey(currentResult.key, target.resultKey)) {
    return { kind: "unavailable", reason: "result_not_current" };
  }

  const exactReceipts = (workspace?.verificationReceipts ?? []).filter(
    (receipt) => sameTarget(receipt.target, target),
  );
  const receipt = exactReceipts.at(-1);
  if (!receipt) {
    return { kind: "unavailable", reason: "no_verification_receipt" };
  }
  if (receipt.state !== "failed") {
    return {
      kind: "unavailable",
      reason: "latest_verification_not_failed",
    };
  }
  const profileLabel =
    PROFILE_LABELS[receipt.profile.id as keyof typeof PROFILE_LABELS];
  if (!profileLabel) {
    return {
      kind: "unavailable",
      reason: "unsupported_verification_profile",
    };
  }
  const check = receipt.checks[0];
  if (
    receipt.checks.length !== 1 ||
    !check ||
    check.id !== receipt.profile.id ||
    check.version !== receipt.profile.version ||
    check.state !== "failed" ||
    !check.failureKind
  ) {
    return { kind: "unavailable", reason: "invalid_verification_receipt" };
  }
  if (plan.kind === "too_large") return plan;

  const planBody = plan.text.replace(
    /^Coffice plan context copied for review\n\n/u,
    "",
  );
  const text = [
    "Coffice repair follow-up copied for review",
    "",
    planBody,
    "",
    `Failed quality check: ${profileLabel}`,
    `Observed outcome: ${failureLabel(check)}`,
    "",
    `Please diagnose and repair the cause of this failed quality check. Rerun the same ${profileLabel} check after the repair, then report the outcome and any remaining risks.`,
  ].join("\n");
  if (text.length > MAX_FOLLOW_UP_CONTEXT_LENGTH) {
    return {
      kind: "too_large",
      length: text.length,
      maxLength: MAX_FOLLOW_UP_CONTEXT_LENGTH,
    };
  }
  return {
    kind: "ready",
    text,
    // This deterministic digest is only a session comparison key. Every source
    // dimension remains bound without exposing identity or plan text if the
    // result is serialized by diagnostics or development tooling.
    fingerprint: opaqueFingerprint([
      taskId,
      target.projectId,
      target.objectiveId,
      target.workItemId,
      target.attemptId,
      target.resultKey.kind,
      target.resultKey.id,
      receipt.id,
      receipt.profile.id,
      receipt.profile.version,
      check.id,
      check.version,
      check.state,
      check.failureKind,
      check.exitCode ?? null,
      plan.text,
    ]),
  };
}
