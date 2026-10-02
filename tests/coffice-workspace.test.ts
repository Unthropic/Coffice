import { describe, expect, it } from "vitest";

import {
  MAX_ATTENTION_REVIEW_STORAGE_BYTES,
  parseAttentionReviewState,
  serializeAttentionReviewState,
} from "../src/lib/attention-inbox";

import {
  CofficeWorkspaceValidationError,
  MAX_PROJECT_DECISION_CONTEXT_LENGTH,
  MAX_PROJECT_DECISION_STATEMENT_LENGTH,
  MAX_REVIEW_ASSESSMENT_LIST_ENTRIES,
  MAX_REVIEW_ASSESSMENT_TEXT_LENGTH,
  MAX_REVIEW_ASSESSMENT_TOTAL_TEXT_LENGTH,
  createVerificationReceipt,
  createEmptyCofficeWorkspace,
  parseCofficeWorkspace,
  parseSerializedCofficeWorkspace,
  parseVerificationStartRequest,
  parseWorkspaceMutation,
  reduceCofficeWorkspace,
  selectActiveProjectDecisions,
  selectProjectDecisionEvents,
  selectProjectDecisionHistory,
  selectReviewAssessment,
  serializeCofficeWorkspace,
  transitionVerificationReceipt,
  type Objective,
  type WorkspaceProject,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-11T12:00:00.000Z";
const LATER = "2026-08-11T12:01:00.000Z";
const THIRD = "2026-08-11T12:02:00.000Z";
const FOURTH = "2026-08-11T12:03:00.000Z";
const FIFTH = "2026-08-11T12:04:00.000Z";
const SIXTH = "2026-08-11T12:05:00.000Z";

function objective(): Objective {
  return {
    id: "objective-1",
    title: "Ship a useful review workflow",
    expectedOutcome: "A user can confidently accept or redirect a result.",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    workItems: [
      {
        id: "work-1",
        title: "Implement the result review",
        expectedOutcome: "A reviewed attempt records an explicit decision.",
        status: "ready_for_review",
        createdAt: NOW,
        updatedAt: NOW,
        attempts: [
          {
            id: "attempt-1",
            codexTaskId: "codex-thread-1",
            relationship: "primary",
            linkedAt: NOW,
            resultCycles: [
              {
                key: { kind: "turn", id: "turn-1" },
                observedAt: NOW,
              },
            ],
          },
        ],
      },
    ],
  };
}

function project(): WorkspaceProject {
  return {
    id: "project-1",
    title: "Coffice",
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [objective()],
  };
}

function seeded() {
  return reduceCofficeWorkspace(
    createEmptyCofficeWorkspace(NOW),
    { type: "project.upsert", project: project() },
    NOW,
  );
}

function outcomeWorkItem(id: string, at: string) {
  return {
    id,
    title: `Outcome ${id}`,
    expectedOutcome: `${id} reaches its reviewable finish line.`,
    status: "planned" as const,
    createdAt: at,
    updatedAt: at,
    attempts: [],
  };
}

function withThreeWorkItems() {
  const withSecond = reduceCofficeWorkspace(
    seeded(),
    {
      type: "workItem.upsert",
      projectId: "project-1",
      objectiveId: "objective-1",
      workItem: outcomeWorkItem("work-2", LATER),
    },
    LATER,
  );
  return reduceCofficeWorkspace(
    withSecond,
    {
      type: "workItem.upsert",
      projectId: "project-1",
      objectiveId: "objective-1",
      workItem: outcomeWorkItem("work-3", THIRD),
    },
    THIRD,
  );
}

function withDestination(
  workspace = seeded(),
  status:
    "planned" | "in_progress" | "blocked" | "ready_for_review" = "planned",
) {
  return reduceCofficeWorkspace(
    workspace,
    {
      type: "project.upsert",
      project: {
        id: "project-2",
        title: "Destination",
        createdAt: NOW,
        updatedAt: NOW,
        objectives: [
          {
            id: "objective-2",
            title: "Continue the work",
            status: "active",
            createdAt: NOW,
            updatedAt: NOW,
            workItems: [
              {
                id: "work-2",
                title: "Receive the reassigned task",
                expectedOutcome: "Future results belong to this plan.",
                status,
                createdAt: NOW,
                updatedAt: NOW,
                attempts: [],
              },
            ],
          },
        ],
      },
    },
    NOW,
  );
}

const SOURCE_LINK = {
  projectId: "project-1",
  objectiveId: "objective-1",
  workItemId: "work-1",
  attemptId: "attempt-1",
} as const;

const DESTINATION_LINK = {
  projectId: "project-2",
  objectiveId: "objective-2",
  workItemId: "work-2",
  attemptId: "attempt-2",
} as const;

const WORK_ASSESSMENT_TARGET = {
  projectId: "project-1",
  objectiveId: "objective-1",
  workItemId: "work-1",
} as const;

const RESULT_ASSESSMENT_TARGET = {
  ...WORK_ASSESSMENT_TARGET,
  attemptId: "attempt-1",
  resultKey: { kind: "turn" as const, id: "turn-1" },
} as const;

function decisionEvidence(
  id: string,
  resultId: string,
  recordedAt: string,
  decisionKind: "accepted" | "redirected" | "rejected",
) {
  return {
    id,
    kind: "decision" as const,
    outcome: "neutral" as const,
    summary: "Recorded the result decision.",
    recordedAt,
    projectId: "project-1",
    objectiveId: "objective-1",
    workItemId: "work-1",
    attemptId: "attempt-1",
    resultKey: { kind: "turn" as const, id: resultId },
    decisionKind,
    provenance: { source: "user" as const },
  };
}

describe("Coffice workspace model", () => {
  it("round-trips schema v12 with deterministic canonical serialization", () => {
    const workspace = seeded();
    const first = serializeCofficeWorkspace(workspace);
    const second = serializeCofficeWorkspace(
      parseSerializedCofficeWorkspace(first),
    );

    expect(second).toBe(first);
    expect(parseSerializedCofficeWorkspace(first)).toEqual(workspace);
    expect(first.endsWith("\n")).toBe(true);
  });

  it("allows a truthful result observation to predate Coffice association", () => {
    const completedBeforeLinking = project();
    const attempt =
      completedBeforeLinking.objectives[0].workItems[0].attempts[0];
    attempt.linkedAt = LATER;
    attempt.resultCycles[0].observedAt = NOW;

    const workspace = reduceCofficeWorkspace(
      createEmptyCofficeWorkspace(NOW),
      { type: "project.upsert", project: completedBeforeLinking },
      LATER,
    );
    expect(
      workspace.projects[0].objectives[0].workItems[0].attempts[0]
        .resultCycles[0],
    ).toMatchObject({ observedAt: NOW });
  });

  it("rejects future schemas, unknown fields, missing outcomes, and duplicate ids", () => {
    const valid = seeded();
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...valid, schemaVersion: 13 }),
      ),
    ).toThrow(/unsupported schema version/);
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...valid, surprise: true }),
      ),
    ).toThrow(/unknown field surprise/);

    const missingOutcome = structuredClone(valid);
    delete (
      missingOutcome.projects[0].objectives[0].workItems[0] as Partial<
        (typeof missingOutcome.projects)[0]["objectives"][0]["workItems"][0]
      >
    ).expectedOutcome;
    expect(() => serializeCofficeWorkspace(missingOutcome)).toThrow(
      /missing expectedOutcome/,
    );

    const duplicate = structuredClone(valid);
    duplicate.projects.push(structuredClone(duplicate.projects[0]));
    expect(() => serializeCofficeWorkspace(duplicate)).toThrow(/duplicate id/);

    const duplicateLink = structuredClone(valid);
    duplicateLink.projects[0].objectives[0].workItems.push({
      ...structuredClone(duplicateLink.projects[0].objectives[0].workItems[0]),
      id: "work-2",
    });
    expect(() => serializeCofficeWorkspace(duplicateLink)).toThrow(
      /Codex task codex-thread-1 has more than one open link/,
    );

    const duplicateResult = structuredClone(valid);
    const results =
      duplicateResult.projects[0].objectives[0].workItems[0].attempts[0]
        .resultCycles;
    results.push(structuredClone(results[0]));
    expect(() => serializeCofficeWorkspace(duplicateResult)).toThrow(
      /duplicate result key turn:turn-1/,
    );

    expect(() =>
      parseWorkspaceMutation({
        type: "result.review",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItemId: "work-1",
        attemptId: "attempt-1",
        resultKey: { kind: "turn", id: "../../unsafe" },
        reviewedAt: LATER,
      }),
    ).toThrow(/safe structural identifier/);
  });

  it("deterministically migrates strict schema v1 data to v12", () => {
    const current = seeded();
    const legacy = structuredClone(current) as unknown as Record<
      string,
      unknown
    >;
    legacy.schemaVersion = 1;
    delete legacy.verificationReceipts;
    delete legacy.reviewAssessments;
    delete legacy.projectDecisionEvents;
    delete legacy.decisionRequests;

    const first = parseSerializedCofficeWorkspace(JSON.stringify(legacy));
    const second = parseSerializedCofficeWorkspace(JSON.stringify(legacy));
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 12,
      verificationReceipts: [],
      reviewAssessments: [],
      projectDecisionEvents: [],
      decisionRequests: [],
    });
    expect(JSON.parse(serializeCofficeWorkspace(first))).toMatchObject({
      schemaVersion: 12,
      verificationReceipts: [],
      reviewAssessments: [],
      projectDecisionEvents: [],
      decisionRequests: [],
    });
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...legacy, verificationReceipts: [] }),
      ),
    ).toThrow(/unknown field verificationReceipts/);
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...legacy, reviewAssessments: [] }),
      ),
    ).toThrow(/unknown field reviewAssessments/);
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...legacy, projectDecisionEvents: [] }),
      ),
    ).toThrow(/unknown field projectDecisionEvents/);
  });

  it("strictly migrates schema v2 attempts as open links", () => {
    const legacy = structuredClone(seeded()) as unknown as Record<
      string,
      unknown
    >;
    legacy.schemaVersion = 2;
    delete legacy.reviewAssessments;
    delete legacy.projectDecisionEvents;
    delete legacy.decisionRequests;
    const migrated = parseSerializedCofficeWorkspace(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(12);
    expect(migrated.projectDecisionEvents).toEqual([]);
    expect(
      migrated.projects[0].objectives[0].workItems[0].attempts[0],
    ).not.toHaveProperty("unlinkedAt");
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...legacy, reviewAssessments: [] }),
      ),
    ).toThrow(/unknown field reviewAssessments/);
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...legacy, projectDecisionEvents: [] }),
      ),
    ).toThrow(/unknown field projectDecisionEvents/);

    const withV3Field = structuredClone(seeded());
    withV3Field.projects[0].objectives[0].workItems[0].attempts[0].unlinkedAt =
      LATER;
    const strictV2 = withV3Field as unknown as Record<string, unknown>;
    delete strictV2.reviewAssessments;
    delete strictV2.projectDecisionEvents;
    delete strictV2.decisionRequests;
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...strictV2, schemaVersion: 2 }),
      ),
    ).toThrow(/unknown field unlinkedAt/);
  });

  it("strictly migrates schema v3 by adding empty assessment and decision collections", () => {
    const legacy = structuredClone(seeded()) as unknown as Record<
      string,
      unknown
    >;
    legacy.schemaVersion = 3;
    delete legacy.reviewAssessments;
    delete legacy.projectDecisionEvents;
    delete legacy.decisionRequests;

    expect(
      parseSerializedCofficeWorkspace(JSON.stringify(legacy)),
    ).toMatchObject({
      schemaVersion: 12,
      reviewAssessments: [],
      projectDecisionEvents: [],
      decisionRequests: [],
    });
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...legacy, reviewAssessments: [] }),
      ),
    ).toThrow(/unknown field reviewAssessments/);
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...legacy, projectDecisionEvents: [] }),
      ),
    ).toThrow(/unknown field projectDecisionEvents/);
    const current = structuredClone(seeded()) as unknown as Record<
      string,
      unknown
    >;
    delete current.reviewAssessments;
    expect(() => parseCofficeWorkspace(current)).toThrow(
      /missing reviewAssessments/,
    );
    const missingDecisionEvents = structuredClone(
      seeded(),
    ) as unknown as Record<string, unknown>;
    delete missingDecisionEvents.projectDecisionEvents;
    expect(() => parseCofficeWorkspace(missingDecisionEvents)).toThrow(
      /missing projectDecisionEvents/,
    );
  });

  it("strictly migrates schema v4 by adding an empty project decision log", () => {
    const legacy = structuredClone(seeded()) as unknown as Record<
      string,
      unknown
    >;
    legacy.schemaVersion = 4;
    delete legacy.projectDecisionEvents;
    delete legacy.decisionRequests;

    expect(
      parseSerializedCofficeWorkspace(JSON.stringify(legacy)),
    ).toMatchObject({
      schemaVersion: 12,
      projectDecisionEvents: [],
      decisionRequests: [],
    });
    expect(() =>
      parseSerializedCofficeWorkspace(
        JSON.stringify({ ...legacy, projectDecisionEvents: [] }),
      ),
    ).toThrow(/unknown field projectDecisionEvents/);
  });

  it("keeps project decisions append-only with structural correction, replacement, and withdrawal history", () => {
    const base = withDestination();
    const preserved = {
      projects: structuredClone(base.projects),
      attentionReview: structuredClone(base.attentionReview),
      reviewAssessments: structuredClone(base.reviewAssessments),
      evidence: structuredClone(base.evidence),
      migrations: structuredClone(base.migrations),
      mutationReceipts: structuredClone(base.mutationReceipts),
      verificationReceipts: structuredClone(base.verificationReceipts),
    };
    const first = reduceCofficeWorkspace(
      base,
      {
        type: "projectDecision.record",
        id: "decision-first",
        projectId: "project-1",
        statement: "Use one local project decision log.",
        context: "Keep broader project choices separate from result decisions.",
      },
      LATER,
    );
    const second = reduceCofficeWorkspace(
      first,
      {
        type: "projectDecision.record",
        id: "decision-second",
        projectId: "project-1",
        statement: "Keep the office view minimal.",
      },
      THIRD,
    );
    const corrected = reduceCofficeWorkspace(
      second,
      {
        type: "projectDecision.supersede",
        id: "decision-first-correction",
        projectId: "project-1",
        supersedesId: "decision-first",
        supersessionKind: "correction",
        statement: "Use one private local project decision log.",
      },
      FOURTH,
    );
    const replaced = reduceCofficeWorkspace(
      corrected,
      {
        type: "projectDecision.supersede",
        id: "decision-first-replacement",
        projectId: "project-1",
        supersedesId: "decision-first-correction",
        supersessionKind: "replacement",
        statement: "Use an append-only private project decision log.",
      },
      FIFTH,
    );
    const withdrawn = reduceCofficeWorkspace(
      replaced,
      {
        type: "projectDecision.withdraw",
        id: "decision-second-withdrawal",
        projectId: "project-1",
        supersedesId: "decision-second",
        reason: "The visual rule moved to durable project guidance.",
      },
      SIXTH,
    );

    expect(first.projectDecisionEvents[0]).toEqual({
      id: "decision-first",
      projectId: "project-1",
      action: "recorded",
      statement: "Use one local project decision log.",
      context: "Keep broader project choices separate from result decisions.",
      recordedAt: LATER,
      authorship: "user",
    });
    expect(corrected.projectDecisionEvents.at(-1)).toMatchObject({
      action: "superseded",
      supersedesId: "decision-first",
      supersessionKind: "correction",
    });
    expect(replaced.projectDecisionEvents.at(-1)).toMatchObject({
      action: "superseded",
      supersedesId: "decision-first-correction",
      supersessionKind: "replacement",
    });
    expect(withdrawn.projectDecisionEvents.at(-1)).toMatchObject({
      action: "withdrawn",
      supersedesId: "decision-second",
    });
    expect(
      selectActiveProjectDecisions(
        second.projectDecisionEvents,
        "project-1",
      ).map((event) => event.id),
    ).toEqual(["decision-second", "decision-first"]);
    expect(
      selectActiveProjectDecisions(
        withdrawn.projectDecisionEvents,
        "project-1",
      ).map((event) => event.id),
    ).toEqual(["decision-first-replacement"]);
    expect(
      selectProjectDecisionHistory(
        withdrawn.projectDecisionEvents,
        "decision-first-replacement",
      ).map((event) => event.id),
    ).toEqual([
      "decision-first",
      "decision-first-correction",
      "decision-first-replacement",
    ]);
    expect(
      selectProjectDecisionEvents(withdrawn.projectDecisionEvents, "project-1"),
    ).toHaveLength(5);
    expect(withdrawn).toMatchObject(preserved);
  });

  it("rejects duplicate, branching, self, cross-project, stale-time, and malformed decision events", () => {
    const base = withDestination();
    const recorded = reduceCofficeWorkspace(
      base,
      {
        type: "projectDecision.record",
        id: "decision-head",
        projectId: "project-1",
        statement: "Keep this decision durable.",
      },
      THIRD,
    );
    expect(() =>
      reduceCofficeWorkspace(
        recorded,
        {
          type: "projectDecision.record",
          id: "decision-head",
          projectId: "project-1",
          statement: "Different content cannot reuse the same event ID.",
        },
        FOURTH,
      ),
    ).toThrow(/duplicate project decision event id/);
    expect(() =>
      parseCofficeWorkspace({
        ...recorded,
        projectDecisionEvents: [
          ...recorded.projectDecisionEvents,
          {
            ...recorded.projectDecisionEvents[0],
            statement: "Different serialized content with the same ID.",
          },
        ],
      }),
    ).toThrow(/duplicate id decision-head/);
    expect(() =>
      reduceCofficeWorkspace(
        recorded,
        {
          type: "projectDecision.supersede",
          id: "decision-self",
          projectId: "project-1",
          supersedesId: "decision-self",
          supersessionKind: "correction",
          statement: "A self-reference is invalid.",
        },
        FOURTH,
      ),
    ).toThrow(/cannot supersede itself/);
    expect(() =>
      reduceCofficeWorkspace(
        recorded,
        {
          type: "projectDecision.supersede",
          id: "decision-unknown-target",
          projectId: "project-1",
          supersedesId: "decision-missing",
          supersessionKind: "replacement",
          statement: "A replacement requires an existing current head.",
        },
        FOURTH,
      ),
    ).toThrow(/unknown project decision event/);
    expect(() =>
      reduceCofficeWorkspace(
        recorded,
        {
          type: "projectDecision.supersede",
          id: "decision-cross-project",
          projectId: "project-2",
          supersedesId: "decision-head",
          supersessionKind: "replacement",
          statement: "A decision cannot move between projects.",
        },
        FOURTH,
      ),
    ).toThrow(/same project/);
    expect(() =>
      reduceCofficeWorkspace(
        recorded,
        {
          type: "projectDecision.supersede",
          id: "decision-before-head",
          projectId: "project-1",
          supersedesId: "decision-head",
          supersessionKind: "correction",
          statement: "A correction cannot predate its target.",
        },
        LATER,
      ),
    ).toThrow(/cannot precede/);
    expect(() =>
      parseCofficeWorkspace({
        ...recorded,
        projectDecisionEvents: [
          ...recorded.projectDecisionEvents,
          {
            id: "decision-serialized-before-head",
            projectId: "project-1",
            action: "superseded",
            supersedesId: "decision-head",
            supersessionKind: "correction",
            statement: "Serialized history must also be chronological.",
            recordedAt: LATER,
            authorship: "user",
          },
        ],
      }),
    ).toThrow(/cannot precede/);

    const corrected = reduceCofficeWorkspace(
      recorded,
      {
        type: "projectDecision.supersede",
        id: "decision-correction",
        projectId: "project-1",
        supersedesId: "decision-head",
        supersessionKind: "correction",
        statement: "Keep the corrected decision durable.",
      },
      FOURTH,
    );
    expect(() =>
      reduceCofficeWorkspace(
        corrected,
        {
          type: "projectDecision.withdraw",
          id: "decision-branch",
          projectId: "project-1",
          supersedesId: "decision-head",
        },
        FIFTH,
      ),
    ).toThrow(/current decision head/);
    expect(() =>
      parseCofficeWorkspace({
        ...recorded,
        projectDecisionEvents: [
          ...recorded.projectDecisionEvents,
          {
            id: "decision-orphan",
            projectId: "missing-project",
            action: "recorded",
            statement: "This project does not exist.",
            recordedAt: FOURTH,
            authorship: "user",
          },
        ],
      }),
    ).toThrow(/targets unknown project/);
    expect(() =>
      parseWorkspaceMutation({
        type: "projectDecision.supersede",
        id: "decision-missing-kind",
        projectId: "project-1",
        supersedesId: "decision-head",
        statement: "The semantic kind cannot be inferred from this text.",
      }),
    ).toThrow(/missing supersessionKind/);
    expect(() =>
      parseWorkspaceMutation({
        type: "projectDecision.record",
        id: "decision-client-stamp",
        projectId: "project-1",
        statement: "Only the reducer may stamp authorship and time.",
        authorship: "user",
        recordedAt: FOURTH,
      }),
    ).toThrow(/unknown field/);
    expect(() =>
      parseWorkspaceMutation({
        type: "projectDecision.record",
        id: "decision-blank",
        projectId: "project-1",
        statement: "   ",
      }),
    ).toThrow(/meaningful text/);
    expect(() =>
      parseWorkspaceMutation({
        type: "projectDecision.record",
        id: "../unsafe",
        projectId: "project-1",
        statement: "Browser event IDs must be safe structural identifiers.",
      }),
    ).toThrow(/safe structural identifier/);
    expect(() =>
      reduceCofficeWorkspace(
        recorded,
        {
          type: "projectDecision.record",
          id: "decision-unknown-project",
          projectId: "missing-project",
          statement: "A project decision requires a live project record.",
        },
        FOURTH,
      ),
    ).toThrow(/unknown project/);
    expect(() =>
      parseWorkspaceMutation({
        type: "projectDecision.record",
        id: "decision-too-long",
        projectId: "project-1",
        statement: "x".repeat(MAX_PROJECT_DECISION_STATEMENT_LENGTH + 1),
      }),
    ).toThrow(/expected 1-/);
    expect(() =>
      parseWorkspaceMutation({
        type: "projectDecision.withdraw",
        id: "decision-reason-too-long",
        projectId: "project-1",
        supersedesId: "decision-head",
        reason: "x".repeat(MAX_PROJECT_DECISION_CONTEXT_LENGTH + 1),
      }),
    ).toThrow(/expected 1-/);
  });

  it("preserves decision history across generic updates and cascades it only on explicit project removal", () => {
    const emptyProject = (id: string): WorkspaceProject => ({
      id,
      title: id,
      createdAt: NOW,
      updatedAt: NOW,
      objectives: [],
    });
    let workspace = reduceCofficeWorkspace(
      createEmptyCofficeWorkspace(NOW),
      { type: "project.upsert", project: emptyProject("project-a") },
      NOW,
    );
    workspace = reduceCofficeWorkspace(
      workspace,
      { type: "project.upsert", project: emptyProject("project-b") },
      NOW,
    );
    workspace = reduceCofficeWorkspace(
      workspace,
      {
        type: "projectDecision.record",
        id: "decision-a",
        projectId: "project-a",
        statement: "Project A keeps this history.",
      },
      LATER,
    );
    workspace = reduceCofficeWorkspace(
      workspace,
      {
        type: "projectDecision.record",
        id: "decision-b",
        projectId: "project-b",
        statement: "Project B keeps this history.",
      },
      THIRD,
    );
    const updated = reduceCofficeWorkspace(
      workspace,
      {
        type: "project.upsert",
        project: { ...emptyProject("project-a"), title: "Renamed A" },
      },
      FOURTH,
    );
    expect(updated.projectDecisionEvents).toEqual(
      workspace.projectDecisionEvents,
    );

    const withObjective = reduceCofficeWorkspace(
      updated,
      {
        type: "objective.upsert",
        projectId: "project-a",
        objective: {
          id: "objective-a",
          title: "Objective A",
          status: "active",
          createdAt: FOURTH,
          updatedAt: FOURTH,
          workItems: [],
        },
      },
      FOURTH,
    );
    const withoutObjective = reduceCofficeWorkspace(
      withObjective,
      {
        type: "objective.remove",
        projectId: "project-a",
        objectiveId: "objective-a",
      },
      FIFTH,
    );
    expect(withoutObjective.projectDecisionEvents).toEqual(
      workspace.projectDecisionEvents,
    );

    const removed = reduceCofficeWorkspace(
      withoutObjective,
      { type: "project.remove", projectId: "project-a" },
      SIXTH,
    );
    expect(removed.projects.map((candidate) => candidate.id)).toEqual([
      "project-b",
    ]);
    expect(removed.projectDecisionEvents.map((event) => event.id)).toEqual([
      "decision-b",
    ]);
  });

  it("fails closed when the project decision history reaches its bounded capacity", () => {
    const workspace = seeded();
    const atCapacity = parseCofficeWorkspace({
      ...workspace,
      projectDecisionEvents: Array.from({ length: 4_096 }, (_, index) => ({
        id: `decision-${index}`,
        projectId: "project-1",
        action: "recorded",
        statement: `Decision ${index}`,
        recordedAt: LATER,
        authorship: "user",
      })),
    });
    expect(() =>
      reduceCofficeWorkspace(
        atCapacity,
        {
          type: "projectDecision.record",
          id: "decision-over-capacity",
          projectId: "project-1",
          statement: "This must not evict prior user-authored history.",
        },
        THIRD,
      ),
    ).toThrow(/limited to 4096 events/);
    expect(atCapacity.projectDecisionEvents).toHaveLength(4_096);
  });

  it("strictly parses bounded work-item reorder mutations", () => {
    const mutation = {
      type: "workItem.reorder" as const,
      projectId: "project-1",
      objectiveId: "objective-1",
      orderedWorkItemIds: ["work-3", "work-1", "work-2"],
    };
    expect(parseWorkspaceMutation(mutation)).toEqual(mutation);
    expect(() =>
      parseWorkspaceMutation({ ...mutation, privateNote: "hidden" }),
    ).toThrow(/unknown field privateNote/);
    expect(() =>
      parseWorkspaceMutation({
        ...mutation,
        orderedWorkItemIds: ["work-1", "work-1", "work-2"],
      }),
    ).toThrow(/duplicate work item id/);
    expect(() =>
      parseWorkspaceMutation({
        ...mutation,
        orderedWorkItemIds: "work-1",
      }),
    ).toThrow(/expected an array/);
    expect(() =>
      parseWorkspaceMutation({
        ...mutation,
        orderedWorkItemIds: [""],
      }),
    ).toThrow(/expected 1-160 characters/);
    expect(() =>
      parseWorkspaceMutation({
        ...mutation,
        orderedWorkItemIds: Array.from(
          { length: 1_025 },
          (_, index) => `work-${index}`,
        ),
      }),
    ).toThrow(/at most 1024 entries/);
  });

  it("requires an exact local work-item permutation", () => {
    const workspace = withThreeWorkItems();
    const reorder = (orderedWorkItemIds: string[]) =>
      reduceCofficeWorkspace(
        workspace,
        {
          type: "workItem.reorder",
          projectId: "project-1",
          objectiveId: "objective-1",
          orderedWorkItemIds,
        },
        FOURTH,
      );

    expect(() => reorder(["work-1", "work-2"])).toThrow(
      /expected every work item in this objective exactly once/,
    );
    expect(() => reorder(["work-1", "work-2", "work-elsewhere"])).toThrow(
      /expected every work item in this objective exactly once/,
    );
    expect(() => reorder(["work-1", "work-2", "work-2"])).toThrow(
      /duplicate work item id/,
    );
  });

  it("rejects work-item sequence bypasses through objective upsert", () => {
    const workspace = withThreeWorkItems();
    const objective = workspace.projects[0].objectives[0];
    const upsert = (workItems: Objective["workItems"]) =>
      reduceCofficeWorkspace(
        workspace,
        {
          type: "objective.upsert",
          projectId: "project-1",
          objective: { ...objective, workItems },
        },
        FOURTH,
      );
    const sequenceError =
      /work-item sequence can change only through dedicated work-item mutations/;

    expect(() =>
      upsert([
        objective.workItems[2],
        objective.workItems[0],
        objective.workItems[1],
      ]),
    ).toThrow(sequenceError);
    expect(() => upsert(objective.workItems.slice(0, 2))).toThrow(
      sequenceError,
    );
    expect(() =>
      upsert([...objective.workItems, outcomeWorkItem("work-4", FOURTH)]),
    ).toThrow(sequenceError);

    const metadataUpdate = reduceCofficeWorkspace(
      workspace,
      {
        type: "objective.upsert",
        projectId: "project-1",
        objective: { ...objective, title: "Updated objective metadata" },
      },
      FOURTH,
    );
    expect(metadataUpdate.projects[0].objectives[0].title).toBe(
      "Updated objective metadata",
    );
    const withNewObjective = reduceCofficeWorkspace(
      workspace,
      {
        type: "objective.upsert",
        projectId: "project-1",
        objective: {
          id: "objective-new",
          title: "A new objective",
          status: "active",
          createdAt: FOURTH,
          updatedAt: FOURTH,
          workItems: [outcomeWorkItem("work-new", FOURTH)],
        },
      },
      FOURTH,
    );
    expect(withNewObjective.projects[0].objectives[1].workItems).toHaveLength(
      1,
    );
  });

  it("rejects work-item sequence bypasses through project upsert", () => {
    const workspace = withThreeWorkItems();
    const project = workspace.projects[0];
    const objective = project.objectives[0];
    const upsert = (workItems: Objective["workItems"]) =>
      reduceCofficeWorkspace(
        workspace,
        {
          type: "project.upsert",
          project: {
            ...project,
            objectives: [{ ...objective, workItems }],
          },
        },
        FOURTH,
      );
    const sequenceError =
      /work-item sequence can change only through dedicated work-item mutations/;

    expect(() =>
      upsert([
        objective.workItems[1],
        objective.workItems[2],
        objective.workItems[0],
      ]),
    ).toThrow(sequenceError);
    expect(() => upsert(objective.workItems.slice(1))).toThrow(sequenceError);
    expect(() =>
      upsert([...objective.workItems, outcomeWorkItem("work-4", FOURTH)]),
    ).toThrow(sequenceError);

    const metadataUpdate = reduceCofficeWorkspace(
      workspace,
      {
        type: "project.upsert",
        project: { ...project, title: "Updated project metadata" },
      },
      FOURTH,
    );
    expect(metadataUpdate.projects[0].title).toBe("Updated project metadata");
    const withNewObjective = reduceCofficeWorkspace(
      workspace,
      {
        type: "project.upsert",
        project: {
          ...project,
          objectives: [
            ...project.objectives,
            {
              id: "objective-new",
              title: "A new objective",
              status: "active",
              createdAt: FOURTH,
              updatedAt: FOURTH,
              workItems: [outcomeWorkItem("work-new", FOURTH)],
            },
          ],
        },
      },
      FOURTH,
    );
    expect(withNewObjective.projects[0].objectives[1].workItems).toHaveLength(
      1,
    );
  });

  it("reorders outcome work items without rewriting their durable history", () => {
    let workspace = withThreeWorkItems();
    workspace = reduceCofficeWorkspace(
      workspace,
      {
        type: "result.review",
        ...SOURCE_LINK,
        resultKey: { kind: "turn", id: "turn-1" },
        reviewedAt: THIRD,
      },
      THIRD,
    );
    workspace = reduceCofficeWorkspace(
      workspace,
      {
        type: "result.decide",
        ...SOURCE_LINK,
        resultKey: { kind: "turn", id: "turn-1" },
        decision: { kind: "accepted", decidedAt: FOURTH },
        evidence: decisionEvidence(
          "decision-before-reorder",
          "turn-1",
          FOURTH,
          "accepted",
        ),
      },
      FOURTH,
    );
    workspace = reduceCofficeWorkspace(
      workspace,
      {
        type: "assessment.set",
        assessment: {
          target: RESULT_ASSESSMENT_TARGET,
          reviewSummary: "Keep this exact-result assessment with its outcome.",
          risks: [],
          uncertainties: [],
          blockedDecisions: [],
        },
      },
      FIFTH,
    );
    const verification = createVerificationReceipt(
      parseVerificationStartRequest({
        id: "verification-before-reorder",
        idempotencyKey: "verification-before-reorder-request",
        target: {
          ...SOURCE_LINK,
          resultKey: { kind: "turn", id: "turn-1" },
        },
        profile: { id: "test", version: "1" },
        checks: [{ id: "test", version: "1" }],
      }),
      "a".repeat(64),
      FIFTH,
    );
    workspace = parseCofficeWorkspace({
      ...workspace,
      attentionReview: {
        ...workspace.attentionReview,
        dispositions: {
          "turn:turn-1": { kind: "reviewed", at: FIFTH },
        },
      },
      migrations: { attentionReviewV2ImportedAt: NOW },
      mutationReceipts: [
        {
          id: "history-before-reorder",
          hash: "b".repeat(64),
          revision: workspace.revision,
          appliedAt: FIFTH,
        },
      ],
      verificationReceipts: [verification],
    });
    const beforeItems = new Map(
      structuredClone(workspace.projects[0].objectives[0].workItems).map(
        (workItem) => [workItem.id, workItem],
      ),
    );
    const preserved = {
      attentionReview: structuredClone(workspace.attentionReview),
      reviewAssessments: structuredClone(workspace.reviewAssessments),
      projectDecisionEvents: structuredClone(workspace.projectDecisionEvents),
      evidence: structuredClone(workspace.evidence),
      migrations: structuredClone(workspace.migrations),
      mutationReceipts: structuredClone(workspace.mutationReceipts),
      verificationReceipts: structuredClone(workspace.verificationReceipts),
    };

    const reordered = reduceCofficeWorkspace(
      workspace,
      {
        type: "workItem.reorder",
        projectId: "project-1",
        objectiveId: "objective-1",
        orderedWorkItemIds: ["work-3", "work-1", "work-2"],
      },
      SIXTH,
    );
    const reorderedObjective = reordered.projects[0].objectives[0];
    expect(reordered.schemaVersion).toBe(12);
    expect(reorderedObjective.workItems.map((workItem) => workItem.id)).toEqual(
      ["work-3", "work-1", "work-2"],
    );
    for (const workItem of reorderedObjective.workItems) {
      expect(workItem).toEqual(beforeItems.get(workItem.id));
    }
    expect(reordered.projects[0].updatedAt).toBe(SIXTH);
    expect(reorderedObjective.updatedAt).toBe(SIXTH);
    expect(reordered).toMatchObject(preserved);
    expect(
      parseSerializedCofficeWorkspace(
        serializeCofficeWorkspace(reordered),
      ).projects[0].objectives[0].workItems.map((workItem) => workItem.id),
    ).toEqual(["work-3", "work-1", "work-2"]);
  });

  it("strictly parses meaningful bounded assessment mutations", () => {
    const valid = {
      type: "assessment.set" as const,
      assessment: {
        target: RESULT_ASSESSMENT_TARGET,
        reviewSummary: "The result is directionally correct.",
        risks: ["The fallback path has not been exercised."],
        uncertainties: [],
        blockedDecisions: [],
        nextAction: {
          kind: "run_quality_check" as const,
          note: "Run the focused browser check.",
        },
      },
    };
    expect(parseWorkspaceMutation(valid)).toEqual(valid);
    expect(
      parseWorkspaceMutation({
        type: "assessment.clear",
        target: WORK_ASSESSMENT_TARGET,
      }),
    ).toEqual({
      type: "assessment.clear",
      target: WORK_ASSESSMENT_TARGET,
    });
    expect(() =>
      parseWorkspaceMutation({
        ...valid,
        assessment: { ...valid.assessment, authorship: "user" },
      }),
    ).toThrow(/unknown field authorship/);
    expect(() =>
      parseWorkspaceMutation({
        ...valid,
        assessment: {
          ...valid.assessment,
          target: {
            ...WORK_ASSESSMENT_TARGET,
            attemptId: "attempt-1",
          },
        },
      }),
    ).toThrow(/missing resultKey/);
    expect(() =>
      parseWorkspaceMutation({
        type: "assessment.set",
        assessment: {
          target: WORK_ASSESSMENT_TARGET,
          risks: [],
          uncertainties: [],
          blockedDecisions: [],
        },
      }),
    ).toThrow(/at least one meaningful assessment field/);
    expect(() =>
      parseWorkspaceMutation({
        type: "assessment.set",
        assessment: {
          target: WORK_ASSESSMENT_TARGET,
          reviewSummary: "   ",
          risks: [],
          uncertainties: [],
          blockedDecisions: [],
        },
      }),
    ).toThrow(/expected meaningful text/);
    expect(() =>
      parseWorkspaceMutation({
        ...valid,
        assessment: {
          ...valid.assessment,
          risks: Array.from(
            { length: MAX_REVIEW_ASSESSMENT_LIST_ENTRIES + 1 },
            () => "risk",
          ),
        },
      }),
    ).toThrow(/at most 64 entries/);
    expect(() =>
      parseWorkspaceMutation({
        ...valid,
        assessment: {
          ...valid.assessment,
          reviewSummary: "x".repeat(MAX_REVIEW_ASSESSMENT_TEXT_LENGTH + 1),
        },
      }),
    ).toThrow(/expected 1-2000 characters/);
    expect(() =>
      parseWorkspaceMutation({
        ...valid,
        assessment: {
          ...valid.assessment,
          reviewSummary: "x".repeat(MAX_REVIEW_ASSESSMENT_TEXT_LENGTH),
          risks: Array.from({ length: 8 }, () =>
            "x".repeat(MAX_REVIEW_ASSESSMENT_TEXT_LENGTH),
          ),
        },
      }),
    ).toThrow(
      new RegExp(
        `assessment text exceeds ${MAX_REVIEW_ASSESSMENT_TOTAL_TEXT_LENGTH} characters`,
      ),
    );
    expect(() =>
      parseWorkspaceMutation({
        ...valid,
        assessment: {
          ...valid.assessment,
          nextAction: { kind: "execute_without_review" },
        },
      }),
    ).toThrow(/expected one of/);
  });

  it("sets, updates, and clears unique assessments without workflow side effects", () => {
    const before = seeded();
    const workflowState = {
      projects: structuredClone(before.projects),
      attentionReview: structuredClone(before.attentionReview),
      evidence: structuredClone(before.evidence),
      migrations: structuredClone(before.migrations),
      verificationReceipts: structuredClone(before.verificationReceipts),
    };
    const withWorkAssessment = reduceCofficeWorkspace(
      before,
      {
        type: "assessment.set",
        assessment: {
          target: WORK_ASSESSMENT_TARGET,
          reviewSummary: "The work item needs one final review pass.",
          risks: ["The error path is not demonstrated."],
          uncertainties: [],
          blockedDecisions: [],
        },
      },
      LATER,
    );
    expect(withWorkAssessment.reviewAssessments).toEqual([
      {
        target: WORK_ASSESSMENT_TARGET,
        authorship: "user",
        reviewSummary: "The work item needs one final review pass.",
        risks: ["The error path is not demonstrated."],
        uncertainties: [],
        blockedDecisions: [],
        updatedAt: LATER,
      },
    ]);

    const withBothScopes = reduceCofficeWorkspace(
      withWorkAssessment,
      {
        type: "assessment.set",
        assessment: {
          target: RESULT_ASSESSMENT_TARGET,
          risks: [],
          uncertainties: ["The live environment may differ."],
          blockedDecisions: [],
          nextAction: { kind: "accept_result" },
        },
      },
      THIRD,
    );
    expect(withBothScopes.reviewAssessments).toHaveLength(2);
    expect(
      selectReviewAssessment(
        withBothScopes.reviewAssessments,
        RESULT_ASSESSMENT_TARGET,
      ),
    ).toMatchObject({
      authorship: "user",
      updatedAt: THIRD,
      nextAction: { kind: "accept_result" },
    });

    const updated = reduceCofficeWorkspace(
      withBothScopes,
      {
        type: "assessment.set",
        assessment: {
          target: WORK_ASSESSMENT_TARGET,
          risks: [],
          uncertainties: [],
          blockedDecisions: ["Choose the fallback behavior."],
          nextAction: { kind: "send_follow_up", note: "Ask for the choice." },
        },
      },
      FOURTH,
    );
    expect(updated.reviewAssessments).toHaveLength(2);
    expect(
      selectReviewAssessment(updated.reviewAssessments, WORK_ASSESSMENT_TARGET),
    ).toMatchObject({
      blockedDecisions: ["Choose the fallback behavior."],
      updatedAt: FOURTH,
    });
    expect(updated).toMatchObject(workflowState);

    const cleared = reduceCofficeWorkspace(
      updated,
      { type: "assessment.clear", target: WORK_ASSESSMENT_TARGET },
      FIFTH,
    );
    expect(cleared.reviewAssessments).toHaveLength(1);
    expect(
      selectReviewAssessment(cleared.reviewAssessments, WORK_ASSESSMENT_TARGET),
    ).toBeUndefined();
    const repeatedClear = reduceCofficeWorkspace(
      cleared,
      { type: "assessment.clear", target: WORK_ASSESSMENT_TARGET },
      FIFTH,
    );
    expect(repeatedClear.reviewAssessments).toEqual(cleared.reviewAssessments);
    expect(repeatedClear).toMatchObject(workflowState);
  });

  it("requires an exact existing work-item or result target", () => {
    expect(() =>
      reduceCofficeWorkspace(
        seeded(),
        {
          type: "assessment.set",
          assessment: {
            target: { ...WORK_ASSESSMENT_TARGET, workItemId: "missing" },
            reviewSummary: "Cannot attach this.",
            risks: [],
            uncertainties: [],
            blockedDecisions: [],
          },
        },
        LATER,
      ),
    ).toThrow(/unknown work item missing/);
    expect(() =>
      reduceCofficeWorkspace(
        seeded(),
        {
          type: "assessment.set",
          assessment: {
            target: { ...RESULT_ASSESSMENT_TARGET, attemptId: "missing" },
            risks: ["Cannot attach this."],
            uncertainties: [],
            blockedDecisions: [],
          },
        },
        LATER,
      ),
    ).toThrow(/unknown attempt missing/);
    expect(() =>
      reduceCofficeWorkspace(
        seeded(),
        {
          type: "assessment.clear",
          target: {
            ...RESULT_ASSESSMENT_TARGET,
            resultKey: { kind: "turn", id: "missing" },
          },
        },
        LATER,
      ),
    ).toThrow(/unknown result turn:missing/);
  });

  it("rejects duplicate assessment targets and bounded collection overflow", () => {
    const assessed = reduceCofficeWorkspace(
      seeded(),
      {
        type: "assessment.set",
        assessment: {
          target: WORK_ASSESSMENT_TARGET,
          reviewSummary: "Review recorded.",
          risks: [],
          uncertainties: [],
          blockedDecisions: [],
        },
      },
      LATER,
    );
    expect(() =>
      parseCofficeWorkspace({
        ...assessed,
        reviewAssessments: [
          assessed.reviewAssessments[0],
          structuredClone(assessed.reviewAssessments[0]),
        ],
      }),
    ).toThrow(/duplicate assessment target/);
    expect(() =>
      parseCofficeWorkspace({
        ...assessed,
        reviewAssessments: [
          { ...assessed.reviewAssessments[0], authorship: "codex" },
        ],
      }),
    ).toThrow(/expected one of user/);
    expect(() =>
      parseCofficeWorkspace({
        ...assessed,
        reviewAssessments: [
          { ...assessed.reviewAssessments[0], internalPrompt: "private" },
        ],
      }),
    ).toThrow(/unknown field internalPrompt/);
    expect(() =>
      parseCofficeWorkspace({
        ...assessed,
        reviewAssessments: Array.from(
          { length: 4_097 },
          () => assessed.reviewAssessments[0],
        ),
      }),
    ).toThrow(/at most 4096 entries/);
  });

  it("keeps exact-result assessments at their historical source across task moves", () => {
    const assessed = reduceCofficeWorkspace(
      seeded(),
      {
        type: "assessment.set",
        assessment: {
          target: RESULT_ASSESSMENT_TARGET,
          reviewSummary: "The first result needs a focused follow-up.",
          risks: [],
          uncertainties: ["The continuation may change the outcome."],
          blockedDecisions: [],
        },
      },
      LATER,
    );
    const moved = reduceCofficeWorkspace(
      withDestination(assessed),
      {
        type: "taskLink.move",
        codexTaskId: "codex-thread-1",
        from: SOURCE_LINK,
        to: DESTINATION_LINK,
        movedAt: THIRD,
        baselineResultKey: { kind: "turn", id: "turn-1" },
      },
      THIRD,
    );
    expect(moved.reviewAssessments).toHaveLength(1);
    expect(moved.reviewAssessments[0].target).toEqual(RESULT_ASSESSMENT_TARGET);
    expect(
      selectReviewAssessment(moved.reviewAssessments, {
        projectId: "project-2",
        objectiveId: "objective-2",
        workItemId: "work-2",
        attemptId: "attempt-2",
        resultKey: { kind: "turn", id: "turn-1" },
      }),
    ).toBeUndefined();

    const historicalEdit = reduceCofficeWorkspace(
      moved,
      {
        type: "assessment.set",
        assessment: {
          target: RESULT_ASSESSMENT_TARGET,
          risks: ["The historical fallback was not tested."],
          uncertainties: [],
          blockedDecisions: [],
          nextAction: { kind: "send_follow_up" },
        },
      },
      FOURTH,
    );
    expect(historicalEdit.reviewAssessments[0]).toMatchObject({
      target: RESULT_ASSESSMENT_TARGET,
      updatedAt: FOURTH,
    });

    const withNewResult = reduceCofficeWorkspace(
      historicalEdit,
      {
        type: "result.upsert",
        projectId: "project-2",
        objectiveId: "objective-2",
        workItemId: "work-2",
        attemptId: "attempt-2",
        result: {
          key: { kind: "turn", id: "turn-2" },
          observedAt: FIFTH,
        },
      },
      FIFTH,
    );
    expect(withNewResult.reviewAssessments).toHaveLength(1);
    expect(
      selectReviewAssessment(withNewResult.reviewAssessments, {
        projectId: "project-2",
        objectiveId: "objective-2",
        workItemId: "work-2",
        attemptId: "attempt-2",
        resultKey: { kind: "turn", id: "turn-2" },
      }),
    ).toBeUndefined();
  });

  it("requires an explicit clear before structural changes can orphan notes", () => {
    const planningProject: WorkspaceProject = {
      id: "planning-project",
      title: "Planning",
      createdAt: NOW,
      updatedAt: NOW,
      objectives: [
        {
          id: "planning-objective",
          title: "Plan safely",
          status: "active",
          createdAt: NOW,
          updatedAt: NOW,
          workItems: [
            {
              id: "planning-work",
              title: "Write the plan",
              expectedOutcome: "The plan is reviewable.",
              status: "planned",
              createdAt: NOW,
              updatedAt: NOW,
              attempts: [],
            },
          ],
        },
      ],
    };
    const target = {
      projectId: "planning-project",
      objectiveId: "planning-objective",
      workItemId: "planning-work",
    };
    const planned = reduceCofficeWorkspace(
      createEmptyCofficeWorkspace(NOW),
      { type: "project.upsert", project: planningProject },
      NOW,
    );
    const assessed = reduceCofficeWorkspace(
      planned,
      {
        type: "assessment.set",
        assessment: {
          target,
          reviewSummary:
            "Keep this note until the work is intentionally removed.",
          risks: [],
          uncertainties: [],
          blockedDecisions: [],
        },
      },
      LATER,
    );
    const expectClearFirst = (
      mutation: Parameters<typeof reduceCofficeWorkspace>[1],
    ) =>
      expect(() => reduceCofficeWorkspace(assessed, mutation, THIRD)).toThrow(
        /clear a review assessment before removing or replacing its target/,
      );

    expectClearFirst({
      type: "workItem.remove",
      projectId: target.projectId,
      objectiveId: target.objectiveId,
      workItemId: target.workItemId,
    });
    expectClearFirst({
      type: "objective.remove",
      projectId: target.projectId,
      objectiveId: target.objectiveId,
    });
    expectClearFirst({ type: "project.remove", projectId: target.projectId });
    expectClearFirst({
      type: "objective.upsert",
      projectId: target.projectId,
      objective: { ...planningProject.objectives[0], workItems: [] },
    });
    expectClearFirst({
      type: "project.upsert",
      project: { ...planningProject, objectives: [] },
    });

    const resultAssessed = reduceCofficeWorkspace(
      seeded(),
      {
        type: "assessment.set",
        assessment: {
          target: RESULT_ASSESSMENT_TARGET,
          risks: ["Preserve the exact-result note."],
          uncertainties: [],
          blockedDecisions: [],
        },
      },
      LATER,
    );
    const resultWorkItem =
      resultAssessed.projects[0].objectives[0].workItems[0];
    expect(() =>
      reduceCofficeWorkspace(
        resultAssessed,
        {
          type: "workItem.upsert",
          projectId: "project-1",
          objectiveId: "objective-1",
          workItem: { ...resultWorkItem, attempts: [] },
        },
        THIRD,
      ),
    ).toThrow(
      /clear a review assessment before removing or replacing its target/,
    );

    const cleared = reduceCofficeWorkspace(
      assessed,
      { type: "assessment.clear", target },
      THIRD,
    );
    const removed = reduceCofficeWorkspace(
      cleared,
      {
        type: "workItem.remove",
        projectId: target.projectId,
        objectiveId: target.objectiveId,
        workItemId: target.workItemId,
      },
      FOURTH,
    );
    expect(removed.reviewAssessments).toEqual([]);
    expect(removed.projects[0].objectives[0].workItems).toEqual([]);
  });

  it("moves a task atomically without rewriting historical results or verification receipts", () => {
    const base = withDestination();
    const request = parseVerificationStartRequest({
      id: "verification-moved",
      idempotencyKey: "verification-moved-request",
      target: {
        ...SOURCE_LINK,
        resultKey: { kind: "turn", id: "turn-1" },
      },
      profile: { id: "test", version: "1" },
      checks: [{ id: "test", version: "1" }],
    });
    const queued = createVerificationReceipt(request, "c".repeat(64), LATER);
    const running = transitionVerificationReceipt(
      queued,
      { check: { id: "test", version: "1" }, state: "running" },
      THIRD,
    );
    const passed = transitionVerificationReceipt(
      running,
      { check: { id: "test", version: "1" }, state: "passed" },
      FOURTH,
    );
    const before = parseCofficeWorkspace({
      ...base,
      verificationReceipts: [passed],
    });
    const historicalResult = structuredClone(
      before.projects[0].objectives[0].workItems[0].attempts[0].resultCycles,
    );
    const historicalReceipt = structuredClone(before.verificationReceipts[0]);

    const moved = reduceCofficeWorkspace(
      before,
      {
        type: "taskLink.move",
        codexTaskId: "codex-thread-1",
        from: SOURCE_LINK,
        to: DESTINATION_LINK,
        movedAt: FIFTH,
        baselineResultKey: { kind: "turn", id: "turn-1" },
      },
      FIFTH,
    );
    const source = moved.projects[0].objectives[0].workItems[0];
    const destination = moved.projects[1].objectives[0].workItems[0];
    expect(source.status).toBe("ready_for_review");
    expect(destination.status).toBe("planned");
    expect(source.attempts[0]).toMatchObject({ unlinkedAt: FIFTH });
    expect(source.attempts[0].resultCycles).toEqual(historicalResult);
    expect(destination.attempts).toEqual([
      {
        id: "attempt-2",
        codexTaskId: "codex-thread-1",
        relationship: "continuation",
        linkedAt: FIFTH,
        observeResultsAfterKey: { kind: "turn", id: "turn-1" },
        resultCycles: [],
      },
    ]);
    expect(moved.verificationReceipts[0]).toEqual(historicalReceipt);
  });

  it("keeps historical decisions and their exact evidence at the source after a move", () => {
    const reviewed = reduceCofficeWorkspace(
      seeded(),
      {
        type: "result.review",
        ...SOURCE_LINK,
        resultKey: { kind: "turn", id: "turn-1" },
        reviewedAt: LATER,
      },
      LATER,
    );
    const decided = reduceCofficeWorkspace(
      reviewed,
      {
        type: "result.decide",
        ...SOURCE_LINK,
        resultKey: { kind: "turn", id: "turn-1" },
        decision: { kind: "accepted", decidedAt: THIRD },
        evidence: decisionEvidence(
          "decision-before-move",
          "turn-1",
          THIRD,
          "accepted",
        ),
      },
      THIRD,
    );
    const before = withDestination(decided);
    const evidence = structuredClone(before.evidence);
    const moved = reduceCofficeWorkspace(
      before,
      {
        type: "taskLink.move",
        codexTaskId: "codex-thread-1",
        from: SOURCE_LINK,
        to: DESTINATION_LINK,
        movedAt: FOURTH,
      },
      FOURTH,
    );
    expect(moved.evidence).toEqual(evidence);
    expect(moved.evidence[0]).toMatchObject({
      projectId: "project-1",
      attemptId: "attempt-1",
      decisionKind: "accepted",
    });
    expect(
      moved.projects[0].objectives[0].workItems[0].attempts[0].resultCycles[0]
        .review?.decision,
    ).toMatchObject({ kind: "accepted" });
  });

  it("unlinks only the active segment and can later resume from the latest closed segment", () => {
    const base = withDestination();
    const unlinked = reduceCofficeWorkspace(
      base,
      {
        type: "taskLink.unlink",
        codexTaskId: "codex-thread-1",
        from: SOURCE_LINK,
        unlinkedAt: LATER,
      },
      LATER,
    );
    expect(
      unlinked.projects[0].objectives[0].workItems[0].attempts[0].unlinkedAt,
    ).toBe(LATER);

    const resumed = reduceCofficeWorkspace(
      unlinked,
      {
        type: "taskLink.move",
        codexTaskId: "codex-thread-1",
        from: SOURCE_LINK,
        to: DESTINATION_LINK,
        movedAt: THIRD,
      },
      THIRD,
    );
    expect(
      resumed.projects[0].objectives[0].workItems[0].attempts[0].unlinkedAt,
    ).toBe(LATER);
    expect(
      resumed.projects[1].objectives[0].workItems[0].attempts[0],
    ).toMatchObject({
      relationship: "continuation",
      linkedAt: THIRD,
    });
    expect(() =>
      reduceCofficeWorkspace(
        resumed,
        {
          type: "taskLink.unlink",
          codexTaskId: "codex-thread-1",
          from: SOURCE_LINK,
          unlinkedAt: FOURTH,
        },
        FOURTH,
      ),
    ).toThrow(/already closed/);
  });

  it("rejects unsafe move destinations and active source verification", () => {
    expect(() =>
      reduceCofficeWorkspace(
        withDestination(seeded(), "ready_for_review"),
        {
          type: "taskLink.move",
          codexTaskId: "codex-thread-1",
          from: SOURCE_LINK,
          to: DESTINATION_LINK,
          movedAt: LATER,
        },
        LATER,
      ),
    ).toThrow(/destination work item is not open/);

    const base = withDestination();
    const request = parseVerificationStartRequest({
      id: "verification-active",
      idempotencyKey: "verification-active-request",
      target: {
        ...SOURCE_LINK,
        resultKey: { kind: "turn", id: "turn-1" },
      },
      profile: { id: "test", version: "1" },
      checks: [{ id: "test", version: "1" }],
    });
    const active = parseCofficeWorkspace({
      ...base,
      verificationReceipts: [
        createVerificationReceipt(request, "d".repeat(64), LATER),
      ],
    });
    expect(() =>
      reduceCofficeWorkspace(
        active,
        {
          type: "taskLink.move",
          codexTaskId: "codex-thread-1",
          from: SOURCE_LINK,
          to: DESTINATION_LINK,
          movedAt: THIRD,
        },
        THIRD,
      ),
    ).toThrow(/active verification must finish or be cancelled/);
    expect(() =>
      reduceCofficeWorkspace(
        active,
        {
          type: "taskLink.unlink",
          codexTaskId: "codex-thread-1",
          from: SOURCE_LINK,
          unlinkedAt: THIRD,
        },
        THIRD,
      ),
    ).toThrow(/active verification must finish or be cancelled/);
  });

  it("rejects overlapping link segments and malformed move envelopes", () => {
    const moved = reduceCofficeWorkspace(
      withDestination(),
      {
        type: "taskLink.move",
        codexTaskId: "codex-thread-1",
        from: SOURCE_LINK,
        to: DESTINATION_LINK,
        movedAt: LATER,
      },
      LATER,
    );
    const overlapping = structuredClone(moved);
    overlapping.projects[0].objectives[0].workItems[0].attempts[0].unlinkedAt =
      THIRD;
    expect(() => parseCofficeWorkspace(overlapping)).toThrow(
      /has overlapping links/,
    );
    expect(() =>
      parseWorkspaceMutation({
        type: "taskLink.move",
        codexTaskId: "codex-thread-1",
        from: SOURCE_LINK,
        to: DESTINATION_LINK,
        movedAt: LATER,
        root: "private",
      }),
    ).toThrow(/unknown field root/);
    expect(() =>
      parseWorkspaceMutation({
        type: "taskLink.unlink",
        codexTaskId: "../unsafe",
        from: SOURCE_LINK,
        unlinkedAt: LATER,
      }),
    ).toThrow(/safe structural identifier/);
  });

  it("keeps closed links immutable and admits only new structural result keys", () => {
    const moved = reduceCofficeWorkspace(
      withDestination(),
      {
        type: "taskLink.move",
        codexTaskId: "codex-thread-1",
        from: SOURCE_LINK,
        to: DESTINATION_LINK,
        movedAt: LATER,
        baselineResultKey: { kind: "turn", id: "turn-baseline" },
      },
      LATER,
    );
    const observe = (attemptId: string, id: string, observedAt: string) =>
      reduceCofficeWorkspace(
        moved,
        {
          type: "result.upsert",
          projectId: attemptId === "attempt-1" ? "project-1" : "project-2",
          objectiveId:
            attemptId === "attempt-1" ? "objective-1" : "objective-2",
          workItemId: attemptId === "attempt-1" ? "work-1" : "work-2",
          attemptId,
          result: { key: { kind: "turn", id }, observedAt },
        },
        THIRD,
      );
    expect(() => observe("attempt-1", "turn-late", THIRD)).toThrow(
      /closed task link/,
    );
    expect(() => observe("attempt-2", "turn-baseline", THIRD)).toThrow(
      /cannot repeat its baseline result/,
    );
    expect(() => observe("attempt-2", "turn-1", THIRD)).toThrow(
      /can be recorded only once across links/,
    );
    expect(observe("attempt-2", "turn-new", NOW)).toMatchObject({
      projects: [
        {},
        {
          objectives: [
            {
              workItems: [
                {
                  status: "ready_for_review",
                  attempts: [{ resultCycles: [{ key: { id: "turn-new" } }] }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("rejects a repeated result key across serialized task-link segments", () => {
    const moved = reduceCofficeWorkspace(
      withDestination(),
      {
        type: "taskLink.move",
        codexTaskId: "codex-thread-1",
        from: SOURCE_LINK,
        to: DESTINATION_LINK,
        movedAt: LATER,
      },
      LATER,
    );
    const forged = structuredClone(moved);
    forged.projects[1].objectives[0].workItems[0].attempts[0].resultCycles = [
      {
        key: { kind: "turn", id: "turn-1" },
        observedAt: THIRD,
      },
    ];
    expect(() => parseCofficeWorkspace(forged)).toThrow(
      /repeats result key turn:turn-1 across links/,
    );
  });

  it("prevents generic upserts from replacing or bypassing task-link history", () => {
    const current = seeded();
    const item = current.projects[0].objectives[0].workItems[0];
    expect(() =>
      reduceCofficeWorkspace(
        current,
        {
          type: "workItem.upsert",
          projectId: "project-1",
          objectiveId: "objective-1",
          workItem: {
            ...item,
            attempts: [
              ...item.attempts,
              {
                id: "attempt-extra",
                codexTaskId: "another-task",
                relationship: "alternative",
                linkedAt: LATER,
                resultCycles: [],
              },
            ],
          },
        },
        LATER,
      ),
    ).toThrow(/cannot replace, remove, reorder, or append task links/);
    expect(() =>
      reduceCofficeWorkspace(
        current,
        {
          type: "attempt.upsert",
          projectId: "project-1",
          objectiveId: "objective-1",
          workItemId: "work-1",
          attempt: { ...item.attempts[0], relationship: "retry" },
        },
        LATER,
      ),
    ).toThrow(/cannot replace, remove, or reorder task-link history/);
  });

  it("strictly validates bounded verification requests and keeps them out of client mutations", () => {
    const request = {
      id: "verification-1",
      idempotencyKey: "verify-request-1",
      target: {
        projectId: "project-1",
        objectiveId: "objective-1",
        workItemId: "work-1",
        attemptId: "attempt-1",
        resultKey: { kind: "turn" as const, id: "turn-1" },
      },
      profile: { id: "focused", version: "1" },
      checks: [{ id: "unit", version: "1" }],
    };
    expect(parseVerificationStartRequest(request)).toEqual(request);
    expect(() =>
      parseVerificationStartRequest({ ...request, output: "private" }),
    ).toThrow(/unknown field output/);
    expect(() =>
      parseVerificationStartRequest({
        ...request,
        checks: Array.from({ length: 65 }, (_, index) => ({
          id: `check-${index}`,
          version: "1",
        })),
      }),
    ).toThrow(/at most 64 entries/);
    expect(() =>
      parseWorkspaceMutation({ type: "verification.start", ...request }),
    ).toThrow(/unsupported mutation verification.start/);
  });

  it("requires every receipt to identify an exact live result and rejects private fields", () => {
    const workspace = seeded();
    const request = parseVerificationStartRequest({
      id: "verification-1",
      idempotencyKey: "verify-request-1",
      target: {
        projectId: "project-1",
        objectiveId: "objective-1",
        workItemId: "work-1",
        attemptId: "attempt-1",
        resultKey: { kind: "turn", id: "turn-1" },
      },
      profile: { id: "focused", version: "1" },
      checks: [{ id: "unit", version: "1" }],
    });
    const receipt = createVerificationReceipt(request, "a".repeat(64), LATER);
    expect(
      parseCofficeWorkspace({
        ...workspace,
        verificationReceipts: [receipt],
      }).verificationReceipts,
    ).toEqual([receipt]);
    expect(() =>
      parseCofficeWorkspace({
        ...workspace,
        verificationReceipts: [
          { ...receipt, target: { ...receipt.target, attemptId: "missing" } },
        ],
      }),
    ).toThrow(/targets an unknown result/);
    expect(() =>
      parseCofficeWorkspace({
        ...workspace,
        verificationReceipts: [
          {
            ...receipt,
            checks: [{ ...receipt.checks[0], command: "npm test" }],
          },
        ],
      }),
    ).toThrow(/unknown field command/);
  });

  it("enforces receipt bounds, state timelines, check versions, and structural failures", () => {
    const workspace = seeded();
    const request = parseVerificationStartRequest({
      id: "verification-1",
      idempotencyKey: "verify-request-1",
      target: {
        projectId: "project-1",
        objectiveId: "objective-1",
        workItemId: "work-1",
        attemptId: "attempt-1",
        resultKey: { kind: "turn", id: "turn-1" },
      },
      profile: { id: "focused", version: "1" },
      checks: [{ id: "unit", version: "1" }],
    });
    const receipt = createVerificationReceipt(request, "b".repeat(64), NOW);
    expect(() =>
      parseCofficeWorkspace({
        ...workspace,
        verificationReceipts: Array.from({ length: 1_025 }, () => receipt),
      }),
    ).toThrow(/at most 1024 entries/);
    expect(() =>
      parseCofficeWorkspace({
        ...workspace,
        verificationReceipts: [{ ...receipt, startedAt: LATER }],
      }),
    ).toThrow(/queued state cannot have later timestamps/);
    expect(() =>
      transitionVerificationReceipt(
        receipt,
        {
          check: { id: "unit", version: "2" },
          state: "running",
        },
        LATER,
      ),
    ).toThrow(/unknown check unit@2/);
    expect(() =>
      transitionVerificationReceipt(
        receipt,
        {
          check: { id: "unit", version: "1" },
          state: "failed",
          failureKind: "timeout",
          exitCode: 1,
        },
        LATER,
      ),
    ).toThrow(/exitCode is allowed only for an exit failure/);
    expect(() =>
      parseVerificationStartRequest({
        ...request,
        profile: { id: "focused", version: "../private" },
      }),
    ).toThrow(/safe structural identifier/);
  });

  it("redirects one result cycle, then observes and accepts a later cycle on the same task link", () => {
    const reviewed = reduceCofficeWorkspace(
      seeded(),
      {
        type: "result.review",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItemId: "work-1",
        attemptId: "attempt-1",
        resultKey: { kind: "turn", id: "turn-1" },
        reviewedAt: LATER,
      },
      LATER,
    );
    expect(reviewed.projects[0].objectives[0].workItems[0]).toMatchObject({
      status: "ready_for_review",
      attempts: [{ resultCycles: [{ review: { reviewedAt: LATER } }] }],
    });

    const redirected = reduceCofficeWorkspace(
      reviewed,
      {
        type: "result.decide",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItemId: "work-1",
        attemptId: "attempt-1",
        resultKey: { kind: "turn", id: "turn-1" },
        decision: {
          kind: "redirected",
          decidedAt: LATER,
          note: "Try a smaller scope.",
        },
        evidence: decisionEvidence("decision-1", "turn-1", LATER, "redirected"),
      },
      LATER,
    );
    expect(redirected.projects[0].objectives[0].workItems[0].status).toBe(
      "in_progress",
    );

    expect(redirected.evidence).toHaveLength(1);

    const secondResult = reduceCofficeWorkspace(
      redirected,
      {
        type: "result.upsert",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItemId: "work-1",
        attemptId: "attempt-1",
        result: {
          key: { kind: "turn", id: "turn-2" },
          observedAt: THIRD,
        },
      },
      THIRD,
    );
    expect(secondResult.projects[0].objectives[0].workItems[0].status).toBe(
      "ready_for_review",
    );

    const secondReviewed = reduceCofficeWorkspace(
      secondResult,
      {
        type: "result.review",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItemId: "work-1",
        attemptId: "attempt-1",
        resultKey: { kind: "turn", id: "turn-2" },
        reviewedAt: FOURTH,
      },
      FOURTH,
    );
    const accepted = reduceCofficeWorkspace(
      secondReviewed,
      {
        type: "result.decide",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItemId: "work-1",
        attemptId: "attempt-1",
        resultKey: { kind: "turn", id: "turn-2" },
        decision: { kind: "accepted", decidedAt: FIFTH },
        evidence: decisionEvidence("decision-2", "turn-2", FIFTH, "accepted"),
      },
      FIFTH,
    );
    const acceptedItem = accepted.projects[0].objectives[0].workItems[0];
    expect(acceptedItem.status).toBe("accepted");
    expect(acceptedItem.attempts).toHaveLength(1);
    expect(acceptedItem.attempts[0].resultCycles).toMatchObject([
      { key: { id: "turn-1" }, review: { decision: { kind: "redirected" } } },
      { key: { id: "turn-2" }, review: { decision: { kind: "accepted" } } },
    ]);
    expect(accepted.evidence.map((record) => record.id)).toEqual([
      "decision-1",
      "decision-2",
    ]);
  });

  it("requires review and exact structural evidence before deciding atomically", () => {
    const before = seeded();
    expect(() =>
      reduceCofficeWorkspace(
        before,
        {
          type: "result.decide",
          projectId: "project-1",
          objectiveId: "objective-1",
          workItemId: "work-1",
          attemptId: "attempt-1",
          resultKey: { kind: "turn", id: "turn-1" },
          decision: { kind: "accepted", decidedAt: LATER },
          evidence: decisionEvidence("decision-1", "turn-1", LATER, "accepted"),
        },
        LATER,
      ),
    ).toThrow(/must be reviewed/);

    const reviewed = reduceCofficeWorkspace(
      before,
      {
        type: "result.review",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItemId: "work-1",
        attemptId: "attempt-1",
        resultKey: { kind: "turn", id: "turn-1" },
        reviewedAt: LATER,
      },
      LATER,
    );
    expect(() =>
      reduceCofficeWorkspace(
        reviewed,
        {
          type: "result.decide",
          projectId: "project-1",
          objectiveId: "objective-1",
          workItemId: "work-1",
          attemptId: "attempt-1",
          resultKey: { kind: "turn", id: "turn-1" },
          decision: { kind: "accepted", decidedAt: THIRD },
          evidence: {
            ...decisionEvidence("decision-1", "turn-1", THIRD, "accepted"),
            attemptId: "wrong-attempt",
          },
        },
        THIRD,
      ),
    ).toThrow(/must identify the exact result/);
    expect(reviewed.evidence).toEqual([]);
    expect(
      reviewed.projects[0].objectives[0].workItems[0].attempts[0]
        .resultCycles[0].review?.decision,
    ).toBeUndefined();
  });

  it("imports browser attention only once", () => {
    const empty = createEmptyCofficeWorkspace(NOW);
    const imported = reduceCofficeWorkspace(
      empty,
      {
        type: "attention.import",
        state: empty.attentionReview,
        importedAt: LATER,
      },
      LATER,
    );
    expect(imported.migrations.attentionReviewV2ImportedAt).toBe(LATER);
    expect(imported.attentionReview.initializedAt).toBe(NOW);
    expect(() =>
      reduceCofficeWorkspace(
        imported,
        {
          type: "attention.import",
          state: empty.attentionReview,
          importedAt: LATER,
        },
        LATER,
      ),
    ).toThrow(/already been imported/);
  });

  it("repairs an imported epoch baseline at import time without losing receipts", () => {
    const empty = createEmptyCofficeWorkspace(NOW);
    const eventKey = "task-a:failed:2026-08-11T11:30:00.000Z";
    const imported = reduceCofficeWorkspace(
      empty,
      {
        type: "attention.import",
        state: {
          version: 2,
          initializedAt: "1970-01-01T00:00:00.000Z",
          dispositions: {
            [eventKey]: { kind: "needs_review", at: NOW },
          },
          snoozedUntil: {
            [eventKey]: "2026-08-11T13:00:00.000Z",
          },
        },
        importedAt: LATER,
      },
      LATER,
    );

    expect(imported.attentionReview).toEqual({
      version: 2,
      initializedAt: LATER,
      dispositions: {
        [eventKey]: { kind: "needs_review", at: NOW },
      },
      snoozedUntil: {
        [eventKey]: "2026-08-11T13:00:00.000Z",
      },
    });
  });

  it("updates one attention event without replacing concurrent receipts", () => {
    const empty = createEmptyCofficeWorkspace(NOW);
    const first = reduceCofficeWorkspace(
      empty,
      {
        type: "attention.event",
        eventKey: "task-a:completed:first",
        disposition: { kind: "reviewed", at: LATER },
        snoozedUntil: null,
      },
      LATER,
    );
    const second = reduceCofficeWorkspace(
      first,
      {
        type: "attention.event",
        eventKey: "task-b:blocked:second",
        disposition: { kind: "needs_review", at: LATER },
        snoozedUntil: "2026-08-11T14:00:00.000Z",
      },
      LATER,
    );
    expect(Object.keys(second.attentionReview.dispositions)).toEqual([
      "task-a:completed:first",
      "task-b:blocked:second",
    ]);
    expect(second.attentionReview.snoozedUntil).toEqual({
      "task-b:blocked:second": "2026-08-11T14:00:00.000Z",
    });

    const restored = reduceCofficeWorkspace(
      second,
      {
        type: "attention.event",
        eventKey: "task-b:blocked:second",
        disposition: null,
        snoozedUntil: null,
      },
      LATER,
    );
    expect(restored.attentionReview.dispositions).toEqual({
      "task-a:completed:first": { kind: "reviewed", at: LATER },
    });
    expect(restored.attentionReview.snoozedUntil).toEqual({});
  });

  it("strictly validates atomic attention mutations", () => {
    const valid = {
      type: "attention.event" as const,
      eventKey: "task-a:blocked:now",
      disposition: { kind: "needs_review" as const, at: NOW },
      snoozedUntil: LATER,
    };
    expect(parseWorkspaceMutation(valid)).toEqual(valid);
    expect(() =>
      parseWorkspaceMutation({ ...valid, unexpected: true }),
    ).toThrow(/unknown field unexpected/);
    expect(() =>
      parseWorkspaceMutation({
        ...valid,
        disposition: null,
      }),
    ).toThrow(/snooze requires a needs_review disposition/);
    expect(() =>
      parseWorkspaceMutation({
        ...valid,
        disposition: { kind: "reviewed", at: NOW },
      }),
    ).toThrow(/snooze requires a needs_review disposition/);
    expect(() =>
      parseWorkspaceMutation({
        ...valid,
        disposition: { kind: "needs_review", at: LATER },
        snoozedUntil: NOW,
      }),
    ).toThrow(/must end after its disposition/);
  });

  it("compacts atomic attention updates under the attention byte limit", () => {
    const dispositions: Record<
      string,
      { kind: "needs_review" | "reviewed"; at: string }
    > = {};
    const snoozedUntil: Record<string, string> = {};
    const eventKey = (index: number, status = "blocked") => {
      const suffix = `:${status}:2026-08-11T12:00:00.000Z`;
      const prefix = `event-${String(index).padStart(4, "0")}-`;
      return `${prefix}${"x".repeat(320 - prefix.length - suffix.length)}${suffix}`;
    };
    for (let index = 0; index < 1_000; index += 1) {
      const key = eventKey(index);
      dispositions[key] = { kind: "needs_review", at: NOW };
      snoozedUntil[key] = "2026-08-12T12:00:00.000Z";
    }
    const protectedReceipt = eventKey(1_001, "completed").replace(
      "12:00:00.000Z",
      "12:01:00.000Z",
    );
    dispositions[protectedReceipt] = { kind: "reviewed", at: LATER };
    const compacted = parseAttentionReviewState(
      serializeAttentionReviewState({
        version: 2,
        initializedAt: NOW,
        dispositions,
        snoozedUntil,
      }),
    );
    expect(compacted).not.toBeNull();

    const selectedReceipt = eventKey(1_002, "blocked");
    const updated = reduceCofficeWorkspace(
      {
        ...createEmptyCofficeWorkspace(NOW),
        attentionReview: compacted!,
      },
      {
        type: "attention.event",
        eventKey: selectedReceipt,
        disposition: { kind: "needs_review", at: LATER },
        snoozedUntil: "2026-08-12T12:00:00.000Z",
      },
      LATER,
    );
    const serialized = JSON.stringify(updated.attentionReview);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      MAX_ATTENTION_REVIEW_STORAGE_BYTES,
    );
    expect(updated.attentionReview.dispositions[protectedReceipt]).toEqual({
      kind: "reviewed",
      at: LATER,
    });
    expect(updated.attentionReview.dispositions[selectedReceipt]).toEqual({
      kind: "needs_review",
      at: LATER,
    });
    expect(updated.attentionReview.snoozedUntil[selectedReceipt]).toBe(
      "2026-08-12T12:00:00.000Z",
    );
  });

  it("strictly parses discriminated mutations and bounded structural evidence", () => {
    expect(
      parseWorkspaceMutation({
        type: "project.remove",
        projectId: "project-1",
      }),
    ).toEqual({ type: "project.remove", projectId: "project-1" });
    expect(() =>
      parseWorkspaceMutation({
        type: "project.remove",
        projectId: "project-1",
        extra: true,
      }),
    ).toThrow(/unknown field extra/);
    expect(() => parseWorkspaceMutation({ type: "invented" })).toThrow(
      /unsupported mutation/,
    );

    const withEvidence = reduceCofficeWorkspace(
      seeded(),
      {
        type: "evidence.append",
        record: {
          id: "evidence-1",
          kind: "verification",
          outcome: "passed",
          summary: "Focused workspace tests passed.",
          recordedAt: LATER,
          projectId: "project-1",
          objectiveId: "objective-1",
          workItemId: "work-1",
          provenance: { source: "coffice", reference: "test:workspace" },
        },
      },
      LATER,
    );
    expect(withEvidence.evidence[0]).toMatchObject({
      kind: "verification",
      provenance: { source: "coffice" },
    });
  });

  it("enforces the file byte bound before parsing", () => {
    expect(() =>
      parseSerializedCofficeWorkspace(" ".repeat(2 * 1024 * 1024 + 1)),
    ).toThrow(CofficeWorkspaceValidationError);
  });
});
