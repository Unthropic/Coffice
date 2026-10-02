import { describe, expect, it } from "vitest";

import {
  createEmptyCofficeWorkspace,
  parseSerializedCofficeWorkspace,
  parseWorkspaceMutation,
  reduceCofficeWorkspace,
  serializeWorkspaceMutation,
  type WorkItemRelationship,
  type WorkspaceProject,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-19T08:00:00.000Z";
const LATER = "2026-08-19T08:01:00.000Z";
const THIRD = "2026-08-19T08:02:00.000Z";

function workItem(id: string, title: string) {
  return {
    id,
    title,
    expectedOutcome: `${title} is complete.`,
    status: "planned" as const,
    createdAt: NOW,
    updatedAt: NOW,
    attempts: [],
  };
}

function project(): WorkspaceProject {
  return {
    id: "project-1",
    title: "Ship",
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [
      {
        id: "objective-a",
        title: "Prepare",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        workItems: [
          workItem("research", "Research"),
          workItem("implement", "Implement"),
        ],
      },
      {
        id: "objective-b",
        title: "Release",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        workItems: [workItem("review", "Review")],
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

function setRelationships(
  workItemId: string,
  relationships: WorkItemRelationship[],
  objectiveId = "objective-a",
) {
  return {
    type: "workItem.relationships.set" as const,
    projectId: "project-1",
    objectiveId,
    workItemId,
    relationships,
  };
}

describe("work-item relationships", () => {
  it("stores ordered advisory links and clears them through a dedicated intent", () => {
    const relationships: WorkItemRelationship[] = [
      {
        kind: "depends_on",
        targetObjectiveId: "objective-a",
        targetWorkItemId: "research",
      },
      {
        kind: "hands_off_to",
        targetObjectiveId: "objective-b",
        targetWorkItemId: "review",
      },
    ];
    const set = reduceCofficeWorkspace(
      seeded(),
      setRelationships("implement", relationships),
      LATER,
    );
    expect(set.projects[0].objectives[0].workItems[1]).toMatchObject({
      relationships,
      status: "planned",
      updatedAt: LATER,
    });
    const cleared = reduceCofficeWorkspace(
      set,
      setRelationships("implement", []),
      THIRD,
    );
    expect(
      cleared.projects[0].objectives[0].workItems[1].relationships,
    ).toBeUndefined();
  });

  it("rejects missing targets, self-links, duplicate directions, and cycles", () => {
    const base = seeded();
    const invalidSets: Array<{
      workItemId: string;
      objectiveId?: string;
      relationships: WorkItemRelationship[];
    }> = [
      {
        workItemId: "implement",
        relationships: [
          {
            kind: "depends_on",
            targetObjectiveId: "objective-a",
            targetWorkItemId: "missing",
          },
        ],
      },
      {
        workItemId: "implement",
        relationships: [
          {
            kind: "depends_on",
            targetObjectiveId: "objective-a",
            targetWorkItemId: "implement",
          },
        ],
      },
      {
        workItemId: "implement",
        relationships: [
          {
            kind: "depends_on",
            targetObjectiveId: "objective-a",
            targetWorkItemId: "research",
          },
          {
            kind: "hands_off_to",
            targetObjectiveId: "objective-a",
            targetWorkItemId: "implement",
          },
        ],
      },
    ];
    invalidSets.forEach(({ workItemId, objectiveId, relationships }) => {
      expect(() =>
        reduceCofficeWorkspace(
          base,
          setRelationships(workItemId, relationships, objectiveId),
          LATER,
        ),
      ).toThrow();
      expect(base.revision).toBe(1);
    });

    const researchHandsToImplement = reduceCofficeWorkspace(
      base,
      setRelationships("research", [
        {
          kind: "hands_off_to",
          targetObjectiveId: "objective-a",
          targetWorkItemId: "implement",
        },
      ]),
      LATER,
    );
    expect(() =>
      reduceCofficeWorkspace(
        researchHandsToImplement,
        setRelationships("implement", [
          {
            kind: "hands_off_to",
            targetObjectiveId: "objective-a",
            targetWorkItemId: "research",
          },
        ]),
        THIRD,
      ),
    ).toThrow(/cycle/);
  });

  it("preserves links across stale generic upserts and unrelated status changes", () => {
    const links: WorkItemRelationship[] = [
      {
        kind: "depends_on",
        targetObjectiveId: "objective-a",
        targetWorkItemId: "research",
      },
    ];
    const linked = reduceCofficeWorkspace(
      seeded(),
      setRelationships("implement", links),
      LATER,
    );
    const staleItem = project().objectives[0].workItems[1];
    staleItem.status = "in_progress";
    const afterItem = reduceCofficeWorkspace(
      linked,
      {
        type: "workItem.upsert",
        projectId: "project-1",
        objectiveId: "objective-a",
        workItem: staleItem,
      },
      THIRD,
    );
    expect(afterItem.projects[0].objectives[0].workItems[1]).toMatchObject({
      status: "in_progress",
      relationships: links,
    });

    const staleObjective = structuredClone(project().objectives[0]);
    staleObjective.title = "Updated objective";
    const afterObjective = reduceCofficeWorkspace(
      afterItem,
      {
        type: "objective.upsert",
        projectId: "project-1",
        objective: staleObjective,
      },
      THIRD,
    );
    expect(afterObjective.projects[0].objectives[0]).toMatchObject({
      title: "Updated objective",
      workItems: [{}, { relationships: links }],
    });

    const staleProject = project();
    staleProject.title = "Updated project";
    const afterProject = reduceCofficeWorkspace(
      afterObjective,
      { type: "project.upsert", project: staleProject },
      THIRD,
    );
    expect(afterProject.projects[0].title).toBe("Updated project");
    expect(
      afterProject.projects[0].objectives[0].workItems[1].relationships,
    ).toEqual(links);
  });

  it("rejects removing a referenced work item until its links are cleared", () => {
    const linked = reduceCofficeWorkspace(
      seeded(),
      setRelationships("implement", [
        {
          kind: "depends_on",
          targetObjectiveId: "objective-a",
          targetWorkItemId: "research",
        },
      ]),
      LATER,
    );
    expect(() =>
      reduceCofficeWorkspace(
        linked,
        {
          type: "workItem.remove",
          projectId: "project-1",
          objectiveId: "objective-a",
          workItemId: "research",
        },
        THIRD,
      ),
    ).toThrow(/target work item/);
  });

  it("migrates v1-v8 with no invented links and keeps old schemas strict", () => {
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const legacy = structuredClone(seeded()) as unknown as Record<
        string,
        unknown
      >;
      legacy.schemaVersion = version;
      delete legacy.decisionRequests;
      if (version === 1) delete legacy.verificationReceipts;
      if (version < 4) delete legacy.reviewAssessments;
      if (version < 5) delete legacy.projectDecisionEvents;
      const projectRecord = (
        legacy.projects as Array<Record<string, unknown>>
      )[0];
      if (version < 7) delete projectRecord.rules;
      if (version < 8) delete projectRecord.qualityBars;
      const parsed = parseSerializedCofficeWorkspace(JSON.stringify(legacy));
      expect(parsed.schemaVersion).toBe(12);
      expect(
        parsed.projects[0].objectives[0].workItems[0].relationships,
      ).toBeUndefined();

      const withFutureField = structuredClone(legacy) as unknown as {
        projects: Array<{
          objectives: Array<{ workItems: Array<Record<string, unknown>> }>;
        }>;
      };
      withFutureField.projects[0].objectives[0].workItems[0].relationships = [
        {
          kind: "hands_off_to",
          targetObjectiveId: "objective-a",
          targetWorkItemId: "implement",
        },
      ];
      expect(() =>
        parseSerializedCofficeWorkspace(JSON.stringify(withFutureField)),
      ).toThrow(/unknown field relationships/);
    }
  });

  it("serializes normalized relationship mutations deterministically", () => {
    const raw = setRelationships("implement", [
      {
        kind: "depends_on",
        targetObjectiveId: "objective-a",
        targetWorkItemId: "research",
      },
    ]);
    const parsed = parseWorkspaceMutation(raw);
    expect(serializeWorkspaceMutation(parsed)).toBe(
      serializeWorkspaceMutation(parseWorkspaceMutation(raw)),
    );
  });
});
