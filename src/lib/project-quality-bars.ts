import type {
  ProjectQualityBar,
  ProjectQualityBarProfileId,
  VerificationReceipt,
  VerificationState,
  VerificationTarget,
  WorkspaceProject,
} from "./coffice-workspace";

export const PROJECT_QUALITY_BAR_LABELS: Readonly<
  Record<ProjectQualityBarProfileId, string>
> = {
  test: "Tests",
  typecheck: "Type check",
  lint: "Lint",
  build: "Production build",
};

export type ProjectQualityBarResultState = VerificationState | "not_run";
export type ProjectQualityBarReadinessState =
  "not_configured" | "ready" | "not_ready" | "unknown";

export interface ProjectQualityBarResult {
  bar: ProjectQualityBar;
  label: string;
  state: ProjectQualityBarResultState;
  recordedAt?: string;
}

export interface ProjectQualityBarReadiness {
  state: ProjectQualityBarReadinessState;
  bars: ProjectQualityBarResult[];
}

function sameTarget(
  receipt: VerificationReceipt,
  target: VerificationTarget,
): boolean {
  return (
    receipt.target.projectId === target.projectId &&
    receipt.target.objectiveId === target.objectiveId &&
    receipt.target.workItemId === target.workItemId &&
    receipt.target.attemptId === target.attemptId &&
    receipt.target.resultKey.kind === target.resultKey.kind &&
    receipt.target.resultKey.id === target.resultKey.id
  );
}

function matchingReceipt(
  bar: ProjectQualityBar,
  target: VerificationTarget,
  receipts: readonly VerificationReceipt[],
): VerificationReceipt | undefined {
  return receipts.findLast(
    (receipt) =>
      sameTarget(receipt, target) &&
      receipt.profile.id === bar.profileId &&
      receipt.profile.version === bar.profileVersion,
  );
}

export function projectQualityBarReadiness(
  project: Pick<WorkspaceProject, "qualityBars">,
  target: VerificationTarget,
  receipts: readonly VerificationReceipt[],
): ProjectQualityBarReadiness {
  const bars = (project.qualityBars ?? []).map((bar) => {
    const receipt = matchingReceipt(bar, target, receipts);
    const check = receipt?.checks.find(
      (candidate) =>
        candidate.id === bar.profileId &&
        candidate.version === bar.profileVersion,
    );
    return {
      bar: { ...bar },
      label: PROJECT_QUALITY_BAR_LABELS[bar.profileId],
      state: receipt ? (check?.state ?? "unknown") : "not_run",
      ...(receipt
        ? {
            recordedAt:
              receipt.completedAt ?? receipt.startedAt ?? receipt.queuedAt,
          }
        : {}),
    } satisfies ProjectQualityBarResult;
  });

  if (bars.length === 0) return { state: "not_configured", bars };
  if (bars.every((bar) => bar.state === "passed")) {
    return { state: "ready", bars };
  }
  if (bars.some((bar) => bar.state === "failed")) {
    return { state: "not_ready", bars };
  }
  return { state: "unknown", bars };
}
