import { describe, expect, it } from "vitest";

import { selectAttentionDigest } from "../src/lib/attention-digest";
import {
  createDecisionRequestAttentionItem,
  createInitialAttentionReviewState,
  selectAttentionItems,
} from "../src/lib/attention-inbox";
import {
  COFFICE_WORKSPACE_SCHEMA_VERSION,
  CofficeWorkspaceValidationError,
  MAX_DECISION_REQUEST_TEXT_LENGTH,
  createEmptyCofficeWorkspace,
  parseCofficeWorkspace,
  reduceCofficeWorkspace,
  serializeWorkspaceMutation,
  type CofficeWorkspace,
  type ReviewAssessmentTarget,
  type WorkspaceMutation,
} from "../src/lib/coffice-workspace";

const START = "2026-08-19T11:00:00.000Z";
const LATER = "2026-08-19T11:05:00.000Z";
const RESULT_TARGET: ReviewAssessmentTarget = {
  projectId: "project-a",
  objectiveId: "objective-a",
  workItemId: "work-a",
  attemptId: "attempt-a",
  resultKey: { kind: "revision", id: "result-a" },
};

function workspaceFixture(): CofficeWorkspace {
  return reduceCofficeWorkspace(
    createEmptyCofficeWorkspace(START),
    {
      type: "project.upsert",
      project: {
        id: "project-a",
        title: "Project A",
        createdAt: START,
        updatedAt: START,
        objectives: [
          {
            id: "objective-a",
            title: "Objective A",
            status: "active",
            createdAt: START,
            updatedAt: START,
            workItems: [
              {
                id: "work-a",
                title: "Choose a release target",
                expectedOutcome: "A recorded release-target decision",
                status: "in_progress",
                createdAt: START,
                updatedAt: START,
                attempts: [
                  {
                    id: "attempt-a",
                    codexTaskId: "task-a",
                    relationship: "primary",
                    linkedAt: START,
                    resultCycles: [
                      {
                        key: { kind: "revision", id: "result-a" },
                        observedAt: START,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    START,
  );
}

function apply(
  workspace: CofficeWorkspace,
  mutation: WorkspaceMutation,
  now = LATER,
) {
  return reduceCofficeWorkspace(workspace, mutation, now);
}

describe("user-managed decision requests", () => {
  it("creates exact work-item and result requests with explicit lifecycle", () => {
    let workspace = workspaceFixture();
    workspace = apply(workspace, {
      type: "decisionRequest.create",
      request: {
        id: "decision-work",
        target: {
          projectId: "project-a",
          objectiveId: "objective-a",
          workItemId: "work-a",
        },
        prompt: "Which release target should this work use?",
      },
    });
    workspace = apply(workspace, {
      type: "decisionRequest.create",
      request: {
        id: "decision-result",
        target: RESULT_TARGET,
        prompt: "Should this exact result be accepted with the known risk?",
      },
    });

    expect(workspace.decisionRequests).toMatchObject([
      {
        id: "decision-work",
        authorship: "user",
        createdAt: LATER,
        updatedAt: LATER,
      },
      { id: "decision-result", target: RESULT_TARGET },
    ]);

    workspace = apply(workspace, {
      type: "decisionRequest.update",
      id: "decision-work",
      prompt: "Which exact release target should this work use?",
    });
    workspace = apply(workspace, {
      type: "decisionRequest.resolve",
      id: "decision-result",
      resolution: "Accept after documenting the risk.",
    });
    expect(workspace.decisionRequests[1]).toMatchObject({
      resolvedAt: LATER,
      resolution: "Accept after documenting the risk.",
    });

    workspace = apply(workspace, {
      type: "decisionRequest.reopen",
      id: "decision-result",
    });
    expect(workspace.decisionRequests[1].resolvedAt).toBeUndefined();
    expect(workspace.decisionRequests[1].resolution).toBeUndefined();

    workspace = apply(workspace, {
      type: "decisionRequest.remove",
      id: "decision-result",
    });
    expect(workspace.decisionRequests.map((request) => request.id)).toEqual([
      "decision-work",
    ]);
  });

  it("migrates v1-v11 with no invented requests and rejects backported fields", () => {
    const current = workspaceFixture();
    for (let version = 1; version <= 11; version += 1) {
      const legacy = structuredClone(current) as unknown as Record<
        string,
        unknown
      >;
      legacy.schemaVersion = version;
      delete legacy.decisionRequests;
      if (version < 11) {
        const projects = legacy.projects as Array<Record<string, unknown>>;
        for (const project of projects) delete project.reviewSchedule;
      }
      if (version < 10) {
        const projects = legacy.projects as Array<Record<string, unknown>>;
        for (const project of projects) delete project.contextReview;
      }
      if (version < 9) {
        const projects = legacy.projects as Array<Record<string, unknown>>;
        for (const project of projects) {
          for (const objective of project.objectives as Array<
            Record<string, unknown>
          >) {
            for (const workItem of objective.workItems as Array<
              Record<string, unknown>
            >) {
              delete workItem.relationships;
            }
          }
        }
      }
      if (version < 8) {
        const projects = legacy.projects as Array<Record<string, unknown>>;
        for (const project of projects) delete project.qualityBars;
      }
      if (version < 7) {
        const projects = legacy.projects as Array<Record<string, unknown>>;
        for (const project of projects) delete project.rules;
      }
      if (version < 6) {
        const projects = legacy.projects as Array<Record<string, unknown>>;
        for (const project of projects) {
          for (const objective of project.objectives as Array<
            Record<string, unknown>
          >) {
            for (const workItem of objective.workItems as Array<
              Record<string, unknown>
            >) {
              delete workItem.definitionOfDone;
            }
          }
        }
      }
      if (version < 5) delete legacy.projectDecisionEvents;
      if (version < 4) delete legacy.reviewAssessments;
      if (version === 1) delete legacy.verificationReceipts;

      const migrated = parseCofficeWorkspace(legacy);
      expect(migrated.schemaVersion).toBe(COFFICE_WORKSPACE_SCHEMA_VERSION);
      expect(migrated.decisionRequests).toEqual([]);

      legacy.decisionRequests = [];
      expect(() => parseCofficeWorkspace(legacy)).toThrow(
        CofficeWorkspaceValidationError,
      );
    }
  });

  it("rejects unknown targets, stale lifecycle operations, and oversized text", () => {
    const workspace = workspaceFixture();
    expect(() =>
      apply(workspace, {
        type: "decisionRequest.create",
        request: {
          id: "missing-target",
          target: { ...RESULT_TARGET, workItemId: "missing" },
          prompt: "Choose",
        },
      }),
    ).toThrow(CofficeWorkspaceValidationError);
    expect(() =>
      apply(workspace, {
        type: "decisionRequest.create",
        request: {
          id: "too-large",
          target: RESULT_TARGET,
          prompt: "x".repeat(MAX_DECISION_REQUEST_TEXT_LENGTH + 1),
        },
      }),
    ).toThrow(CofficeWorkspaceValidationError);

    const created = apply(workspace, {
      type: "decisionRequest.create",
      request: {
        id: "decision-a",
        target: RESULT_TARGET,
        prompt: "Choose",
      },
    });
    const resolved = apply(created, {
      type: "decisionRequest.resolve",
      id: "decision-a",
    });
    expect(() =>
      apply(resolved, {
        type: "decisionRequest.update",
        id: "decision-a",
        prompt: "Rewrite history",
      }),
    ).toThrow(CofficeWorkspaceValidationError);
    expect(() =>
      apply(resolved, {
        type: "decisionRequest.remove",
        id: "decision-a",
      }),
    ).toThrow(CofficeWorkspaceValidationError);
    expect(() =>
      apply(created, {
        type: "decisionRequest.create",
        request: {
          id: "decision-a",
          target: RESULT_TARGET,
          prompt: "Duplicate identity",
        },
      }),
    ).toThrow(CofficeWorkspaceValidationError);
    expect(() =>
      parseCofficeWorkspace({
        ...resolved,
        decisionRequests: resolved.decisionRequests.map((request) => ({
          ...request,
          updatedAt: START,
        })),
      }),
    ).toThrow(CofficeWorkspaceValidationError);
  });

  it("preserves requests across generic target updates and rejects target removal", () => {
    const source = workspaceFixture();
    const created = apply(source, {
      type: "decisionRequest.create",
      request: {
        id: "decision-a",
        target: RESULT_TARGET,
        prompt: "Choose",
      },
    });
    const updatedProject = structuredClone(created.projects[0]);
    updatedProject.title = "Renamed Project";
    const preserved = apply(created, {
      type: "project.upsert",
      project: updatedProject,
    });
    expect(preserved.decisionRequests).toEqual(created.decisionRequests);

    const missingTarget = structuredClone(updatedProject);
    missingTarget.objectives[0].workItems = [];
    expect(() =>
      apply(created, {
        type: "project.upsert",
        project: missingTarget,
      }),
    ).toThrow(CofficeWorkspaceValidationError);
  });

  it("serializes intent deterministically without unrelated workspace data", () => {
    expect(
      serializeWorkspaceMutation({
        type: "decisionRequest.resolve",
        id: "decision-a",
        resolution: "Use staging.",
      }),
    ).toBe(
      '{"id":"decision-a","resolution":"Use staging.","type":"decisionRequest.resolve"}',
    );
  });

  it("projects only structural context into its own Attention and Digest category", () => {
    const projectedRequest = {
      id: "decision-a",
      createdAt: LATER,
      workItemId: "work-a",
      workItemTitle: "Choose a release target",
      taskId: "task-a",
      verificationTarget: RESULT_TARGET,
    };
    const project = {
      id: "project-a",
      name: "Project A",
      tasks: [],
      decisionRequests: [projectedRequest],
    };
    const item = createDecisionRequestAttentionItem(project, projectedRequest);
    expect(item).toMatchObject({
      kind: "decision_needed",
      verificationTarget: RESULT_TARGET,
      recommendedAction: "Review the exact result decision",
    });
    expect(JSON.stringify(item)).not.toContain("Should this exact result");

    const state = createInitialAttentionReviewState(START);
    const items = selectAttentionItems([project], state, Date.parse(LATER));
    const digest = selectAttentionDigest(items, () => undefined);
    expect(digest.counts).toEqual({
      needsReply: 0,
      needsDecision: 1,
      unreadResults: 0,
      otherActions: 0,
      total: 1,
    });
    expect(digest.groups[0]?.items[0]?.category).toBe("needs_decision");
  });
});
