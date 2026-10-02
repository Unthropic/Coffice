import {
  selectReviewAssessment,
  type CofficeWorkspace,
  type CodexResultCycle,
  type ResultDecisionKind,
  type ResultReviewAssessmentTarget,
  type ReviewNextActionKind,
  type VerificationFailureKind,
  type VerificationReceipt,
  type VerificationState,
} from "./coffice-workspace";

const FIXED_PROFILE_LABELS = {
  test: "Tests",
  typecheck: "Type check",
  lint: "Lint",
  build: "Production build",
} as const;

export interface SavedResultAssessmentPresentation {
  updatedAt: string;
  summaryRecorded: boolean;
  riskCount: number;
  uncertaintyCount: number;
  blockedDecisionCount: number;
  recordedNextAction?: ReviewNextActionKind;
}

export interface SavedResultReviewPresentation {
  reviewedAt: string;
  decision?: {
    kind: ResultDecisionKind;
    decidedAt: string;
  };
}

export type SavedResultVerificationCheckCounts = Readonly<
  Record<VerificationState, number>
>;

export type SavedResultVerificationFailureCounts = Readonly<
  Record<VerificationFailureKind, number>
>;

export interface SavedResultVerificationPresentation {
  label: "Newest retained quality check";
  profileLabel:
    | (typeof FIXED_PROFILE_LABELS)[keyof typeof FIXED_PROFILE_LABELS]
    | "Saved quality check";
  state: VerificationState;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  checkCounts: SavedResultVerificationCheckCounts;
  failureCounts: SavedResultVerificationFailureCounts;
}

export interface SavedResultEvidencePresentation {
  role: "reference" | "alternative";
  attemptNumber: number;
  resultNumber: number;
  observedAt: string;
  assessment?: SavedResultAssessmentPresentation;
  review?: SavedResultReviewPresentation;
  verification?: SavedResultVerificationPresentation;
}

/** Exact local-only structural binding. Never render or persist this value. */
export interface SavedResultEvidenceBinding {
  target: ResultReviewAssessmentTarget;
}

export interface BoundSavedResultEvidence {
  binding: SavedResultEvidenceBinding;
  presentation: SavedResultEvidencePresentation;
}

export interface SavedResultComparison {
  reference: BoundSavedResultEvidence;
  alternatives: readonly BoundSavedResultEvidence[];
}

export interface SavedResultComparisonPair {
  reference: BoundSavedResultEvidence;
  alternative: BoundSavedResultEvidence;
}

