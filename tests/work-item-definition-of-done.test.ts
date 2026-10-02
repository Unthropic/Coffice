import { describe, expect, it } from "vitest";

import {
  MAX_DEFINITION_OF_DONE_ENTRIES,
  MAX_DEFINITION_OF_DONE_ENTRY_LENGTH,
  MAX_DEFINITION_OF_DONE_TOTAL_LENGTH,
  createEmptyCofficeWorkspace,
  parseSerializedCofficeWorkspace,
  parseWorkspaceMutation,
  reduceCofficeWorkspace,
  serializeWorkspaceMutation,
  type WorkspaceProject,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-13T08:00:00.000Z";
const LATER = "2026-08-13T08:01:00.000Z";
const THIRD = "2026-08-13T08:02:00.000Z";

function project(): WorkspaceProject {
  return {
    id: "project-1",
    title: "Coffice",
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [
      {
        id: "objective-1",
        title: "Ship",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        workItems: [
          {
            id: "work-1",
            title: "Complete the story",
            expectedOutcome: "The story is ready to review.",
            status: "in_progress",
            createdAt: NOW,
            updatedAt: NOW,
            attempts: [
              {
                id: "attempt-1",
                codexTaskId: "task-1",
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
      },
    ],
  };
}

function seeded() {
  return reduceCofficeWorkspace(
    createEmptyCofficeWorkspace(NOW),
    { type: "project.upsert", project: project() },
    NOW,
  );
}

function setDefinition(definitionOfDone: string[]) {
  return {
    type: "workItem.definitionOfDone.set" as const,
    projectId: "project-1",
    objectiveId: "objective-1",
    workItemId: "work-1",
    definitionOfDone,
  };
}

describe("work-item definition of done", () => {
  it("normalizes ordered entries without deduplicating and clears explicitly", () => {
    const mutation = parseWorkspaceMutation(
      setDefinition(["  First\r\nline  ", "Same", "Same"]),
    );
    expect(mutation).toMatchObject({
      definitionOfDone: ["First\nline", "Same", "Same"],
    });
    const set = reduceCofficeWorkspace(seeded(), mutation, LATER);
    expect(set.projects[0].objectives[0].workItems[0].definitionOfDone).toEqual(
      ["First\nline", "Same", "Same"],
    );
    const cleared = reduceCofficeWorkspace(set, setDefinition([]), THIRD);
    expect(
      cleared.projects[0].objectives[0].workItems[0].definitionOfDone,
    ).toBeUndefined();
  });

  it("rejects empty and bounded overflow atomically", () => {
    const base = seeded();
    for (const invalid of [
      [" \r\n "],
      ["x".repeat(MAX_DEFINITION_OF_DONE_ENTRY_LENGTH + 1)],
      Array.from({ length: MAX_DEFINITION_OF_DONE_ENTRIES + 1 }, () => "x"),
      Array.from(
        {
          length:
            Math.floor(
              MAX_DEFINITION_OF_DONE_TOTAL_LENGTH /
                MAX_DEFINITION_OF_DONE_ENTRY_LENGTH,
            ) + 1,
        },
        () => "x".repeat(MAX_DEFINITION_OF_DONE_ENTRY_LENGTH),
      ),
    ]) {
      expect(() =>
        reduceCofficeWorkspace(base, setDefinition(invalid), LATER),
      ).toThrow();
      expect(base.projects[0].objectives[0].workItems[0]).not.toHaveProperty(
        "definitionOfDone",
      );
      expect(base.revision).toBe(1);
    }
  });

  it("migrates schema v1-v5 with absent criteria and keeps v5 strict", () => {
    for (const version of [1, 2, 3, 4, 5]) {
      const legacy = structuredClone(seeded()) as unknown as Record<
        string,
        unknown
      >;
      legacy.schemaVersion = version;
      delete legacy.decisionRequests;
      if (version === 1) {
        delete legacy.verificationReceipts;
      }
      if (version < 4) delete legacy.reviewAssessments;
      if (version < 5) delete legacy.projectDecisionEvents;
      const parsed = parseSerializedCofficeWorkspace(JSON.stringify(legacy));
      expect(parsed.schemaVersion).toBe(12);
      expect(
        parsed.projects[0].objectives[0].workItems[0].definitionOfDone,
      ).toBeUndefined();

      const withFutureField = structuredClone(legacy) as unknown as {
        projects: Array<{
          objectives: Array<{ workItems: Array<Record<string, unknown>> }>;
        }>;
      };
      withFutureField.projects[0].objectives[0].workItems[0].definitionOfDone =
        ["Not valid in legacy data"];
      expect(() =>
        parseSerializedCofficeWorkspace(JSON.stringify(withFutureField)),
      ).toThrow(/unknown field definitionOfDone/);
    }
  });

  it("preserves concurrent status and result history across intent mutations", () => {
    const afterDefinition = reduceCofficeWorkspace(
      seeded(),
      setDefinition(["Pass review"]),
      LATER,
    );
    const staleWholeItem = project().objectives[0].workItems[0];
    staleWholeItem.status = "ready_for_review";
    const afterStaleUpsert = reduceCofficeWorkspace(
      afterDefinition,
      {
        type: "workItem.upsert",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItem: staleWholeItem,
      },
      THIRD,
    );
    expect(
      afterStaleUpsert.projects[0].objectives[0].workItems[0],
    ).toMatchObject({
      status: "ready_for_review",
      definitionOfDone: ["Pass review"],
      attempts: [{ resultCycles: [{ key: { id: "turn-1" } }] }],
    });

    const statusFirst = reduceCofficeWorkspace(
      seeded(),
      {
        type: "workItem.upsert",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItem: staleWholeItem,
      },
      LATER,
    );
    const definitionSecond = reduceCofficeWorkspace(
      statusFirst,
      setDefinition(["Pass review"]),
      THIRD,
    );
    expect(
      definitionSecond.projects[0].objectives[0].workItems[0],
    ).toMatchObject({
      status: "ready_for_review",
      definitionOfDone: ["Pass review"],
      attempts: [{ resultCycles: [{ key: { id: "turn-1" } }] }],
    });
  });

  it("preserves durable criteria across stale objective and project upserts", () => {
    const withDefinition = reduceCofficeWorkspace(
      seeded(),
      setDefinition(["Keep this current criterion"]),
      LATER,
    );
    const staleObjective = structuredClone(project().objectives[0]);
    staleObjective.title = "Updated objective title";
    staleObjective.workItems[0].definitionOfDone = ["Stale replacement"];
    const afterObjective = reduceCofficeWorkspace(
      withDefinition,
      {
        type: "objective.upsert",
        projectId: "project-1",
        objective: staleObjective,
      },
      THIRD,
    );
    expect(afterObjective.projects[0].objectives[0]).toMatchObject({
      title: "Updated objective title",
      workItems: [{ definitionOfDone: ["Keep this current criterion"] }],
    });

    const staleProject = project();
    staleProject.title = "Updated project title";
    delete staleProject.objectives[0].workItems[0].definitionOfDone;
    const afterProject = reduceCofficeWorkspace(
      afterObjective,
      { type: "project.upsert", project: staleProject },
      THIRD,
    );
    expect(afterProject.projects[0]).toMatchObject({
      title: "Updated project title",
      objectives: [
        { workItems: [{ definitionOfDone: ["Keep this current criterion"] }] },
      ],
    });
  });

  it("preserves criteria through result and reorder reducers", () => {
    const withDefinition = reduceCofficeWorkspace(
      seeded(),
      setDefinition(["Keep the exact result history"]),
      LATER,
    );
    const withResult = reduceCofficeWorkspace(
      withDefinition,
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
    const withSecond = reduceCofficeWorkspace(
      withResult,
      {
        type: "workItem.upsert",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItem: {
          id: "work-2",
          title: "Second",
          expectedOutcome: "The second result is ready.",
          status: "planned",
          createdAt: THIRD,
          updatedAt: THIRD,
          attempts: [],
        },
      },
      THIRD,
    );
    const reordered = reduceCofficeWorkspace(
      withSecond,
      {
        type: "workItem.reorder",
        projectId: "project-1",
        objectiveId: "objective-1",
        orderedWorkItemIds: ["work-2", "work-1"],
      },
      THIRD,
    );
    const preserved = reordered.projects[0].objectives[0].workItems[1];
    expect(preserved.definitionOfDone).toEqual([
      "Keep the exact result history",
    ]);
    expect(
      preserved.attempts[0].resultCycles.map((result) => result.key.id),
    ).toEqual(["turn-1", "turn-2"]);
  });

  it("serializes normalized intent deterministically for idempotency hashing", () => {
    const first = parseWorkspaceMutation(setDefinition(["  One\r\nTwo  "]));
    const second = parseWorkspaceMutation(setDefinition(["One\nTwo"]));
    expect(serializeWorkspaceMutation(first)).toBe(
      serializeWorkspaceMutation(second),
    );
  });
});
