import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CofficeWorkspaceConflictError,
  CofficeWorkspaceCorruptionError,
  CofficeWorkspaceMutationIdError,
  CofficeWorkspaceStore,
  COFFICE_WORKSPACE_FILENAME,
  CofficeVerificationCapacityError,
  CofficeVerificationIdempotencyError,
  defaultCofficeDataDirectory,
} from "../src/lib/coffice-workspace-store";
import type {
  VerificationReceipt,
  WorkspaceProject,
} from "../src/lib/coffice-workspace";

const roots: string[] = [];
const NOW = "2026-08-11T12:00:00.000Z";
const LATER = "2026-08-11T12:01:00.000Z";
const THIRD = "2026-08-11T12:02:00.000Z";
const FOURTH = "2026-08-11T12:03:00.000Z";
let tick = 0;

async function directory() {
  const dir = path.join(
    os.tmpdir(),
    `coffice-store-${process.pid}-${Date.now()}-${tick++}`,
  );
  roots.push(dir);
  return dir;
}

function project(id: string): WorkspaceProject {
  return {
    id,
    title: id,
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [],
  };
}

function resultProject(): WorkspaceProject {
  return {
    id: "project-results",
    title: "Result project",
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [
      {
        id: "objective-results",
        title: "Review results",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        workItems: [
          {
            id: "work-results",
            title: "Review one result",
            expectedOutcome: "The result has a durable decision.",
            status: "ready_for_review",
            createdAt: NOW,
            updatedAt: NOW,
            attempts: [
              {
                id: "attempt-results",
                codexTaskId: "codex-results",
                relationship: "primary",
                linkedAt: NOW,
                resultCycles: [
                  {
                    key: { kind: "turn", id: "turn-results" },
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

function orderedResultProject(): WorkspaceProject {
  const project = resultProject();
  project.objectives[0].workItems.push(
    {
      id: "work-second",
      title: "Second outcome",
      expectedOutcome: "The second outcome reaches its finish line.",
      status: "planned",
      createdAt: LATER,
      updatedAt: LATER,
      attempts: [],
    },
    {
      id: "work-third",
      title: "Third outcome",
      expectedOutcome: "The third outcome reaches its finish line.",
      status: "planned",
      createdAt: THIRD,
      updatedAt: THIRD,
      attempts: [],
    },
  );
  return project;
}

function moveDestinationProject(): WorkspaceProject {
  return {
    id: "project-destination",
    title: "Destination",
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [
      {
        id: "objective-destination",
        title: "Continue",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        workItems: [
          {
            id: "work-destination",
            title: "Continue the task",
            expectedOutcome: "Future results are reviewed here.",
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

function verificationRequest(id: string, idempotencyKey = `${id}-request`) {
  return {
    id,
    idempotencyKey,
    target: {
      projectId: "project-results",
      objectiveId: "objective-results",
      workItemId: "work-results",
      attemptId: "attempt-results",
      resultKey: { kind: "turn" as const, id: "turn-results" },
    },
    profile: { id: "focused", version: "1" },
    checks: [
      { id: "unit", version: "1" },
      { id: "types", version: "1" },
    ],
  };
}

function capacityReceipt(
  template: VerificationReceipt,
  index: number,
  state: "queued" | "passed" | "failed" | "unknown",
): VerificationReceipt {
  const suffix = index.toString().padStart(4, "0");
  const terminal = state !== "queued";
  return {
    ...structuredClone(template),
    id: `capacity-${suffix}`,
    idempotencyKey: `capacity-key-${suffix}`,
    requestHash: index.toString(16).padStart(64, "0"),
    state,
    ...(terminal ? { startedAt: NOW, completedAt: NOW } : {}),
    checks: template.checks.map((check) => ({
      ...check,
      state,
      ...(terminal ? { startedAt: NOW, completedAt: NOW } : {}),
      ...(state === "failed"
        ? { failureKind: "exit" as const, exitCode: 1 }
        : {}),
    })),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Coffice workspace store", () => {
  it("uses platform-owned data directories rather than a repository or .codex", () => {
    expect(
      defaultCofficeDataDirectory(
        "win32",
        {
          COFFICE_DATA_DIR: "C:\\Temp\\coffice-browser-test",
          LOCALAPPDATA: "C:\\Local",
        },
        "C:\\User",
      ),
    ).toBe("C:\\Temp\\coffice-browser-test");
    expect(
      defaultCofficeDataDirectory(
        "win32",
        { LOCALAPPDATA: "C:\\Local" },
        "C:\\User",
      ),
    ).toBe(path.join("C:\\Local", "Coffice"));
    expect(defaultCofficeDataDirectory("darwin", {}, "/Users/me")).toBe(
      path.join("/Users/me", "Library", "Application Support", "Coffice"),
    );
    expect(
      defaultCofficeDataDirectory(
        "linux",
        { XDG_DATA_HOME: "/data" },
        "/home/me",
      ),
    ).toBe(path.join("/data", "Coffice"));
  });

  it("creates fresh state and atomically keeps the last valid revision as backup", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    const fresh = await store.load();
    expect(fresh).toMatchObject({
      workspace: { revision: 0 },
      recovery: { kind: "created" },
    });

    const first = await store.mutate(0, "mutation-1", {
      type: "project.upsert",
      project: project("project-1"),
    });
    expect(first.workspace.revision).toBe(1);
    expect(JSON.parse(await readFile(store.backupPath, "utf8")).revision).toBe(
      0,
    );
    expect((await readdir(dir)).every((name) => !name.endsWith(".tmp"))).toBe(
      true,
    );
  });

  it("recovers a valid backup with explicit metadata and preserves corrupt files", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    await store.load();
    await store.mutate(0, "mutation-1", {
      type: "project.upsert",
      project: project("project-1"),
    });
    const backupBefore = await readFile(store.backupPath, "utf8");
    await writeFile(store.primaryPath, "corrupt primary", "utf8");

    const recovered = await store.load();
    expect(recovered).toMatchObject({
      workspace: { revision: 0 },
      recovery: { kind: "backup", reason: "primary-corrupt" },
    });
    expect(await readFile(store.primaryPath, "utf8")).toBe("corrupt primary");
    expect(await readFile(store.backupPath, "utf8")).toBe(backupBefore);
  });

  it("fails closed and preserves both files when primary and backup are corrupt", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    await store.load();
    await store.mutate(0, "mutation-1", {
      type: "project.upsert",
      project: project("project-1"),
    });
    await writeFile(store.primaryPath, "bad-primary", "utf8");
    await writeFile(store.backupPath, "bad-backup", "utf8");

    await expect(store.load()).rejects.toBeInstanceOf(
      CofficeWorkspaceCorruptionError,
    );
    expect(await readFile(store.primaryPath, "utf8")).toBe("bad-primary");
    expect(await readFile(store.backupPath, "utf8")).toBe("bad-backup");
  });

  it("serializes competing store instances and enforces expected revisions", async () => {
    const dir = await directory();
    const first = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    const second = new CofficeWorkspaceStore({
      directory: dir,
      now: () => NOW,
    });
    await first.load();

    const results = await Promise.allSettled([
      first.mutate(0, "mutation-a", {
        type: "project.upsert",
        project: project("a"),
      }),
      second.mutate(0, "mutation-b", {
        type: "project.upsert",
        project: project("b"),
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(
      rejection && rejection.status === "rejected" && rejection.reason,
    ).toBeInstanceOf(CofficeWorkspaceConflictError);
  });

  it("makes an ambiguous mutation retry idempotent but rejects id reuse", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    await store.load();
    const mutation = {
      type: "project.upsert" as const,
      project: project("project-1"),
    };
    const applied = await store.mutate(0, "stable-request", mutation);
    const retry = await store.mutate(0, "stable-request", mutation);
    expect(retry.workspace.revision).toBe(applied.workspace.revision);
    expect(retry.workspace.projects).toHaveLength(1);
    expect(retry.workspace.mutationReceipts).toHaveLength(1);

    await expect(
      store.mutate(1, "stable-request", {
        type: "project.upsert",
        project: project("different"),
      }),
    ).rejects.toBeInstanceOf(CofficeWorkspaceMutationIdError);
  });

  it("persists definition-of-done intent idempotently and rejects stale tabs", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => LATER,
    });
    await store.load();
    const seeded = await store.mutate(0, "seed-definition-target", {
      type: "project.upsert",
      project: resultProject(),
    });
    const mutation = {
      type: "workItem.definitionOfDone.set" as const,
      projectId: "project-results",
      objectiveId: "objective-results",
      workItemId: "work-results",
      definitionOfDone: ["  Pass review\r\nwithout regressions  "],
    };
    const applied = await store.mutate(
      seeded.workspace.revision,
      "set-definition",
      mutation,
    );
    const retry = await store.mutate(
      seeded.workspace.revision,
      "set-definition",
      mutation,
    );
    expect(retry.workspace.revision).toBe(applied.workspace.revision);
    expect(
      retry.workspace.projects[0].objectives[0].workItems[0].definitionOfDone,
    ).toEqual(["Pass review\nwithout regressions"]);

    await expect(
      store.mutate(seeded.workspace.revision, "stale-definition", {
        ...mutation,
        definitionOfDone: ["Different draft"],
      }),
    ).rejects.toBeInstanceOf(CofficeWorkspaceConflictError);
    expect(
      (await store.load()).workspace.projects[0].objectives[0].workItems[0]
        .definitionOfDone,
    ).toEqual(["Pass review\nwithout regressions"]);
  });

  it("persists one exact work-item order without disturbing result receipts", async () => {
    const dir = await directory();
    let current = LATER;
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => current,
    });
    await store.load();
    await store.mutate(0, "seed-ordered-outcomes", {
      type: "project.upsert",
      project: orderedResultProject(),
    });
    await store.startVerification(
      verificationRequest("verification-before-reorder"),
    );
    const before = await store.load();
    const preservedReceipt = structuredClone(
      before.workspace.verificationReceipts[0],
    );
    const mutation = {
      type: "workItem.reorder" as const,
      projectId: "project-results",
      objectiveId: "objective-results",
      orderedWorkItemIds: ["work-third", "work-results", "work-second"],
    };

    current = THIRD;
    const applied = await store.mutate(2, "reorder-outcomes", mutation);
    const retry = await store.mutate(2, "reorder-outcomes", mutation);
    expect(retry.workspace.revision).toBe(applied.workspace.revision);
    expect(
      applied.workspace.projects[0].objectives[0].workItems.map(
        (workItem) => workItem.id,
      ),
    ).toEqual(["work-third", "work-results", "work-second"]);
    expect(applied.workspace.verificationReceipts[0]).toEqual(preservedReceipt);
    expect(
      JSON.parse(
        await readFile(store.primaryPath, "utf8"),
      ).projects[0].objectives[0].workItems.map(
        (workItem: { id: string }) => workItem.id,
      ),
    ).toEqual(["work-third", "work-results", "work-second"]);

    const reloaded = await new CofficeWorkspaceStore({
      directory: dir,
      now: () => current,
    }).load();
    expect(
      reloaded.workspace.projects[0].objectives[0].workItems.map(
        (workItem) => workItem.id,
      ),
    ).toEqual(["work-third", "work-results", "work-second"]);
    expect(reloaded.workspace.verificationReceipts[0]).toEqual(
      preservedReceipt,
    );
    await expect(
      store.mutate(3, "reorder-outcomes", {
        ...mutation,
        orderedWorkItemIds: ["work-results", "work-second", "work-third"],
      }),
    ).rejects.toBeInstanceOf(CofficeWorkspaceMutationIdError);
    await expect(
      store.mutate(2, "stale-reorder-outcomes", mutation),
    ).rejects.toBeInstanceOf(CofficeWorkspaceConflictError);
  });

  it("persists assessment set, update, and clear with conflict-safe retries", async () => {
    const dir = await directory();
    let current = LATER;
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => current,
    });
    expect(path.basename(store.primaryPath)).toBe(COFFICE_WORKSPACE_FILENAME);
    await store.load();
    await store.mutate(0, "seed-assessment-target", {
      type: "project.upsert",
      project: resultProject(),
    });
    const target = {
      projectId: "project-results",
      objectiveId: "objective-results",
      workItemId: "work-results",
      attemptId: "attempt-results",
      resultKey: { kind: "turn" as const, id: "turn-results" },
    };
    const setMutation = {
      type: "assessment.set" as const,
      assessment: {
        target,
        reviewSummary: "The result needs one more check.",
        risks: ["The fallback is not covered."],
        uncertainties: [],
        blockedDecisions: [],
        nextAction: { kind: "run_quality_check" as const },
      },
    };
    const applied = await store.mutate(1, "assessment-set", setMutation);
    expect(applied.workspace.reviewAssessments).toMatchObject([
      { target, authorship: "user", updatedAt: LATER },
    ]);

    current = THIRD;
    const retry = await store.mutate(1, "assessment-set", setMutation);
    expect(retry.workspace.revision).toBe(applied.workspace.revision);
    expect(retry.workspace.reviewAssessments[0].updatedAt).toBe(LATER);
    await expect(
      store.mutate(1, "assessment-stale-update", {
        type: "assessment.set",
        assessment: {
          target,
          risks: [],
          uncertainties: ["A new uncertainty."],
          blockedDecisions: [],
        },
      }),
    ).rejects.toBeInstanceOf(CofficeWorkspaceConflictError);

    const updated = await store.mutate(2, "assessment-update", {
      type: "assessment.set",
      assessment: {
        target,
        risks: [],
        uncertainties: ["A new uncertainty."],
        blockedDecisions: [],
        nextAction: { kind: "request_review" },
      },
    });
    expect(updated.workspace.reviewAssessments).toHaveLength(1);
    expect(updated.workspace.reviewAssessments[0]).toMatchObject({
      uncertainties: ["A new uncertainty."],
      updatedAt: THIRD,
    });

    current = FOURTH;
    const cleared = await store.mutate(3, "assessment-clear", {
      type: "assessment.clear",
      target,
    });
    expect(cleared.workspace.reviewAssessments).toEqual([]);
    expect(
      JSON.parse(await readFile(store.primaryPath, "utf8")).reviewAssessments,
    ).toEqual([]);
    expect(
      JSON.parse(await readFile(store.backupPath, "utf8")).reviewAssessments,
    ).toHaveLength(1);
    const clearRetry = await store.mutate(3, "assessment-clear", {
      type: "assessment.clear",
      target,
    });
    expect(clearRetry.workspace.revision).toBe(cleared.workspace.revision);
    expect(clearRetry.workspace.reviewAssessments).toEqual([]);
  });

  it("persists project decision history once across retries and cascades it only with project removal", async () => {
    const dir = await directory();
    let current = LATER;
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => current,
    });
    await store.load();
    await store.mutate(0, "seed-decision-project", {
      type: "project.upsert",
      project: project("project-decisions"),
    });
    const recordMutation = {
      type: "projectDecision.record" as const,
      id: "decision-event-1",
      projectId: "project-decisions",
      statement: "Keep the decision history local and explicit.",
    };
    const recorded = await store.mutate(1, "decision-record", recordMutation);
    expect(recorded.workspace.projectDecisionEvents).toEqual([
      {
        id: "decision-event-1",
        projectId: "project-decisions",
        action: "recorded",
        statement: "Keep the decision history local and explicit.",
        recordedAt: LATER,
        authorship: "user",
      },
    ]);

    current = THIRD;
    const retry = await store.mutate(1, "decision-record", recordMutation);
    expect(retry.workspace.revision).toBe(recorded.workspace.revision);
    expect(retry.workspace.projectDecisionEvents[0].recordedAt).toBe(LATER);
    await expect(
      store.mutate(1, "decision-record", {
        ...recordMutation,
        statement: "A reused receipt cannot change content.",
      }),
    ).rejects.toBeInstanceOf(CofficeWorkspaceMutationIdError);
    await expect(
      store.mutate(2, "decision-duplicate-event", {
        ...recordMutation,
        statement: "A new receipt still cannot reuse an event ID.",
      }),
    ).rejects.toThrow(/duplicate project decision event id/);
    await expect(
      store.mutate(1, "decision-stale-revision", {
        type: "projectDecision.record",
        id: "decision-event-stale",
        projectId: "project-decisions",
        statement: "A stale request must receive a revision conflict.",
      }),
    ).rejects.toBeInstanceOf(CofficeWorkspaceConflictError);

    const corrected = await store.mutate(2, "decision-correct", {
      type: "projectDecision.supersede",
      id: "decision-event-2",
      projectId: "project-decisions",
      supersedesId: "decision-event-1",
      supersessionKind: "correction",
      statement: "Keep private project decision history local and explicit.",
    });
    expect(corrected.workspace.projectDecisionEvents).toHaveLength(2);
    expect(
      JSON.parse(await readFile(store.primaryPath, "utf8"))
        .projectDecisionEvents,
    ).toHaveLength(2);
    expect(
      JSON.parse(await readFile(store.backupPath, "utf8"))
        .projectDecisionEvents,
    ).toHaveLength(1);

    current = FOURTH;
    const removed = await store.mutate(3, "remove-decision-project", {
      type: "project.remove",
      projectId: "project-decisions",
    });
    expect(removed.workspace.projectDecisionEvents).toEqual([]);
    expect(
      JSON.parse(await readFile(store.primaryPath, "utf8"))
        .projectDecisionEvents,
    ).toEqual([]);
    expect(
      JSON.parse(await readFile(store.backupPath, "utf8"))
        .projectDecisionEvents,
    ).toHaveLength(2);
  });

  it("persists an atomic task move once across an ambiguous retry", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => LATER,
    });
    await store.load();
    await store.mutate(0, "seed-source", {
      type: "project.upsert",
      project: resultProject(),
    });
    await store.mutate(1, "seed-destination", {
      type: "project.upsert",
      project: moveDestinationProject(),
    });
    const mutation = {
      type: "taskLink.move" as const,
      codexTaskId: "codex-results",
      from: {
        projectId: "project-results",
        objectiveId: "objective-results",
        workItemId: "work-results",
        attemptId: "attempt-results",
      },
      to: {
        projectId: "project-destination",
        objectiveId: "objective-destination",
        workItemId: "work-destination",
        attemptId: "attempt-continuation",
      },
      movedAt: LATER,
      baselineResultKey: { kind: "turn" as const, id: "turn-results" },
    };
    const applied = await store.mutate(2, "move-task", mutation);
    const retry = await store.mutate(2, "move-task", mutation);
    expect(retry.workspace.revision).toBe(applied.workspace.revision);
    expect(
      retry.workspace.projects[1].objectives[0].workItems[0].attempts,
    ).toHaveLength(1);
    expect(
      retry.workspace.projects[0].objectives[0].workItems[0].attempts[0]
        .unlinkedAt,
    ).toBe(LATER);
  });

  it("persists distinct atomic attention updates and retries one idempotently", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    await store.load();
    const firstMutation = {
      type: "attention.event" as const,
      eventKey: "task-a:completed:first",
      disposition: { kind: "reviewed" as const, at: NOW },
      snoozedUntil: null,
    };
    const first = await store.mutate(0, "attention-first", firstMutation);
    const retry = await store.mutate(0, "attention-first", firstMutation);
    expect(retry.workspace.revision).toBe(first.workspace.revision);

    const second = await store.mutate(1, "attention-second", {
      type: "attention.event",
      eventKey: "task-b:blocked:second",
      disposition: { kind: "needs_review", at: NOW },
      snoozedUntil: LATER,
    });
    expect(second.workspace.attentionReview.dispositions).toMatchObject({
      "task-a:completed:first": { kind: "reviewed", at: NOW },
      "task-b:blocked:second": { kind: "needs_review", at: NOW },
    });

    await store.mutate(2, "attention-restore-second", {
      type: "attention.event",
      eventKey: "task-b:blocked:second",
      disposition: null,
      snoozedUntil: null,
    });
    const reloaded = await store.load();
    expect(reloaded.workspace.attentionReview.dispositions).toEqual({
      "task-a:completed:first": { kind: "reviewed", at: NOW },
    });
    expect(reloaded.workspace.attentionReview.snoozedUntil).toEqual({});
  });

  it("round-trips an atomic result decision and retries it idempotently", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => LATER,
    });
    await store.load();
    await store.mutate(0, "seed-results", {
      type: "project.upsert",
      project: resultProject(),
    });
    await store.mutate(1, "review-results", {
      type: "result.review",
      projectId: "project-results",
      objectiveId: "objective-results",
      workItemId: "work-results",
      attemptId: "attempt-results",
      resultKey: { kind: "turn", id: "turn-results" },
      reviewedAt: LATER,
    });
    const decision = {
      type: "result.decide" as const,
      projectId: "project-results",
      objectiveId: "objective-results",
      workItemId: "work-results",
      attemptId: "attempt-results",
      resultKey: { kind: "turn" as const, id: "turn-results" },
      decision: { kind: "accepted" as const, decidedAt: LATER },
      evidence: {
        id: "decision-results",
        kind: "decision" as const,
        outcome: "neutral" as const,
        summary: "Accepted the observed result.",
        recordedAt: LATER,
        projectId: "project-results",
        objectiveId: "objective-results",
        workItemId: "work-results",
        attemptId: "attempt-results",
        resultKey: { kind: "turn" as const, id: "turn-results" },
        decisionKind: "accepted" as const,
        provenance: { source: "user" as const },
      },
    };
    const accepted = await store.mutate(2, "decide-results", decision);
    const retry = await store.mutate(2, "decide-results", decision);
    expect(retry.workspace.revision).toBe(accepted.workspace.revision);

    const reloaded = await new CofficeWorkspaceStore({ directory: dir }).load();
    const workItem = reloaded.workspace.projects[0].objectives[0].workItems[0];
    expect(workItem.status).toBe("accepted");
    expect(workItem.attempts[0].resultCycles[0].review?.decision?.kind).toBe(
      "accepted",
    );
    expect(reloaded.workspace.evidence).toHaveLength(1);
    expect(reloaded.workspace.evidence[0].id).toBe("decision-results");
  });

  it("starts an exact verification replay after later revisions and rejects key mismatch", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    await store.load();
    await store.mutate(0, "seed-results", {
      type: "project.upsert",
      project: resultProject(),
    });
    const request = verificationRequest("verification-1");
    const started = await store.startVerification(request);
    expect(started.workspace).toMatchObject({
      revision: 2,
      verificationReceipts: [{ id: "verification-1", state: "queued" }],
    });
    await store.mutate(2, "add-evidence", {
      type: "evidence.append",
      record: {
        id: "evidence-after-start",
        kind: "verification",
        outcome: "neutral",
        summary: "A separate durable write.",
        recordedAt: NOW,
        projectId: "project-results",
        provenance: { source: "coffice" },
      },
    });
    const replay = await store.startVerification({
      ...request,
      id: "discarded-retry-candidate",
    });
    expect(replay.workspace.revision).toBe(3);
    expect(replay.workspace.verificationReceipts).toHaveLength(1);
    await expect(
      store.startVerification({
        ...request,
        profile: { id: "full", version: "1" },
      }),
    ).rejects.toBeInstanceOf(CofficeVerificationIdempotencyError);
  });

  it("compacts terminal verification history without sacrificing active or failed receipts", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    await store.load();
    await store.mutate(0, "seed-capacity-results", {
      type: "project.upsert",
      project: resultProject(),
    });
    const seeded = await store.startVerification(
      verificationRequest("verification-capacity-seed"),
    );
    const template = seeded.workspace.verificationReceipts[0];
    const fullHistory = Array.from({ length: 1_024 }, (_, index) =>
      capacityReceipt(
        template,
        index,
        index === 0 ? "failed" : index === 1 ? "unknown" : "passed",
      ),
    );
    await writeFile(
      store.primaryPath,
      JSON.stringify({
        ...seeded.workspace,
        verificationReceipts: fullHistory,
      }),
      "utf8",
    );

    const next = await store.startVerification(
      verificationRequest("verification-after-capacity"),
    );
    expect(next.workspace.verificationReceipts).toHaveLength(1_024);
    expect(
      next.workspace.verificationReceipts.some(
        (receipt) => receipt.id === "verification-after-capacity",
      ),
    ).toBe(true);
    expect(
      next.workspace.verificationReceipts.some(
        (receipt) => receipt.id === "capacity-0000",
      ),
    ).toBe(true);
    expect(
      next.workspace.verificationReceipts.some(
        (receipt) => receipt.id === "capacity-0001",
      ),
    ).toBe(true);
    expect(
      next.workspace.verificationReceipts.some(
        (receipt) => receipt.id === "capacity-0002",
      ),
    ).toBe(false);
  });

  it("replays at full capacity but never evicts an active receipt", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    await store.load();
    await store.mutate(0, "seed-active-capacity", {
      type: "project.upsert",
      project: resultProject(),
    });
    const request = verificationRequest("verification-capacity-replay");
    const seeded = await store.startVerification(request);
    const template = seeded.workspace.verificationReceipts[0];
    const active = [
      template,
      ...Array.from({ length: 1_023 }, (_, index) =>
        capacityReceipt(template, index, "queued"),
      ),
    ];
    await writeFile(
      store.primaryPath,
      JSON.stringify({ ...seeded.workspace, verificationReceipts: active }),
      "utf8",
    );

    const replay = await store.startVerification({
      ...request,
      id: "discarded-full-capacity-candidate",
    });
    expect(replay.workspace.verificationReceipts).toHaveLength(1_024);
    await expect(
      store.startVerification(
        verificationRequest("verification-capacity-blocked"),
      ),
    ).rejects.toBeInstanceOf(CofficeVerificationCapacityError);
    await expect(
      store.startVerification({
        ...request,
        profile: { id: "different", version: "1" },
      }),
    ).rejects.toBeInstanceOf(CofficeVerificationIdempotencyError);
  });

  it("enforces legal check transitions without changing review, decision, or work state", async () => {
    const dir = await directory();
    let current = NOW;
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => current,
    });
    await store.load();
    await store.mutate(0, "seed-results", {
      type: "project.upsert",
      project: resultProject(),
    });
    await store.startVerification(verificationRequest("verification-1"));
    const before = await store.load();
    const durableWork = structuredClone(before.workspace.projects);
    const durableEvidence = structuredClone(before.workspace.evidence);

    current = LATER;
    await expect(
      store.transitionVerification("verification-1", {
        check: { id: "unit", version: "1" },
        state: "passed",
      }),
    ).rejects.toThrow(/must run before passing/);
    const running = await store.transitionVerification("verification-1", {
      check: { id: "unit", version: "1" },
      state: "running",
    });
    expect(running.workspace.verificationReceipts[0]).toMatchObject({
      state: "running",
      startedAt: LATER,
      checks: [{ state: "running", startedAt: LATER }, { state: "queued" }],
    });

    current = "2026-08-11T12:02:00.000Z";
    const failed = await store.transitionVerification("verification-1", {
      check: { id: "unit", version: "1" },
      state: "failed",
      failureKind: "exit",
      exitCode: 2,
    });
    expect(failed.workspace.verificationReceipts[0]).toMatchObject({
      state: "failed",
      completedAt: current,
      checks: [
        { state: "failed", failureKind: "exit", exitCode: 2 },
        { state: "unknown" },
      ],
    });
    expect(failed.workspace.projects).toEqual(durableWork);
    expect(failed.workspace.evidence).toEqual(durableEvidence);
    await expect(
      store.transitionVerification("verification-1", {
        check: { id: "unit", version: "1" },
        state: "running",
      }),
    ).rejects.toThrow(/terminal check cannot transition/);
  });

  it("reconciles every active receipt to unknown in one durable revision", async () => {
    const dir = await directory();
    let current = NOW;
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => current,
    });
    await store.load();
    await store.mutate(0, "seed-results", {
      type: "project.upsert",
      project: resultProject(),
    });
    await store.startVerification(verificationRequest("verification-1"));
    await store.startVerification(verificationRequest("verification-2"));
    current = LATER;
    await store.transitionVerification("verification-1", {
      check: { id: "unit", version: "1" },
      state: "running",
    });
    const before = await store.load();
    current = "2026-08-11T12:02:00.000Z";
    const reconciled = await store.reconcileActiveVerifications();
    expect(reconciled.workspace.revision).toBe(before.workspace.revision + 1);
    expect(
      reconciled.workspace.verificationReceipts.map((receipt) => receipt.state),
    ).toEqual(["unknown", "unknown"]);
    expect(
      reconciled.workspace.verificationReceipts.every(
        (receipt) => receipt.completedAt === current,
      ),
    ).toBe(true);
    const noOp = await store.reconcileActiveVerifications();
    expect(noOp.workspace.revision).toBe(reconciled.workspace.revision);
  });

  it("loads and recovers legacy workspace-v1.json copies as schema v12", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    await store.load();
    const current = JSON.parse(await readFile(store.primaryPath, "utf8"));
    current.schemaVersion = 1;
    delete current.verificationReceipts;
    delete current.reviewAssessments;
    delete current.projectDecisionEvents;
    delete current.decisionRequests;
    await writeFile(store.primaryPath, JSON.stringify(current), "utf8");
    const loaded = await store.load();
    expect(loaded.workspace).toMatchObject({
      schemaVersion: 12,
      verificationReceipts: [],
      reviewAssessments: [],
      projectDecisionEvents: [],
      decisionRequests: [],
    });

    await writeFile(store.backupPath, JSON.stringify(current), "utf8");
    await writeFile(store.primaryPath, "corrupt", "utf8");
    const recovered = await store.load();
    expect(recovered).toMatchObject({
      workspace: {
        schemaVersion: 12,
        verificationReceipts: [],
        reviewAssessments: [],
        projectDecisionEvents: [],
        decisionRequests: [],
      },
      recovery: { kind: "backup", reason: "primary-corrupt" },
    });
  });

  it("loads a strict schema-v3 file through the unchanged workspace filename", async () => {
    const dir = await directory();
    const store = new CofficeWorkspaceStore({ directory: dir, now: () => NOW });
    await store.load();
    const legacy = JSON.parse(await readFile(store.primaryPath, "utf8"));
    legacy.schemaVersion = 3;
    delete legacy.reviewAssessments;
    delete legacy.projectDecisionEvents;
    delete legacy.decisionRequests;
    await writeFile(store.primaryPath, JSON.stringify(legacy), "utf8");

    const loaded = await store.load();
    expect(path.basename(store.primaryPath)).toBe("workspace-v1.json");
    expect(loaded.workspace).toMatchObject({
      schemaVersion: 12,
      reviewAssessments: [],
      projectDecisionEvents: [],
      decisionRequests: [],
    });
  });

  it("migrates v5, writes current criteria, and rotates cleared raw text from current and backup", async () => {
    const dir = await directory();
    let current = NOW;
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => current,
    });
    await store.load();
    const legacy = JSON.parse(await readFile(store.primaryPath, "utf8"));
    legacy.schemaVersion = 5;
    delete legacy.decisionRequests;
    legacy.projects = [resultProject()];
    const rawCriterion = "Private raw criterion to rotate";
    legacy.projects[0].objectives[0].workItems[0].definitionOfDone = [
      rawCriterion,
    ];
    // v5 must remain strict: simulate a valid v5 file first, then prove current
    // persistence and retention with the field admitted by migration output.
    delete legacy.projects[0].objectives[0].workItems[0].definitionOfDone;
    await writeFile(store.primaryPath, JSON.stringify(legacy), "utf8");
    const migrated = await store.load();
    expect(migrated.workspace.schemaVersion).toBe(12);

    current = LATER;
    const set = await store.mutate(migrated.workspace.revision, "set-v6-dod", {
      type: "workItem.definitionOfDone.set",
      projectId: "project-results",
      objectiveId: "objective-results",
      workItemId: "work-results",
      definitionOfDone: [rawCriterion],
    });
    current = THIRD;
    const cleared = await store.mutate(set.workspace.revision, "clear-v6-dod", {
      type: "workItem.definitionOfDone.set",
      projectId: "project-results",
      objectiveId: "objective-results",
      workItemId: "work-results",
      definitionOfDone: [],
    });
    expect(await readFile(store.primaryPath, "utf8")).not.toContain(
      rawCriterion,
    );
    expect(await readFile(store.backupPath, "utf8")).toContain(rawCriterion);

    await writeFile(store.primaryPath, "corrupt", "utf8");
    const recovered = await store.load();
    expect(recovered.recovery).toEqual({
      kind: "backup",
      reason: "primary-corrupt",
    });
    expect(
      recovered.workspace.projects[0].objectives[0].workItems[0]
        .definitionOfDone,
    ).toEqual([rawCriterion]);

    // Restore the cleared revision and apply a harmless write so both current
    // and the rotated backup contain no raw criterion. Mutation digests remain.
    await writeFile(
      store.primaryPath,
      JSON.stringify(cleared.workspace),
      "utf8",
    );
    current = FOURTH;
    await store.mutate(cleared.workspace.revision, "rotate-cleared-dod", {
      type: "workItem.definitionOfDone.set",
      projectId: "project-results",
      objectiveId: "objective-results",
      workItemId: "work-results",
      definitionOfDone: [],
    });
    expect(await readFile(store.primaryPath, "utf8")).not.toContain(
      rawCriterion,
    );
    expect(await readFile(store.backupPath, "utf8")).not.toContain(
      rawCriterion,
    );
    expect(
      JSON.parse(await readFile(store.primaryPath, "utf8")).mutationReceipts,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "set-v6-dod", hash: expect.any(String) }),
        expect.objectContaining({
          id: "clear-v6-dod",
          hash: expect.any(String),
        }),
      ]),
    );
  });

  it("persists project-rule intents while receipts retain only a digest", async () => {
    const dir = await directory();
    let current = NOW;
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => current,
    });
    const empty = await store.load();
    const created = await store.mutate(
      empty.workspace.revision,
      "add-project",
      {
        type: "project.upsert",
        project: resultProject(),
      },
    );
    const privateRule = "Private current project rule";
    current = LATER;
    const set = await store.mutate(created.workspace.revision, "set-rules", {
      type: "project.rules.set",
      projectId: "project-results",
      rules: [privateRule],
    });
    expect(set.workspace.projects[0].rules).toEqual([privateRule]);
    const retry = await store.mutate(created.workspace.revision, "set-rules", {
      type: "project.rules.set",
      projectId: "project-results",
      rules: [privateRule],
    });
    expect(retry.workspace.revision).toBe(set.workspace.revision);
    await expect(
      store.mutate(created.workspace.revision, "stale-rules", {
        type: "project.rules.set",
        projectId: "project-results",
        rules: ["Stale rule"],
      }),
    ).rejects.toBeInstanceOf(CofficeWorkspaceConflictError);
    expect(await readFile(store.primaryPath, "utf8")).toContain(privateRule);

    current = THIRD;
    const cleared = await store.mutate(set.workspace.revision, "clear-rules", {
      type: "project.rules.set",
      projectId: "project-results",
      rules: [],
    });
    expect(cleared.workspace.projects[0].rules).toBeUndefined();
    const currentRaw = await readFile(store.primaryPath, "utf8");
    expect(currentRaw).not.toContain(privateRule);
    expect(JSON.parse(currentRaw).mutationReceipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "set-rules", hash: expect.any(String) }),
        expect.objectContaining({
          id: "clear-rules",
          hash: expect.any(String),
        }),
      ]),
    );
    expect(currentRaw).not.toContain('"rules":["Private');
    expect(await readFile(store.backupPath, "utf8")).toContain(privateRule);

    current = FOURTH;
    await store.mutate(cleared.workspace.revision, "rotate-cleared-rules", {
      type: "project.rules.set",
      projectId: "project-results",
      rules: [],
    });
    expect(await readFile(store.primaryPath, "utf8")).not.toContain(
      privateRule,
    );
    expect(await readFile(store.backupPath, "utf8")).not.toContain(privateRule);
    expect(
      JSON.stringify((await store.load()).workspace.mutationReceipts),
    ).not.toContain(privateRule);
  });

  it("replays project quality-bar intents, rejects stale writes, and rotates a clear", async () => {
    const dir = await directory();
    let current = NOW;
    const store = new CofficeWorkspaceStore({
      directory: dir,
      now: () => current,
    });
    const empty = await store.load();
    const created = await store.mutate(
      empty.workspace.revision,
      "add-quality-project",
      {
        type: "project.upsert",
        project: resultProject(),
      },
    );
    const qualityBars = [
      { profileId: "test" as const, profileVersion: "1" as const },
      { profileId: "lint" as const, profileVersion: "1" as const },
    ];
    current = LATER;
    const set = await store.mutate(
      created.workspace.revision,
      "set-quality-bars",
      {
        type: "project.qualityBars.set",
        projectId: "project-results",
        qualityBars,
      },
    );
    expect(set.workspace.projects[0].qualityBars).toEqual(qualityBars);
    const replay = await store.mutate(
      created.workspace.revision,
      "set-quality-bars",
      {
        type: "project.qualityBars.set",
        projectId: "project-results",
        qualityBars,
      },
    );
    expect(replay.workspace.revision).toBe(set.workspace.revision);
    await expect(
      store.mutate(created.workspace.revision, "stale-quality-bars", {
        type: "project.qualityBars.set",
        projectId: "project-results",
        qualityBars: [{ profileId: "build", profileVersion: "1" }],
      }),
    ).rejects.toBeInstanceOf(CofficeWorkspaceConflictError);

    current = THIRD;
    const cleared = await store.mutate(
      set.workspace.revision,
      "clear-quality-bars",
      {
        type: "project.qualityBars.set",
        projectId: "project-results",
        qualityBars: [],
      },
    );
    expect(cleared.workspace.projects[0].qualityBars).toBeUndefined();
    expect(await readFile(store.primaryPath, "utf8")).not.toContain(
      '"qualityBars"',
    );
    expect(await readFile(store.backupPath, "utf8")).toContain('"qualityBars"');

    current = FOURTH;
    await store.mutate(
      cleared.workspace.revision,
      "rotate-cleared-quality-bars",
      {
        type: "project.qualityBars.set",
        projectId: "project-results",
        qualityBars: [],
      },
    );
    expect(await readFile(store.primaryPath, "utf8")).not.toContain(
      '"qualityBars"',
    );
    expect(await readFile(store.backupPath, "utf8")).not.toContain(
      '"qualityBars"',
    );
    expect(
      JSON.parse(await readFile(store.primaryPath, "utf8")).mutationReceipts,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "set-quality-bars",
          hash: expect.any(String),
        }),
        expect.objectContaining({
          id: "clear-quality-bars",
          hash: expect.any(String),
        }),
      ]),
    );
  });
});
