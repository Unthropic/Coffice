import { describe, expect, it } from "vitest";

import {
  createEmptyCofficeWorkspace,
  type CodexResultCycle,
  type CodexTaskAttempt,
  type CofficeWorkspace,
  type ResultReviewAssessmentTarget,
  type VerificationReceipt,
} from "../src/lib/coffice-workspace";
import {
  selectSavedResultComparison,
  selectSavedResultComparisonPair,
} from "../src/lib/saved-result-comparison";

const CREATED_AT = "2026-08-13T08:00:00.000Z";
const REVIEWED_AT = "2026-08-13T09:00:00.000Z";
const DECIDED_AT = "2026-08-13T09:01:00.000Z";
const UPDATED_AT = "2026-08-13T09:02:00.000Z";
const VERIFIED_AT = "2026-08-13T09:03:00.000Z";

function result(id: string, observedAt = CREATED_AT): CodexResultCycle {
  return { key: { kind: "revision", id }, observedAt };
}

function attempt(
  id: string,
  relationship: CodexTaskAttempt["relationship"],
  resultCycles: CodexResultCycle[],
): CodexTaskAttempt {
  return {
    id,
    codexTaskId: `task-${id}`,
    relationship,
    linkedAt: CREATED_AT,
    resultCycles,
  };
}

function workspaceWithAttempts(attempts: CodexTaskAttempt[]): CofficeWorkspace {
  const workspace = createEmptyCofficeWorkspace(CREATED_AT);
  workspace.projects = [
    {
      id: "project-source",
      title: "Private project title",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      objectives: [
        {
          id: "objective-source",
          title: "Private objective title",
          status: "active",
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          workItems: [
            {
              id: "work-item-source",
              title: "Private task content",
              expectedOutcome: "Private expected outcome",
              status: "ready_for_review",
              createdAt: CREATED_AT,
              updatedAt: CREATED_AT,
              attempts,
            },
          ],
        },
      ],
    },
  ];
  return workspace;
}

function target(
  attemptId = "attempt-current",
  resultId = "result-current",
): ResultReviewAssessmentTarget {
  return {
    projectId: "project-source",
    objectiveId: "objective-source",
    workItemId: "work-item-source",
    attemptId,
    resultKey: { kind: "revision", id: resultId },
  };
}

function receipt(
  receiptId: string,
  receiptTarget: ResultReviewAssessmentTarget,
  state: VerificationReceipt["state"] = "passed",
): VerificationReceipt {
  return {
    id: receiptId,
    idempotencyKey: `idempotency-${receiptId}`,
    requestHash: `hash-${receiptId}`,
    target: receiptTarget,
    profile: { id: "private-profile-id", version: "private-version" },
    checks: [
      {
        id: "private-command-id",
        version: "private-command-version",
        state,
        queuedAt: VERIFIED_AT,
        ...(state === "queued" ? {} : { startedAt: VERIFIED_AT }),
        ...(["passed", "failed", "unknown"].includes(state)
          ? { completedAt: VERIFIED_AT }
          : {}),
      },
    ],
    state,
    queuedAt: VERIFIED_AT,
    ...(state === "queued" ? {} : { startedAt: VERIFIED_AT }),
    ...(["passed", "failed", "unknown"].includes(state)
      ? { completedAt: VERIFIED_AT }
      : {}),
  };
}

