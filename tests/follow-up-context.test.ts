import { describe, expect, it } from "vitest";

import {
  MAX_FOLLOW_UP_CONTEXT_LENGTH,
  buildCurrentPlanFollowUpContext,
} from "../src/lib/follow-up-context";
import {
  createEmptyCofficeWorkspace,
  MAX_PROJECT_DECISION_CONTEXT_LENGTH,
  MAX_PROJECT_DECISION_STATEMENT_LENGTH,
  type CofficeWorkspace,
  type ProjectDecisionEvent,
  type WorkspaceProject,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-12T08:00:00.000Z";

function project(
  id: string,
  taskId: string,
  options: {
    unlinkedAt?: string;
    objective?: string;
    objectiveExpectedOutcome?: string;
    workItem?: string;
    expectedOutcome?: string;
    definitionOfDone?: string[];
    rules?: string[];
  } = {},
): WorkspaceProject {
  return {
    id,
    title: `Project ${id}`,
    ...(options.rules ? { rules: options.rules } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [
      {
        id: `objective-${id}`,
        title: options.objective ?? `Objective ${id}`,
        ...(options.objectiveExpectedOutcome === undefined
          ? {}
          : { expectedOutcome: options.objectiveExpectedOutcome }),
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        workItems: [
          {
            id: `work-${id}`,
            title: options.workItem ?? `Work item ${id}`,
            expectedOutcome:
              options.expectedOutcome ?? `Expected outcome ${id}`,
            ...(options.definitionOfDone
              ? { definitionOfDone: options.definitionOfDone }
              : {}),
            status: "in_progress",
            createdAt: NOW,
            updatedAt: NOW,
            attempts: [
              {
                id: `attempt-${id}`,
                codexTaskId: taskId,
                relationship: "primary",
                linkedAt: NOW,
                ...(options.unlinkedAt
                  ? { unlinkedAt: options.unlinkedAt }
                  : {}),
                resultCycles: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

function workspace(
  projects: WorkspaceProject[],
  projectDecisionEvents: ProjectDecisionEvent[] = [],
): CofficeWorkspace {
  return {
    ...createEmptyCofficeWorkspace(NOW),
    projects,
    projectDecisionEvents,
  };
}

describe("current plan follow-up context", () => {
  it("builds deterministic plain text from the unique current link and active decision heads", () => {
    const events: ProjectDecisionEvent[] = [
      {
        id: "decision-old",
        projectId: "current",
        action: "recorded",
        statement: "Use the old approach.",
        context: "Old context",
        authorship: "user",
        recordedAt: NOW,
      },
      {
        id: "decision-corrected",
        projectId: "current",
        action: "superseded",
        supersedesId: "decision-old",
        supersessionKind: "correction",
        statement: "Use the corrected approach.\r\nKeep it small.",
        context: "User-recorded\rcontext",
        authorship: "user",
        recordedAt: "2026-08-12T08:01:00.000Z",
      },
      {
        id: "decision-withdrawn-head",
        projectId: "current",
        action: "recorded",
        statement: "Do not include this withdrawn decision.",
        authorship: "user",
        recordedAt: "2026-08-12T08:02:00.000Z",
      },
      {
        id: "decision-withdrawal",
        projectId: "current",
        action: "withdrawn",
        supersedesId: "decision-withdrawn-head",
        reason: "No longer current",
        authorship: "user",
        recordedAt: "2026-08-12T08:03:00.000Z",
      },
      {
        id: "other-project-decision",
        projectId: "other",
        action: "recorded",
        statement: "Private decision from another project.",
        authorship: "user",
        recordedAt: "2026-08-12T08:04:00.000Z",
      },
    ];
    const result = buildCurrentPlanFollowUpContext(
      workspace(
        [
          project("historical", "task-a", {
            unlinkedAt: "2026-08-12T07:59:00.000Z",
          }),
          project("current", "task-a", {
            objective: "Ship the current plan",
            objectiveExpectedOutcome: "The whole objective succeeds.",
            workItem: "Finish the useful slice",
            expectedOutcome: "A user can verify it.\r\nNothing is inferred.",
            definitionOfDone: [
              "DefinitionOfDonePrivateCanaryMustNotEnterPlanFollowUp",
            ],
            rules: ["ProjectRulesPrivateCanaryMustNotEnterPlanFollowUp"],
          }),
        ],
        events,
      ),
      "task-a",
    );

    expect(result).toEqual({
      kind: "ready",
      text: [
        "Coffice plan context copied for review",
        "",
        "Objective: Ship the current plan",
        "Objective definition of success: The whole objective succeeds.",
        "Work item: Finish the useful slice",
        "Expected outcome: A user can verify it.",
        "  Nothing is inferred.",
        "",
        "Current user-recorded project decisions:",
        "- Use the corrected approach.",
        "  Keep it small.",
        "  Recorded context: User-recorded",
        "  context",
      ].join("\n"),
    });
    expect(JSON.stringify(result)).not.toContain("decision-");
    expect(JSON.stringify(result)).not.toContain("historical");
    expect(JSON.stringify(result)).not.toContain("another project");
    expect(JSON.stringify(result)).not.toContain("No longer current");
    expect(JSON.stringify(result)).not.toContain(
      "DefinitionOfDonePrivateCanaryMustNotEnterPlanFollowUp",
    );
    expect(JSON.stringify(result)).not.toContain(
      "ProjectRulesPrivateCanaryMustNotEnterPlanFollowUp",
    );
  });

  it("returns explicit unavailable reasons for no current link and ambiguous current links", () => {
    expect(buildCurrentPlanFollowUpContext(workspace([]), "missing")).toEqual({
      kind: "unavailable",
      reason: "no_open_context",
    });
    expect(
      buildCurrentPlanFollowUpContext(
        workspace([project("one", "task-a"), project("two", "task-a")]),
        "task-a",
      ),
    ).toEqual({
      kind: "unavailable",
      reason: "ambiguous_open_context",
    });
  });

  it("omits the decision section when the exact project has no active decisions", () => {
    const result = buildCurrentPlanFollowUpContext(
      workspace([project("one", "task-a")]),
      "task-a",
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.text).not.toContain("project decisions");
  });

  it("accepts the exact action bound and rejects overflow without truncation", () => {
    const boundedProject = project("one", "task-a", {
      objective: "o".repeat(320),
      objectiveExpectedOutcome: "g".repeat(1_000),
      workItem: "w".repeat(320),
      expectedOutcome: "e".repeat(1_000),
    });
    const firstDecision: ProjectDecisionEvent = {
      id: "decision-one",
      projectId: "one",
      action: "recorded",
      statement: "s".repeat(MAX_PROJECT_DECISION_STATEMENT_LENGTH),
      context: "c".repeat(MAX_PROJECT_DECISION_CONTEXT_LENGTH),
      authorship: "user",
      recordedAt: NOW,
    };
    const secondDecision = (contextLength: number): ProjectDecisionEvent => ({
      id: "decision-two",
      projectId: "one",
      action: "recorded",
      statement: "t".repeat(MAX_PROJECT_DECISION_STATEMENT_LENGTH),
      context: "d".repeat(contextLength),
      authorship: "user",
      recordedAt: "2026-08-12T08:01:00.000Z",
    });
    const withoutFinalContext = buildCurrentPlanFollowUpContext(
      workspace([boundedProject], [firstDecision, secondDecision(1)]),
      "task-a",
    );
    expect(withoutFinalContext.kind).toBe("ready");
    if (withoutFinalContext.kind !== "ready") return;
    const exactFinalContextLength =
      MAX_FOLLOW_UP_CONTEXT_LENGTH - withoutFinalContext.text.length + 1;
    expect(exactFinalContextLength).toBeLessThanOrEqual(
      MAX_PROJECT_DECISION_CONTEXT_LENGTH,
    );
    const exact = buildCurrentPlanFollowUpContext(
      workspace(
        [boundedProject],
        [firstDecision, secondDecision(exactFinalContextLength)],
      ),
      "task-a",
    );
    expect(exact.kind).toBe("ready");
    if (exact.kind !== "ready") return;
    expect(exact.text).toHaveLength(MAX_FOLLOW_UP_CONTEXT_LENGTH);

    const overflow = buildCurrentPlanFollowUpContext(
      workspace(
        [boundedProject],
        [firstDecision, secondDecision(exactFinalContextLength + 1)],
      ),
      "task-a",
    );
    expect(overflow).toEqual({
      kind: "too_large",
      length: MAX_FOLLOW_UP_CONTEXT_LENGTH + 1,
      maxLength: MAX_FOLLOW_UP_CONTEXT_LENGTH,
    });
  });
});
