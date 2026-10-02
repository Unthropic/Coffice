import { describe, expect, it } from "vitest";

import {
  MAX_PROJECT_RULES_ENTRIES,
  MAX_PROJECT_RULE_ENTRY_LENGTH,
  MAX_PROJECT_RULES_TOTAL_LENGTH,
  createEmptyCofficeWorkspace,
  parseSerializedCofficeWorkspace,
  parseWorkspaceMutation,
  reduceCofficeWorkspace,
  serializeWorkspaceMutation,
  type WorkspaceProject,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-13T10:00:00.000Z";
const LATER = "2026-08-13T10:01:00.000Z";
const THIRD = "2026-08-13T10:02:00.000Z";

function project(rules?: string[]): WorkspaceProject {
  return {
    id: "project-1",
    title: "Coffice",
    ...(rules ? { rules } : {}),
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
            title: "Keep history",
            expectedOutcome: "Existing work remains intact.",
            status: "ready_for_review",
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

function seeded(rules?: string[]) {
  return reduceCofficeWorkspace(
    createEmptyCofficeWorkspace(NOW),
    { type: "project.upsert", project: project(rules) },
    NOW,
  );
}

function setRules(rules: string[]) {
  return { type: "project.rules.set" as const, projectId: "project-1", rules };
}

describe("project rules", () => {
  it("normalizes ordered entries without deduplicating and clears explicitly", () => {
    const mutation = parseWorkspaceMutation(
      setRules(["  First\r\nline  ", "Same", "Same"]),
    );
    expect(mutation).toEqual({
      type: "project.rules.set",
      projectId: "project-1",
      rules: ["First\nline", "Same", "Same"],
    });
    const set = reduceCofficeWorkspace(seeded(), mutation, LATER);
    expect(set.projects[0].rules).toEqual(["First\nline", "Same", "Same"]);
    expect(set.projects[0].objectives[0].workItems[0].status).toBe(
      "ready_for_review",
    );
    expect(
      set.projects[0].objectives[0].workItems[0].attempts[0].resultCycles,
    ).toHaveLength(1);

    const cleared = reduceCofficeWorkspace(set, setRules([]), THIRD);
    expect(cleared.projects[0].rules).toBeUndefined();
  });

  it("rejects empty entries and every defensive overflow atomically", () => {
    const base = seeded(["Keep"]);
    for (const invalid of [
      [" \r\n "],
      ["x".repeat(MAX_PROJECT_RULE_ENTRY_LENGTH + 1)],
      Array.from({ length: MAX_PROJECT_RULES_ENTRIES + 1 }, () => "x"),
      Array.from(
        {
          length:
            Math.floor(
              MAX_PROJECT_RULES_TOTAL_LENGTH / MAX_PROJECT_RULE_ENTRY_LENGTH,
            ) + 1,
        },
        () => "x".repeat(MAX_PROJECT_RULE_ENTRY_LENGTH),
      ),
    ]) {
      expect(() =>
        reduceCofficeWorkspace(base, setRules(invalid), LATER),
      ).toThrow();
      expect(base.projects[0].rules).toEqual(["Keep"]);
      expect(base.revision).toBe(1);
    }
  });

  it("migrates v1-v6 with rules absent and keeps legacy project shapes strict", () => {
    for (const version of [1, 2, 3, 4, 5, 6]) {
      const legacy = structuredClone(seeded()) as unknown as Record<
        string,
        unknown
      >;
      legacy.schemaVersion = version;
      delete legacy.decisionRequests;
      if (version === 1) delete legacy.verificationReceipts;
      if (version < 4) delete legacy.reviewAssessments;
      if (version < 5) delete legacy.projectDecisionEvents;
      const parsed = parseSerializedCofficeWorkspace(JSON.stringify(legacy));
      expect(parsed.schemaVersion).toBe(12);
      expect(parsed.projects[0].rules).toBeUndefined();

      const withFutureField = structuredClone(legacy) as unknown as {
        projects: Array<Record<string, unknown>>;
      };
      withFutureField.projects[0].rules = ["Not valid in legacy data"];
      expect(() =>
        parseSerializedCofficeWorkspace(JSON.stringify(withFutureField)),
      ).toThrow(/unknown field rules/);
    }
  });

  it("lets a new project seed rules but protects current rules from stale whole-project upserts", () => {
    const firstSave = reduceCofficeWorkspace(
      createEmptyCofficeWorkspace(NOW),
      {
        type: "project.upsert",
        project: {
          id: "empty-project",
          title: "Empty project",
          rules: ["Keep local changes reviewed"],
          createdAt: NOW,
          updatedAt: NOW,
          objectives: [],
        },
      },
      NOW,
    );
    expect(firstSave.projects[0]).toMatchObject({
      rules: ["Keep local changes reviewed"],
      objectives: [],
    });

    const initial = seeded(["Current rule"]);
    const stale = project(["Stale rule"]);
    stale.title = "Updated title";
    stale.objectives[0].workItems[0].status = "accepted";
    const updated = reduceCofficeWorkspace(
      initial,
      { type: "project.upsert", project: stale },
      LATER,
    );
    expect(updated.projects[0]).toMatchObject({
      title: "Updated title",
      rules: ["Current rule"],
      objectives: [{ workItems: [{ status: "accepted" }] }],
    });

    const absent = seeded();
    const forged = reduceCofficeWorkspace(
      absent,
      { type: "project.upsert", project: project(["Stale addition"]) },
      LATER,
    );
    expect(forged.projects[0].rules).toBeUndefined();
  });

  it("survives objective and work-item updates, then disappears only with project removal", () => {
    let workspace = seeded(["Keep this project rule"]);
    const objective = structuredClone(workspace.projects[0].objectives[0]);
    objective.title = "Updated objective";
    workspace = reduceCofficeWorkspace(
      workspace,
      { type: "objective.upsert", projectId: "project-1", objective },
      LATER,
    );
    workspace = reduceCofficeWorkspace(
      workspace,
      {
        type: "workItem.upsert",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItem: {
          ...workspace.projects[0].objectives[0].workItems[0],
          title: "Updated work-item title",
        },
      },
      THIRD,
    );
    expect(workspace.projects[0].rules).toEqual(["Keep this project rule"]);
    expect(workspace.projects[0].objectives[0].workItems[0].title).toBe(
      "Updated work-item title",
    );

    const emptyProject: WorkspaceProject = {
      id: "empty-project",
      title: "Empty",
      rules: ["Remove with project"],
      createdAt: NOW,
      updatedAt: NOW,
      objectives: [],
    };
    const withEmpty = reduceCofficeWorkspace(
      workspace,
      { type: "project.upsert", project: emptyProject },
      THIRD,
    );
    const removed = reduceCofficeWorkspace(
      withEmpty,
      { type: "project.remove", projectId: "empty-project" },
      THIRD,
    );
    expect(
      removed.projects.some((candidate) => candidate.id === "empty-project"),
    ).toBe(false);
    const readded = reduceCofficeWorkspace(
      removed,
      {
        type: "project.upsert",
        project: { ...emptyProject, rules: undefined },
      },
      THIRD,
    );
    expect(
      readded.projects.find((candidate) => candidate.id === "empty-project")
        ?.rules,
    ).toBeUndefined();
  });

  it("preserves concurrent project structure when the dedicated intent applies", () => {
    const concurrent = reduceCofficeWorkspace(
      seeded(),
      {
        type: "workItem.upsert",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItem: {
          ...project().objectives[0].workItems[0],
          status: "accepted",
        },
      },
      LATER,
    );
    const ruled = reduceCofficeWorkspace(
      concurrent,
      setRules(["Review before release"]),
      THIRD,
    );
    expect(ruled.projects[0]).toMatchObject({
      rules: ["Review before release"],
      objectives: [
        {
          workItems: [
            {
              status: "accepted",
              attempts: [{ resultCycles: [{ key: { id: "turn-1" } }] }],
            },
          ],
        },
      ],
    });
  });

  it("serializes normalized intents deterministically", () => {
    const first = parseWorkspaceMutation(setRules(["  One\r\nTwo  "]));
    const second = parseWorkspaceMutation(setRules(["One\nTwo"]));
    expect(serializeWorkspaceMutation(first)).toBe(
      serializeWorkspaceMutation(second),
    );
  });
});