describe("saved result comparison", () => {
  it("uses the exact durable source and the latest result of each alternative attempt", () => {
    const workspace = workspaceWithAttempts([
      attempt("attempt-current", "primary", [
        result("result-current"),
        result("result-newer-current", "2026-08-13T12:00:00.000Z"),
      ]),
      attempt("attempt-first-alternative", "alternative", [
        result("result-alt-old", "2026-08-13T14:00:00.000Z"),
        {
          ...result("result-alt-latest", "2026-08-13T07:00:00.000Z"),
          review: { reviewedAt: REVIEWED_AT },
        },
      ]),
      attempt("attempt-retry", "retry", [
        {
          ...result("result-retry"),
          review: { reviewedAt: REVIEWED_AT },
        },
      ]),
      attempt("attempt-handoff", "handoff", [
        {
          ...result("result-handoff"),
          review: { reviewedAt: REVIEWED_AT },
        },
      ]),
      attempt("attempt-continuation", "continuation", [
        {
          ...result("result-continuation"),
          review: { reviewedAt: REVIEWED_AT },
        },
      ]),
      attempt("attempt-second-alternative", "alternative", [
        {
          ...result("result-second-alt"),
          review: {
            reviewedAt: REVIEWED_AT,
            decision: {
              kind: "redirected",
              decidedAt: DECIDED_AT,
              note: "Private decision note",
            },
          },
        },
      ]),
    ]);

    expect(selectSavedResultComparison(workspace, target())).toEqual({
      reference: {
        binding: { target: target() },
        presentation: {
          role: "reference",
          attemptNumber: 1,
          resultNumber: 1,
          observedAt: CREATED_AT,
        },
      },
      alternatives: [
        {
          binding: {
            target: target("attempt-first-alternative", "result-alt-latest"),
          },
          presentation: {
            role: "alternative",
            attemptNumber: 2,
            resultNumber: 2,
            observedAt: "2026-08-13T07:00:00.000Z",
            review: { reviewedAt: REVIEWED_AT },
          },
        },
        {
          binding: {
            target: target("attempt-second-alternative", "result-second-alt"),
          },
          presentation: {
            role: "alternative",
            attemptNumber: 6,
            resultNumber: 1,
            observedAt: CREATED_AT,
            review: {
              reviewedAt: REVIEWED_AT,
              decision: { kind: "redirected", decidedAt: DECIDED_AT },
            },
          },
        },
      ],
    });
  });

  it("omits timestamp-only alternatives unless either exact result has durable evidence", () => {
    const attempts = [
      attempt("attempt-current", "primary", [result("result-current")]),
      attempt("attempt-alternative", "alternative", [result("result-alt")]),
    ];
    const timestampOnly = workspaceWithAttempts(attempts);
    timestampOnly.reviewAssessments = [
      {
        target: {
          projectId: "project-source",
          objectiveId: "objective-source",
          workItemId: "work-item-source",
        },
        authorship: "user",
        reviewSummary: "Work-item context must not qualify an exact result.",
        risks: [],
        uncertainties: [],
        blockedDecisions: [],
        updatedAt: UPDATED_AT,
      },
    ];

    expect(
      selectSavedResultComparison(timestampOnly, target())?.alternatives,
    ).toEqual([]);

    const assessedAlternative = workspaceWithAttempts(attempts);
    assessedAlternative.reviewAssessments = [
      {
        target: target("attempt-alternative", "result-alt"),
        authorship: "user",
        reviewSummary: "Private comparison assessment",
        risks: ["Private risk"],
        uncertainties: ["Private uncertainty"],
        blockedDecisions: ["Private blocked decision"],
        nextAction: {
          kind: "request_review",
          note: "Private next-action note",
        },
        updatedAt: UPDATED_AT,
      },
    ];

    expect(
      selectSavedResultComparison(assessedAlternative, target())?.alternatives,
    ).toEqual([
      {
        binding: {
          target: target("attempt-alternative", "result-alt"),
        },
        presentation: {
          role: "alternative",
          attemptNumber: 2,
          resultNumber: 1,
          observedAt: CREATED_AT,
          assessment: {
            updatedAt: UPDATED_AT,
            summaryRecorded: true,
            riskCount: 1,
            uncertaintyCount: 1,
            blockedDecisionCount: 1,
            recordedNextAction: "request_review",
          },
        },
      },
    ]);

    const reviewedCurrent = workspaceWithAttempts([
      attempt("attempt-current", "primary", [
        { ...result("result-current"), review: { reviewedAt: REVIEWED_AT } },
      ]),
      attempts[1]!,
    ]);
    expect(
      selectSavedResultComparison(reviewedCurrent, target())?.alternatives,
    ).toHaveLength(1);

    const verifiedCurrent = workspaceWithAttempts(attempts);
    verifiedCurrent.verificationReceipts = [
      receipt("receipt-current", target(), "passed"),
    ];
    expect(
      selectSavedResultComparison(verifiedCurrent, target())?.alternatives,
    ).toHaveLength(1);
  });

  it("uses only the last matching retained structural verification receipt", () => {
    const workspace = workspaceWithAttempts([
      attempt("attempt-current", "primary", [result("result-current")]),
      attempt("attempt-alternative", "alternative", [result("result-alt")]),
    ]);
    const alternativeTarget = target("attempt-alternative", "result-alt");
    workspace.verificationReceipts = [
      receipt("receipt-earlier", alternativeTarget, "failed"),
      receipt(
        "receipt-other-result",
        target("attempt-alternative", "result-other"),
        "failed",
      ),
      {
        ...receipt("receipt-latest", alternativeTarget, "passed"),
        profile: { id: "test", version: "1" },
        queuedAt: "2026-08-13T06:00:00.000Z",
        startedAt: "2026-08-13T06:00:00.000Z",
        completedAt: "2026-08-13T06:00:00.000Z",
        checks: [
          {
            id: "private-pass-command",
            version: "private-version",
            state: "passed",
            queuedAt: "2026-08-13T06:00:00.000Z",
            startedAt: "2026-08-13T06:00:00.000Z",
            completedAt: "2026-08-13T06:00:00.000Z",
          },
          {
            id: "private-unknown-command",
            version: "private-version",
            state: "unknown",
            queuedAt: "2026-08-13T06:00:00.000Z",
            startedAt: "2026-08-13T06:00:00.000Z",
            completedAt: "2026-08-13T06:00:00.000Z",
          },
        ],
      },
    ];

    const comparison = selectSavedResultComparison(workspace, target());
    expect(comparison?.alternatives[0]?.presentation.verification).toEqual({
      label: "Newest retained quality check",
      profileLabel: "Tests",
      state: "passed",
      queuedAt: "2026-08-13T06:00:00.000Z",
      startedAt: "2026-08-13T06:00:00.000Z",
      completedAt: "2026-08-13T06:00:00.000Z",
      checkCounts: {
        queued: 0,
        running: 0,
        passed: 1,
        failed: 0,
        unknown: 1,
      },
      failureCounts: { exit: 0, timeout: 0, launch: 0 },
    });
  });

  it.each([
    ["test", "1", "Tests"],
    ["typecheck", "1", "Type check"],
    ["lint", "1", "Lint"],
    ["build", "1", "Production build"],
    ["private-profile-id", "1", "Saved quality check"],
    ["test", "future-version", "Saved quality check"],
  ])(
    "maps profile %s@%s to the privacy-safe label %s",
    (profileId, profileVersion, label) => {
      const workspace = workspaceWithAttempts([
        attempt("attempt-reference", "primary", [
          {
            ...result("result-reference"),
            review: { reviewedAt: REVIEWED_AT },
          },
        ]),
        attempt("attempt-alternative", "alternative", [result("result-alt")]),
      ]);
      workspace.verificationReceipts = [
        {
          ...receipt(
            "receipt-alternative",
            target("attempt-alternative", "result-alt"),
          ),
          profile: { id: profileId, version: profileVersion },
        },
      ];

      expect(
        selectSavedResultComparison(
          workspace,
          target("attempt-reference", "result-reference"),
        )?.alternatives[0]?.presentation.verification?.profileLabel,
      ).toBe(label);
    },
  );

  it("presents coarse check states and failure kinds without command details", () => {
    const workspace = workspaceWithAttempts([
      attempt("attempt-reference", "primary", [result("result-reference")]),
      attempt("attempt-alternative", "alternative", [result("result-alt")]),
    ]);
    const alternativeTarget = target("attempt-alternative", "result-alt");
    workspace.verificationReceipts = [
      {
        ...receipt("receipt-failed", alternativeTarget, "failed"),
        profile: { id: "lint", version: "1" },
        checks: [
          {
            id: "PRIVATE_LINT_COMMAND_ID",
            version: "1",
            state: "failed",
            queuedAt: VERIFIED_AT,
            startedAt: VERIFIED_AT,
            completedAt: VERIFIED_AT,
            failureKind: "timeout",
          },
        ],
      },
    ];

    const presentation = selectSavedResultComparison(
      workspace,
      target("attempt-reference", "result-reference"),
    )?.alternatives[0]?.presentation.verification;
    expect(presentation).toMatchObject({
      label: "Newest retained quality check",
      profileLabel: "Lint",
      state: "failed",
      checkCounts: {
        queued: 0,
        running: 0,
        passed: 0,
        failed: 1,
        unknown: 0,
      },
      failureCounts: { exit: 0, timeout: 1, launch: 0 },
    });
    expect(JSON.stringify(presentation)).not.toContain(
      "PRIVATE_LINT_COMMAND_ID",
    );
  });

  it("uses exact bindings to select and invalidate a comparison candidate", () => {
    const workspace = workspaceWithAttempts([
      attempt("attempt-reference", "primary", [
        { ...result("result-reference"), review: { reviewedAt: REVIEWED_AT } },
      ]),
      attempt("attempt-alternative-a", "alternative", [result("result-a")]),
      attempt("attempt-alternative-b", "alternative", [result("result-b")]),
    ]);
    const referenceTarget = target("attempt-reference", "result-reference");

    const comparison = selectSavedResultComparison(workspace, referenceTarget);
    const selectedBinding = comparison!.alternatives[1]!.binding;
    expect(
      selectSavedResultComparisonPair(
        workspace,
        referenceTarget,
        selectedBinding,
      ),
    ).toEqual({
      reference: expect.objectContaining({
        presentation: expect.objectContaining({ role: "reference" }),
      }),
      alternative: expect.objectContaining({
        binding: selectedBinding,
        presentation: expect.objectContaining({
          role: "alternative",
          attemptNumber: 3,
        }),
      }),
    });

    workspace.projects[0]!.objectives[0]!.workItems[0]!.attempts[2]!.resultCycles.push(
      result("result-newest-b", "2026-08-13T10:00:00.000Z"),
    );
    expect(
      selectSavedResultComparisonPair(
        workspace,
        referenceTarget,
        selectedBinding,
      ),
    ).toBeNull();
  });

  it("compares an alternative reference only with other alternative attempts", () => {
    const workspace = workspaceWithAttempts([
      attempt("attempt-primary", "primary", [
        {
          ...result("result-primary"),
          review: { reviewedAt: REVIEWED_AT },
        },
      ]),
      attempt("attempt-reference-alternative", "alternative", [
        result("result-reference-alternative"),
      ]),
      attempt("attempt-other-alternative", "alternative", [
        result("result-other-alternative"),
      ]),
      attempt("attempt-retry", "retry", [
        {
          ...result("result-retry"),
          review: { reviewedAt: REVIEWED_AT },
        },
      ]),
    ]);
    workspace.reviewAssessments = [
      {
        target: target(
          "attempt-reference-alternative",
          "result-reference-alternative",
        ),
        authorship: "user",
        risks: [],
        uncertainties: [],
        blockedDecisions: [],
        updatedAt: UPDATED_AT,
      },
    ];

    const comparison = selectSavedResultComparison(
      workspace,
      target("attempt-reference-alternative", "result-reference-alternative"),
    );
    expect(
      comparison?.alternatives.map(
        (candidate) => candidate.presentation.attemptNumber,
      ),
    ).toEqual([3]);
  });

  it("returns privacy-safe presentation data without ranking or authored content", () => {
    const workspace = workspaceWithAttempts([
      attempt("private-current-attempt-id", "primary", [
        {
          ...result("private-current-result-id"),
          review: {
            reviewedAt: REVIEWED_AT,
            decision: {
              kind: "accepted",
              decidedAt: DECIDED_AT,
              note: "PRIVATE_DECISION_NOTE",
            },
          },
        },
      ]),
      attempt("private-alternative-attempt-id", "alternative", [
        result("private-alternative-result-id"),
      ]),
    ]);
    const currentTarget = target(
      "private-current-attempt-id",
      "private-current-result-id",
    );
    workspace.reviewAssessments = [
      {
        target: currentTarget,
        authorship: "user",
        reviewSummary: "PRIVATE_REVIEW_SUMMARY",
        risks: ["PRIVATE_RISK_CONTENT"],
        uncertainties: ["PRIVATE_UNCERTAINTY_CONTENT"],
        blockedDecisions: ["PRIVATE_BLOCKED_DECISION"],
        nextAction: {
          kind: "open_in_codex",
          note: "PRIVATE_ACTION_NOTE",
        },
        updatedAt: UPDATED_AT,
      },
    ];
    workspace.verificationReceipts = [
      receipt("PRIVATE_RECEIPT_ID", currentTarget),
    ];
    const before = structuredClone(workspace);

    const comparison = selectSavedResultComparison(workspace, currentTarget);
    const serialized = JSON.stringify({
      reference: comparison?.reference.presentation,
      alternatives: comparison?.alternatives.map(
        (candidate) => candidate.presentation,
      ),
    });

    expect(workspace).toEqual(before);
    expect(comparison?.alternatives).toHaveLength(1);
    for (const privateValue of [
      "project-source",
      "objective-source",
      "work-item-source",
      "private-current-attempt-id",
      "private-alternative-attempt-id",
      "private-current-result-id",
      "private-alternative-result-id",
      "Private project title",
      "Private objective title",
      "Private task content",
      "Private expected outcome",
      "PRIVATE_DECISION_NOTE",
      "PRIVATE_REVIEW_SUMMARY",
      "PRIVATE_RISK_CONTENT",
      "PRIVATE_UNCERTAINTY_CONTENT",
      "PRIVATE_BLOCKED_DECISION",
      "PRIVATE_ACTION_NOTE",
      "PRIVATE_RECEIPT_ID",
      "private-profile-id",
      "private-command-id",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).not.toMatch(/rank|score|recommend/iu);
  });

  it("returns null unless the current target resolves to one exact durable result", () => {
    const workspace = workspaceWithAttempts([
      attempt("attempt-current", "primary", [result("result-current")]),
    ]);

    expect(selectSavedResultComparison(null, target())).toBeNull();
    expect(
      selectSavedResultComparison(workspace, {
        ...target(),
        projectId: "missing-project",
      }),
    ).toBeNull();
    expect(
      selectSavedResultComparison(workspace, {
        ...target(),
        objectiveId: "missing-objective",
      }),
    ).toBeNull();
    expect(
      selectSavedResultComparison(workspace, {
        ...target(),
        workItemId: "missing-work-item",
      }),
    ).toBeNull();
    expect(
      selectSavedResultComparison(workspace, target("missing-attempt")),
    ).toBeNull();
    expect(
      selectSavedResultComparison(
        workspace,
        target("attempt-current", "missing-result"),
      ),
    ).toBeNull();
  });
});
