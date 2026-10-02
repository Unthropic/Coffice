import { describe, expect, it } from "vitest";

import {
  createEmptyCofficeWorkspace,
  parseSerializedCofficeWorkspace,
  parseWorkspaceMutation,
  reduceCofficeWorkspace,
  serializeWorkspaceMutation,
  type ProjectContextConcern,
  type WorkspaceProject,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-19T09:00:00.000Z";
const LATER = "2026-08-19T09:01:00.000Z";
const THIRD = "2026-08-19T09:02:00.000Z";

function project(): WorkspaceProject {
  return {
    id: "project-1",
    title: "Coffice",
    rules: ["Keep current context explicit."],
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
            title: "Review context",
            expectedOutcome: "The project context is trustworthy.",
            status: "planned",
            createdAt: NOW,
            updatedAt: NOW,
            attempts: [],
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

function setReview(concerns: ProjectContextConcern[], note?: string) {
  return {
    type: "project.contextReview.set" as const,
    projectId: "project-1",
    concerns,
    ...(note === undefined ? {} : { note }),
  };
}

describe("project context review", () => {
  it("stores normalized user-declared concerns and clears them explicitly", () => {
    const mutation = parseWorkspaceMutation(
      setReview(
        ["stale", "contradictory"],
        "  Reconcile the release rule.\r\nKeep the correction explicit.  ",
      ),
    );
    const marked = reduceCofficeWorkspace(seeded(), mutation, LATER);
    expect(marked.projects[0].contextReview).toEqual({
      concerns: ["stale", "contradictory"],
      note: "Reconcile the release rule.\nKeep the correction explicit.",
      markedAt: LATER,
      authorship: "user",
    });
    expect(marked.projects[0].objectives[0].workItems[0].status).toBe(
      "planned",
    );
    const cleared = reduceCofficeWorkspace(
      marked,
      { type: "project.contextReview.clear", projectId: "project-1" },
      THIRD,
    );
    expect(cleared.projects[0].contextReview).toBeUndefined();
    expect(cleared.projects[0].rules).toEqual([
      "Keep current context explicit.",
    ]);
  });

  it("rejects empty, duplicate, noncanonical, unknown, and invalid-note input", () => {
    const base = seeded();
    for (const mutation of [
      setReview([]),
      setReview(["stale", "stale"]),
      setReview(["contradictory", "stale"]),
      setReview(["unknown" as ProjectContextConcern]),
      setReview(["stale"], "  "),
      setReview(["stale"], "x".repeat(2_001)),
    ]) {
      expect(() => reduceCofficeWorkspace(base, mutation, LATER)).toThrow();
      expect(base.projects[0].contextReview).toBeUndefined();
      expect(base.revision).toBe(1);
    }
  });

  it("preserves the current marker across stale generic project upserts", () => {
    const marked = reduceCofficeWorkspace(
      seeded(),
      setReview(["contradictory"], "Rules need reconciliation."),
      LATER,
    );
    const staleProject = project();
    staleProject.title = "Updated title";
    const afterUpsert = reduceCofficeWorkspace(
      marked,
      { type: "project.upsert", project: staleProject },
      THIRD,
    );
    expect(afterUpsert.projects[0]).toMatchObject({
      title: "Updated title",
      contextReview: {
        concerns: ["contradictory"],
        note: "Rules need reconciliation.",
        markedAt: LATER,
      },
    });
  });

  it("does not change the marker when rules, bars, or work status changes", () => {
    const marked = reduceCofficeWorkspace(
      seeded(),
      setReview(["stale"]),
      LATER,
    );
    const withRules = reduceCofficeWorkspace(
      marked,
      {
        type: "project.rules.set",
        projectId: "project-1",
        rules: ["Updated context."],
      },
      THIRD,
    );
    const workItem = structuredClone(project().objectives[0].workItems[0]);
    workItem.status = "in_progress";
    const withStatus = reduceCofficeWorkspace(
      withRules,
      {
        type: "workItem.upsert",
        projectId: "project-1",
        objectiveId: "objective-1",
        workItem,
      },
      THIRD,
    );
    expect(withStatus.projects[0].contextReview).toMatchObject({
      concerns: ["stale"],
      markedAt: LATER,
    });
    expect(withStatus.projects[0].rules).toEqual(["Updated context."]);
    expect(withStatus.projects[0].objectives[0].workItems[0].status).toBe(
      "in_progress",
    );
  });

  it("migrates v1-v9 with no invented marker and rejects backported fields", () => {
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
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
      expect(parsed.projects[0].contextReview).toBeUndefined();

      projectRecord.contextReview = {
        concerns: ["stale"],
        markedAt: NOW,
        authorship: "user",
      };
      expect(() =>
        parseSerializedCofficeWorkspace(JSON.stringify(legacy)),
      ).toThrow(/unknown field contextReview/);
    }
  });

  it("serializes normalized context-review requests deterministically", () => {
    const first = parseWorkspaceMutation(
      setReview(["stale"], "  Review this context.  "),
    );
    const second = parseWorkspaceMutation(
      setReview(["stale"], "Review this context."),
    );
    expect(serializeWorkspaceMutation(first)).toBe(
      serializeWorkspaceMutation(second),
    );
  });
});