function sameResultKey(
  left: ResultReviewAssessmentTarget["resultKey"],
  right: ResultReviewAssessmentTarget["resultKey"],
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function sameVerificationTarget(
  receipt: VerificationReceipt,
  target: ResultReviewAssessmentTarget,
): boolean {
  return (
    receipt.target.projectId === target.projectId &&
    receipt.target.objectiveId === target.objectiveId &&
    receipt.target.workItemId === target.workItemId &&
    receipt.target.attemptId === target.attemptId &&
    sameResultKey(receipt.target.resultKey, target.resultKey)
  );
}

function lastRetainedExactVerificationReceipt(
  receipts: readonly VerificationReceipt[],
  target: ResultReviewAssessmentTarget,
): VerificationReceipt | undefined {
  return receipts.findLast((receipt) =>
    sameVerificationTarget(receipt, target),
  );
}

function verificationCheckCounts(
  receipt: VerificationReceipt,
): SavedResultVerificationCheckCounts {
  const counts: Record<VerificationState, number> = {
    queued: 0,
    running: 0,
    passed: 0,
    failed: 0,
    unknown: 0,
  };
  for (const check of receipt.checks) counts[check.state] += 1;
  return counts;
}

function verificationFailureCounts(
  receipt: VerificationReceipt,
): SavedResultVerificationFailureCounts {
  const counts: Record<VerificationFailureKind, number> = {
    exit: 0,
    timeout: 0,
    launch: 0,
  };
  for (const check of receipt.checks) {
    if (check.failureKind) counts[check.failureKind] += 1;
  }
  return counts;
}

function verificationProfileLabel(
  receipt: VerificationReceipt,
): SavedResultVerificationPresentation["profileLabel"] {
  if (receipt.profile.version !== "1") return "Saved quality check";
  return (
    FIXED_PROFILE_LABELS[
      receipt.profile.id as keyof typeof FIXED_PROFILE_LABELS
    ] ?? "Saved quality check"
  );
}

function presentResult(
  workspace: CofficeWorkspace,
  target: ResultReviewAssessmentTarget,
  result: CodexResultCycle,
  role: SavedResultEvidencePresentation["role"],
  attemptNumber: number,
  resultNumber: number,
): SavedResultEvidencePresentation {
  const assessment = selectReviewAssessment(
    workspace.reviewAssessments,
    target,
  );
  const receipt = lastRetainedExactVerificationReceipt(
    workspace.verificationReceipts,
    target,
  );

  return {
    role,
    attemptNumber,
    resultNumber,
    observedAt: result.observedAt,
    ...(assessment
      ? {
          assessment: {
            updatedAt: assessment.updatedAt,
            summaryRecorded: assessment.reviewSummary !== undefined,
            riskCount: assessment.risks.length,
            uncertaintyCount: assessment.uncertainties.length,
            blockedDecisionCount: assessment.blockedDecisions.length,
            ...(assessment.nextAction
              ? { recordedNextAction: assessment.nextAction.kind }
              : {}),
          },
        }
      : {}),
    ...(result.review
      ? {
          review: {
            reviewedAt: result.review.reviewedAt,
            ...(result.review.decision
              ? {
                  decision: {
                    kind: result.review.decision.kind,
                    decidedAt: result.review.decision.decidedAt,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(receipt
      ? {
          verification: {
            label: "Newest retained quality check",
            profileLabel: verificationProfileLabel(receipt),
            state: receipt.state,
            queuedAt: receipt.queuedAt,
            ...(receipt.startedAt ? { startedAt: receipt.startedAt } : {}),
            ...(receipt.completedAt
              ? { completedAt: receipt.completedAt }
              : {}),
            checkCounts: verificationCheckCounts(receipt),
            failureCounts: verificationFailureCounts(receipt),
          },
        }
      : {}),
  };
}

function hasResultEvidence(result: SavedResultEvidencePresentation): boolean {
  return Boolean(result.assessment || result.review || result.verification);
}

function bindResult(
  target: ResultReviewAssessmentTarget,
  presentation: SavedResultEvidencePresentation,
): BoundSavedResultEvidence {
  return {
    binding: {
      target: {
        projectId: target.projectId,
        objectiveId: target.objectiveId,
        workItemId: target.workItemId,
        attemptId: target.attemptId,
        resultKey: { ...target.resultKey },
      },
    },
    presentation,
  };
}

function sameResultTarget(
  left: ResultReviewAssessmentTarget,
  right: ResultReviewAssessmentTarget,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.objectiveId === right.objectiveId &&
    left.workItemId === right.workItemId &&
    left.attemptId === right.attemptId &&
    sameResultKey(left.resultKey, right.resultKey)
  );
}

/**
 * Selects evidence for one exact durable reference result and the latest
 * durable result from each alternative attempt under the same exact work item.
 * Alternative attempts remain in canonical saved order; this selector never
 * scores, ranks, or recommends a result. Exact structural bindings are returned
 * separately for local UI identity and invalidation; identifiers and authored
 * content are deliberately absent from each presentation.
 */
export function selectSavedResultComparison(
  workspace: CofficeWorkspace | null,
  referenceTarget: ResultReviewAssessmentTarget,
): SavedResultComparison | null {
  if (!workspace) return null;

  const workItem = workspace.projects
    .find((project) => project.id === referenceTarget.projectId)
    ?.objectives.find(
      (objective) => objective.id === referenceTarget.objectiveId,
    )
    ?.workItems.find((item) => item.id === referenceTarget.workItemId);
  if (!workItem) return null;

  const referenceAttemptIndex = workItem.attempts.findIndex(
    (attempt) => attempt.id === referenceTarget.attemptId,
  );
  if (referenceAttemptIndex < 0) return null;

  const referenceAttempt = workItem.attempts[referenceAttemptIndex]!;
  const referenceResultIndex = referenceAttempt.resultCycles.findIndex(
    (result) => sameResultKey(result.key, referenceTarget.resultKey),
  );
  if (referenceResultIndex < 0) return null;

  const referencePresentation = presentResult(
    workspace,
    referenceTarget,
    referenceAttempt.resultCycles[referenceResultIndex]!,
    "reference",
    referenceAttemptIndex + 1,
    referenceResultIndex + 1,
  );
  const referenceHasEvidence = hasResultEvidence(referencePresentation);
  const alternatives: BoundSavedResultEvidence[] = [];

  workItem.attempts.forEach((attempt, attemptIndex) => {
    if (
      attemptIndex === referenceAttemptIndex ||
      attempt.relationship !== "alternative"
    ) {
      return;
    }
    const result = attempt.resultCycles.at(-1);
    if (!result) return;

    const alternativeTarget: ResultReviewAssessmentTarget = {
      projectId: referenceTarget.projectId,
      objectiveId: referenceTarget.objectiveId,
      workItemId: referenceTarget.workItemId,
      attemptId: attempt.id,
      resultKey: result.key,
    };
    const alternativePresentation = presentResult(
      workspace,
      alternativeTarget,
      result,
      "alternative",
      attemptIndex + 1,
      attempt.resultCycles.length,
    );
    if (referenceHasEvidence || hasResultEvidence(alternativePresentation)) {
      alternatives.push(bindResult(alternativeTarget, alternativePresentation));
    }
  });

  return {
    reference: bindResult(referenceTarget, referencePresentation),
    alternatives,
  };
}

/**
 * Resolves one fresh side-by-side pair by an exact local-only binding. Callers
 * rerun this selector after workspace changes; a superseded, removed, or newly
 * ineligible candidate resolves to null rather than silently selecting another
 * result.
 */
export function selectSavedResultComparisonPair(
  workspace: CofficeWorkspace | null,
  referenceTarget: ResultReviewAssessmentTarget,
  alternativeBinding: SavedResultEvidenceBinding,
): SavedResultComparisonPair | null {
  const comparison = selectSavedResultComparison(workspace, referenceTarget);
  const alternative = comparison?.alternatives.find((candidate) =>
    sameResultTarget(candidate.binding.target, alternativeBinding.target),
  );
  return comparison && alternative
    ? { reference: comparison.reference, alternative }
    : null;
}
