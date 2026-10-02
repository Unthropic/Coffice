import { describe, expect, it } from "vitest";

import {
  createEmptyCofficeWorkspace,
  parseSerializedCofficeWorkspace,
  parseWorkspaceMutation,
  reduceCofficeWorkspace,
  serializeWorkspaceMutation,
  type WorkspaceProject,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-19T09:00:00.000Z";
const DUE = "2026-08-26T09:00:00.000Z";
const REVIEWED = "2026-08-20T10:00:00.000Z";

function project(): WorkspaceProject {
  return {
    id: "project-1",
    title: "Coffice",
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [],
  };
}

function seeded() {
  return reduceCofficeWorkspace(
    createEmptyCofficeWorkspace(NOW),
    { type: "project.upsert", project: project() },
    NOW,
  );
}

describe("project review schedules", () => {
  it("sets a user-authored recurring review and advances it only after an explicit completion", () => {
    const scheduled = reduceCofficeWorkspace(
      seeded(),
      {
        type: "project.reviewSchedule.set",
        projectId: "project-1",
        nextReviewAt: DUE,
        repeatEveryDays: 7,
      },
      NOW,
    );
    expect(scheduled.projects[0].reviewSchedule).toEqual({
      nextReviewAt: DUE,
      repeatEveryDays: 7,
      configuredAt: NOW,
      authorship: "user",
    });

    const reviewed = reduceCofficeWorkspace(
      scheduled,
      { type: "project.reviewSchedule.complete", projectId: "project-1" },
      REVIEWED,
    );
    expect(reviewed.projects[0].reviewSchedule).toEqual({
      nextReviewAt: "2026-08-27T10:00:00.000Z",
      repeatEveryDays: 7,
      configuredAt: NOW,
      lastReviewedAt: REVIEWED,
      authorship: "user",
    });
  });

  it("clears a one-time schedule when the user marks the review complete", () => {
    const scheduled = reduceCofficeWorkspace(
      seeded(),
      {
        type: "project.reviewSchedule.set",
        projectId: "project-1",
        nextReviewAt: DUE,
      },
      NOW,
    );
    const reviewed = reduceCofficeWorkspace(
      scheduled,
      { type: "project.reviewSchedule.complete", projectId: "project-1" },
      REVIEWED,
    );
    expect(reviewed.projects[0].reviewSchedule).toBeUndefined();
  });

  it("preserves the current schedule across generic project updates and unrelated context writes", () => {
    const scheduled = reduceCofficeWorkspace(
      seeded(),
      {
        type: "project.reviewSchedule.set",
        projectId: "project-1",
        nextReviewAt: DUE,
        repeatEveryDays: 14,
      },
      NOW,
    );
    const candidate = project();
    candidate.title = "Renamed project";
    const renamed = reduceCofficeWorkspace(
      scheduled,
      { type: "project.upsert", project: candidate },
      REVIEWED,
    );
    const flagged = reduceCofficeWorkspace(
      renamed,
      {
        type: "project.contextReview.set",
        projectId: "project-1",
        concerns: ["stale"],
      },
      REVIEWED,
    );
    expect(flagged.projects[0]).toMatchObject({
      title: "Renamed project",
      reviewSchedule: {
        nextReviewAt: DUE,
        repeatEveryDays: 14,
        configuredAt: NOW,
      },
      contextReview: { concerns: ["stale"] },
    });
  });

  it("rejects invalid recurrence and completion without a schedule atomically", () => {
    const base = seeded();
    for (const repeatEveryDays of [0, 3_651, 1.5]) {
      expect(() =>
        reduceCofficeWorkspace(
          base,
          {
            type: "project.reviewSchedule.set",
            projectId: "project-1",
            nextReviewAt: DUE,
            repeatEveryDays,
          },
          REVIEWED,
        ),
      ).toThrow();
    }
    expect(() =>
      reduceCofficeWorkspace(
        base,
        { type: "project.reviewSchedule.complete", projectId: "project-1" },
        REVIEWED,
      ),
    ).toThrow(/no review schedule/);
    expect(base.projects[0].reviewSchedule).toBeUndefined();
    expect(base.revision).toBe(1);
  });

  it("migrates v1-v10 without inventing a schedule and rejects backported schedule fields", () => {
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
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
      if (version < 10) delete projectRecord.contextReview;

      const parsed = parseSerializedCofficeWorkspace(JSON.stringify(legacy));
      expect(parsed.schemaVersion).toBe(12);
      expect(parsed.projects[0].reviewSchedule).toBeUndefined();

      projectRecord.reviewSchedule = {
        nextReviewAt: DUE,
        configuredAt: NOW,
        authorship: "user",
      };
      expect(() =>
        parseSerializedCofficeWorkspace(JSON.stringify(legacy)),
      ).toThrow(/unknown field reviewSchedule/);
    }
  });

  it("normalizes schedule requests into deterministic idempotency input", () => {
    const first = parseWorkspaceMutation({
      type: "project.reviewSchedule.set",
      projectId: "project-1",
      nextReviewAt: DUE,
      repeatEveryDays: 30,
    });
    const second = parseWorkspaceMutation({
      repeatEveryDays: 30,
      nextReviewAt: DUE,
      projectId: "project-1",
      type: "project.reviewSchedule.set",
    });
    expect(serializeWorkspaceMutation(first)).toBe(
      serializeWorkspaceMutation(second),
    );
  });
});
