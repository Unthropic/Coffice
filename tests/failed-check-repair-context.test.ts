import { describe, expect, it } from "vitest";

import { buildFailedCheckRepairFollowUpContext } from "../src/lib/failed-check-repair-context";
import { MAX_FOLLOW_UP_CONTEXT_LENGTH } from "../src/lib/follow-up-context";
import {
  createEmptyCofficeWorkspace,
  MAX_PROJECT_DECISION_CONTEXT_LENGTH,
  MAX_PROJECT_DECISION_STATEMENT_LENGTH,
  type CofficeWorkspace,
  type ProjectDecisionEvent,
  type VerificationReceipt,
  type VerificationTarget,
  type WorkspaceProject,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-12T08:00:00.000Z";
const TARGET: VerificationTarget = {
  projectId: "project-current-private-id",
  objectiveId: "objective-private-id",
  workItemId: "work-private-id",
  attemptId: "attempt-private-id",
  resultKey: { kind: "revision", id: "result-private-id" },
};

function project(
  options: {
    taskId?: string;
    target?: VerificationTarget;
    priorResult?: boolean;
    unlinkedAt?: string;
    objective?: string;
    objectiveExpectedOutcome?: string;
    workItem?: string;
    expectedOutcome?: string;
    definitionOfDone?: string[];
    rules?: string[];
  } = {},
): WorkspaceProject {
  const target = options.target ?? TARGET;
  return {
    id: target.projectId,
    title: "Private project title",
    ...(options.rules ? { rules: options.rules } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [
      {
        id: target.objectiveId,
        title: options.objective ?? "Restore the release checks",
        ...(options.objectiveExpectedOutcome
          ? { expectedOutcome: options.objectiveExpectedOutcome }
          : {}),
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        workItems: [
          {
            id: target.workItemId,
            title: options.workItem ?? "Repair the failing slice",
            expectedOutcome:
              options.expectedOutcome ?? "The fixed check passes cleanly.",
            ...(options.definitionOfDone
              ? { definitionOfDone: options.definitionOfDone }
              : {}),
            status: "in_progress",
            createdAt: NOW,
            updatedAt: NOW,
            attempts: [
              {
                id: target.attemptId,
                codexTaskId: options.taskId ?? "task-private-id",
                relationship: "primary",
                linkedAt: NOW,
                ...(options.unlinkedAt
                  ? { unlinkedAt: options.unlinkedAt }
                  : {}),
                resultCycles: [
                  ...(options.priorResult
                    ? [
                        {
                          key: {
                            kind: "revision" as const,
                            id: "older-private-result-id",
                          },
                          observedAt: "2026-08-12T07:00:00.000Z",
                        },
                      ]
                    : []),
                  { key: target.resultKey, observedAt: NOW },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function receipt(
  overrides: Partial<VerificationReceipt> = {},
): VerificationReceipt {
  return {
    id: "receipt-private-id",
    idempotencyKey: "idempotency-private-id",
    requestHash: "hash-private-id",
    target: TARGET,
    profile: { id: "test", version: "1" },
    checks: [
      {
        id: "test",
        version: "1",
        state: "failed",
        queuedAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        failureKind: "exit",
        exitCode: 7,
      },
    ],
    state: "failed",
    queuedAt: NOW,
    startedAt: NOW,
    completedAt: NOW,
    ...overrides,
  };
}

function workspace(
  projects: WorkspaceProject[] = [
    project({
      priorResult: true,
      definitionOfDone: [
        "DefinitionOfDonePrivateCanaryMustNotEnterRepairFollowUp",
      ],
      rules: ["ProjectRulesPrivateCanaryMustNotEnterRepairFollowUp"],
    }),
  ],
  receipts: VerificationReceipt[] = [receipt()],
  decisions: ProjectDecisionEvent[] = [],
): CofficeWorkspace {
  return {
    ...createEmptyCofficeWorkspace(NOW),
    projects,
    verificationReceipts: receipts,
    projectDecisionEvents: decisions,
    evidence: [
      {
        id: "evidence-private-id",
        kind: "verification",
        outcome: "failed",
        summary: "SECRET OUTPUT LOG PATH COMMAND",
        recordedAt: NOW,
        projectId: TARGET.projectId,
        provenance: { source: "coffice", reference: "private-reference" },
      },
    ],
  };
}

describe("failed-check repair follow-up context", () => {
  it("builds deterministic text from the current plan and latest exact structural failure", () => {
    const result = buildFailedCheckRepairFollowUpContext(
      workspace(
        undefined,
        [
          receipt({ id: "older-failed-receipt" }),
          receipt({
            id: "different-result-receipt",
            target: {
              ...TARGET,
              resultKey: { kind: "revision", id: "another-private-result" },
            },
          }),
          receipt(),
        ],
        [
          {
            id: "decision-private-id",
            projectId: TARGET.projectId,
            action: "recorded",
            statement: "Keep the repair narrowly scoped.\r\nPreserve behavior.",
            context: "This was explicitly agreed.",
            authorship: "user",
            recordedAt: NOW,
          },
        ],
      ),
      "task-private-id",
      TARGET,
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.text).toBe(
      [
        "Coffice repair follow-up copied for review",
        "",
        "Objective: Restore the release checks",
        "Work item: Repair the failing slice",
        "Expected outcome: The fixed check passes cleanly.",
        "",
        "Current user-recorded project decisions:",
        "- Keep the repair narrowly scoped.",
        "  Preserve behavior.",
        "  Recorded context: This was explicitly agreed.",
        "",
        "Failed quality check: Tests",
        "Observed outcome: Failed · exit 7",
        "",
        "Please diagnose and repair the cause of this failed quality check. Rerun the same Tests check after the repair, then report the outcome and any remaining risks.",
      ].join("\n"),
    );
    expect(result.fingerprint).toMatch(/^repair-v1-[0-9a-f]{32}$/u);
    expect(JSON.stringify(result)).not.toMatch(
      /private-id|2026-|SECRET|OUTPUT|LOG|PATH|COMMAND|private-reference/u,
    );
    expect(JSON.stringify(result)).not.toContain(
      "DefinitionOfDonePrivateCanaryMustNotEnterRepairFollowUp",
    );
    expect(JSON.stringify(result)).not.toContain(
      "ProjectRulesPrivateCanaryMustNotEnterRepairFollowUp",
    );
  });

  it("returns a deterministic opaque fingerprint bound to every repair source", () => {
    const originalWorkspace = workspace();
    const original = buildFailedCheckRepairFollowUpContext(
      originalWorkspace,
      "task-private-id",
      TARGET,
    );
    const repeated = buildFailedCheckRepairFollowUpContext(
      originalWorkspace,
      "task-private-id",
      TARGET,
    );
    expect(original.kind).toBe("ready");
    expect(repeated.kind).toBe("ready");
    if (original.kind !== "ready" || repeated.kind !== "ready") return;
    expect(repeated.fingerprint).toBe(original.fingerprint);

    const changedReceipt = buildFailedCheckRepairFollowUpContext(
      workspace(undefined, [receipt({ id: "replacement-private-id" })]),
      "task-private-id",
      TARGET,
    );
    const changedPlan = buildFailedCheckRepairFollowUpContext(
      workspace([project({ objective: "Changed safe plan text" })]),
      "task-private-id",
      TARGET,
    );
    expect(changedReceipt.kind).toBe("ready");
    expect(changedPlan.kind).toBe("ready");
    if (changedReceipt.kind !== "ready" || changedPlan.kind !== "ready") return;
    expect(changedReceipt.fingerprint).not.toBe(original.fingerprint);
    expect(changedPlan.fingerprint).not.toBe(original.fingerprint);
    expect(
      JSON.stringify([
        original.fingerprint,
        changedReceipt.fingerprint,
        changedPlan.fingerprint,
      ]),
    ).not.toMatch(/private|Restore|Changed|receipt|task|project|result/u);
  });

  it.each([
    ["test", "Tests"],
    ["typecheck", "Type check"],
    ["lint", "Lint"],
    ["build", "Production build"],
  ] as const)("uses the fixed %s profile label", (profileId, label) => {
    const result = buildFailedCheckRepairFollowUpContext(
      workspace(undefined, [
        receipt({
          profile: { id: profileId, version: "1" },
          checks: [
            {
              ...receipt().checks[0]!,
              id: profileId,
              failureKind: "timeout",
              exitCode: undefined,
            },
          ],
        }),
      ]),
      "task-private-id",
      TARGET,
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.text).toContain(`Failed quality check: ${label}`);
    expect(result.text).toContain("Observed outcome: Timed out");
  });

  it("requires one matching current link whose latest result is the target", () => {
    expect(
      buildFailedCheckRepairFollowUpContext(
        workspace([]),
        "task-private-id",
        TARGET,
      ),
    ).toEqual({ kind: "unavailable", reason: "no_open_context" });
    expect(
      buildFailedCheckRepairFollowUpContext(
        workspace([project(), project()]),
        "task-private-id",
        TARGET,
      ),
    ).toEqual({ kind: "unavailable", reason: "ambiguous_open_context" });
    expect(
      buildFailedCheckRepairFollowUpContext(workspace(), "task-private-id", {
        ...TARGET,
        workItemId: "different-work",
      }),
    ).toEqual({ kind: "unavailable", reason: "target_mismatch" });
    const changedResult = {
      ...TARGET,
      resultKey: { kind: "revision" as const, id: "new-current-result" },
    };
    expect(
      buildFailedCheckRepairFollowUpContext(
        workspace([project({ target: changedResult })]),
        "task-private-id",
        TARGET,
      ),
    ).toEqual({ kind: "unavailable", reason: "result_not_current" });
  });

  it("requires the latest exact receipt to be one valid failed fixed-profile check", () => {
    expect(
      buildFailedCheckRepairFollowUpContext(
        workspace(undefined, []),
        "task-private-id",
        TARGET,
      ),
    ).toEqual({ kind: "unavailable", reason: "no_verification_receipt" });
    for (const state of ["queued", "running", "passed", "unknown"] as const) {
      expect(
        buildFailedCheckRepairFollowUpContext(
          workspace(undefined, [
            receipt(),
            receipt({
              state,
              checks: [
                {
                  ...receipt().checks[0]!,
                  state,
                  failureKind: undefined,
                  exitCode: undefined,
                },
              ],
            }),
          ]),
          "task-private-id",
          TARGET,
        ),
      ).toEqual({
        kind: "unavailable",
        reason: "latest_verification_not_failed",
      });
    }
    expect(
      buildFailedCheckRepairFollowUpContext(
        workspace(undefined, [
          receipt({
            profile: { id: "private-profile-id", version: "1" },
            checks: [{ ...receipt().checks[0]!, id: "private-profile-id" }],
          }),
        ]),
        "task-private-id",
        TARGET,
      ),
    ).toEqual({
      kind: "unavailable",
      reason: "unsupported_verification_profile",
    });
    expect(
      buildFailedCheckRepairFollowUpContext(
        workspace(undefined, [
          receipt({ checks: [{ ...receipt().checks[0]!, version: "2" }] }),
        ]),
        "task-private-id",
        TARGET,
      ),
    ).toEqual({
      kind: "unavailable",
      reason: "invalid_verification_receipt",
    });
    for (const checks of [
      [receipt().checks[0]!, { ...receipt().checks[0]!, id: "lint" }],
      [{ ...receipt().checks[0]!, id: "lint" }],
      [{ ...receipt().checks[0]!, failureKind: undefined }],
    ]) {
      expect(
        buildFailedCheckRepairFollowUpContext(
          workspace(undefined, [receipt({ checks })]),
          "task-private-id",
          TARGET,
        ),
      ).toEqual({
        kind: "unavailable",
        reason: "invalid_verification_receipt",
      });
    }
  });

  it("labels every structural failure without exposing a command or log", () => {
    const cases = [
      ["launch", undefined, "Could not start"],
      ["exit", undefined, "Failed · project script"],
      ["exit", -1073741510, "Failed · exit -1073741510"],
    ] as const;
    for (const [failureKind, exitCode, label] of cases) {
      const result = buildFailedCheckRepairFollowUpContext(
        workspace(undefined, [
          receipt({
            profile: { id: "lint", version: "future-profile-version" },
            checks: [
              {
                ...receipt().checks[0]!,
                id: "lint",
                version: "future-profile-version",
                failureKind,
                exitCode,
              },
            ],
          }),
        ]),
        "task-private-id",
        TARGET,
      );
      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") continue;
      expect(result.text).toContain(`Observed outcome: ${label}`);
      expect(result.text).not.toContain("future-profile-version");
    }
  });

  it("accepts exactly 8,000 units and rejects overflow without truncation", () => {
    const largeProject = project({
      objective: "o".repeat(320),
      objectiveExpectedOutcome: "g".repeat(1_000),
      workItem: "w".repeat(320),
      expectedOutcome: "e".repeat(1_000),
    });
    const firstDecision: ProjectDecisionEvent = {
      id: "decision-one",
      projectId: TARGET.projectId,
      action: "recorded",
      statement: "s".repeat(MAX_PROJECT_DECISION_STATEMENT_LENGTH),
      context: "c".repeat(MAX_PROJECT_DECISION_CONTEXT_LENGTH),
      authorship: "user",
      recordedAt: NOW,
    };
    const secondDecision = (contextLength: number): ProjectDecisionEvent => ({
      id: "decision-two",
      projectId: TARGET.projectId,
      action: "recorded",
      statement: "t".repeat(MAX_PROJECT_DECISION_STATEMENT_LENGTH),
      context: "d".repeat(contextLength),
      authorship: "user",
      recordedAt: "2026-08-12T08:01:00.000Z",
    });
    const baseline = buildFailedCheckRepairFollowUpContext(
      workspace([largeProject], undefined, [firstDecision, secondDecision(1)]),
      "task-private-id",
      TARGET,
    );
    expect(baseline.kind).toBe("ready");
    if (baseline.kind !== "ready") return;
    const exactContextLength =
      MAX_FOLLOW_UP_CONTEXT_LENGTH - baseline.text.length + 1;
    expect(exactContextLength).toBeLessThanOrEqual(
      MAX_PROJECT_DECISION_CONTEXT_LENGTH,
    );
    const exact = buildFailedCheckRepairFollowUpContext(
      workspace([largeProject], undefined, [
        firstDecision,
        secondDecision(exactContextLength),
      ]),
      "task-private-id",
      TARGET,
    );
    expect(exact.kind).toBe("ready");
    if (exact.kind !== "ready") return;
    expect(exact.text).toHaveLength(MAX_FOLLOW_UP_CONTEXT_LENGTH);

    expect(
      buildFailedCheckRepairFollowUpContext(
        workspace([largeProject], undefined, [
          firstDecision,
          secondDecision(exactContextLength + 1),
        ]),
        "task-private-id",
        TARGET,
      ),
    ).toEqual({
      kind: "too_large",
      length: MAX_FOLLOW_UP_CONTEXT_LENGTH + 1,
      maxLength: MAX_FOLLOW_UP_CONTEXT_LENGTH,
    });
  });

  it("validates the latest exact receipt before reporting an oversized plan", () => {
    const oversizedDecisions = Array.from(
      { length: 3 },
      (_, index): ProjectDecisionEvent => ({
        id: `oversized-decision-${index}`,
        projectId: TARGET.projectId,
        action: "recorded",
        statement: String(index).repeat(MAX_PROJECT_DECISION_STATEMENT_LENGTH),
        context: String(index).repeat(MAX_PROJECT_DECISION_CONTEXT_LENGTH),
        authorship: "user",
        recordedAt: `2026-08-12T08:0${index}:00.000Z`,
      }),
    );
    const oversizedWorkspace = (receipts: VerificationReceipt[]) =>
      workspace(undefined, receipts, oversizedDecisions);

    expect(
      buildFailedCheckRepairFollowUpContext(
        oversizedWorkspace([]),
        "task-private-id",
        TARGET,
      ),
    ).toEqual({ kind: "unavailable", reason: "no_verification_receipt" });
    expect(
      buildFailedCheckRepairFollowUpContext(
        oversizedWorkspace([
          receipt(),
          receipt({
            state: "passed",
            checks: [
              {
                ...receipt().checks[0]!,
                state: "passed",
                failureKind: undefined,
                exitCode: undefined,
              },
            ],
          }),
        ]),
        "task-private-id",
        TARGET,
      ),
    ).toEqual({
      kind: "unavailable",
      reason: "latest_verification_not_failed",
    });

    const validFailure = buildFailedCheckRepairFollowUpContext(
      oversizedWorkspace([receipt()]),
      "task-private-id",
      TARGET,
    );
    expect(validFailure.kind).toBe("too_large");
    if (validFailure.kind !== "too_large") return;
    expect(validFailure.length).toBeGreaterThan(MAX_FOLLOW_UP_CONTEXT_LENGTH);
    expect(validFailure.maxLength).toBe(MAX_FOLLOW_UP_CONTEXT_LENGTH);
  });
});
