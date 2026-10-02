import { describe, expect, it } from "vitest";

import {
  selectNextResultObservation,
  selectPlanLinkAttentionNotices,
  selectVerificationAttentionReceipts,
} from "../src/components/coffice-app";
import {
  createVerificationReceipt,
  createEmptyCofficeWorkspace,
  reduceCofficeWorkspace,
  transitionVerificationReceipt,
  type VerificationReceipt,
  type VerificationTarget,
} from "../src/lib/coffice-workspace";
import { selectReviewedResultAttentionEventKeys } from "../src/lib/result-attention";

const NOW = "2026-08-11T12:00:00.000Z";
const LATER = "2026-08-11T12:05:00.000Z";

function workspace() {
  return reduceCofficeWorkspace(
    createEmptyCofficeWorkspace(NOW),
    {
      type: "project.upsert",
      project: {
        id: "project-a",
        title: "Project A",
        createdAt: NOW,
        updatedAt: NOW,
        objectives: [
          {
            id: "objective-a",
            title: "Ship the result loop",
            status: "active",
            createdAt: NOW,
            updatedAt: NOW,
            workItems: [
              {
                id: "work-a",
                title: "Review repeated results",
                expectedOutcome: "Each new completion can be reviewed once.",
                status: "in_progress",
                createdAt: NOW,
                updatedAt: NOW,
                attempts: [
                  {
                    id: "attempt-a",
                    codexTaskId: "task-a",
                    relationship: "primary",
                    linkedAt: NOW,
                    resultCycles: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    NOW,
  );
}

function projects(timestamp = NOW, stale = false) {
  return [
    {
      id: "project-a",
      name: "Project A",
      order: 0,
      tasks: [
        {
          id: "task-a",
          title: "Complete the slice",
          kind: "temporary" as const,
          assignmentEvidence: "explicit_project" as const,
          updatedAt: timestamp,
          status: {
            value: "completed" as const,
            evidence: "observed" as const,
            source: "turn_complete",
            timestamp,
            stale,
          },
        },
      ],
    },
  ];
}

function projectB(timestamp: string) {
  return [
    {
      ...projects(timestamp)[0],
      id: "project-b",
      name: "Project B",
      tasks: projects(timestamp)[0].tasks.map((task) => ({
        ...task,
        projectId: "project-b",
      })),
    },
  ];
}

function completedVerificationReceipt(
  target: VerificationTarget,
  id: string,
  profileId: string,
  state: "passed" | "failed" | "unknown",
  at: string,
  profileVersion = "1",
): VerificationReceipt {
  const queued = createVerificationReceipt(
    {
      id,
      idempotencyKey: `request-${id}`,
      target,
      profile: { id: profileId, version: profileVersion },
      checks: [{ id: profileId, version: profileVersion }],
    },
    "a".repeat(64),
    at,
  );
  const running = transitionVerificationReceipt(
    queued,
    { check: { id: profileId, version: profileVersion }, state: "running" },
    at,
  );
  return transitionVerificationReceipt(
    running,
    {
      check: { id: profileId, version: profileVersion },
      state,
      ...(state === "failed"
        ? { failureKind: "exit" as const, exitCode: 1 }
        : {}),
    },
    at,
  );
}

describe("durable result observation", () => {
  it("observes one completed revision and ignores it after persistence", () => {
    const initial = workspace();
    const selected = selectNextResultObservation(
      initial,
      projects(),
      new Set(),
      LATER,
    );

    expect(selected).toMatchObject({
      guardKey: expect.stringContaining("attempt-a:"),
      mutation: {
        type: "result.upsert",
        attemptId: "attempt-a",
        result: {
          key: { kind: "revision", id: `task-a:completed:${NOW}` },
          observedAt: NOW,
        },
      },
    });
    const persisted = reduceCofficeWorkspace(
      initial,
      selected!.mutation,
      LATER,
    );
    expect(
      selectNextResultObservation(persisted, projects(), new Set(), LATER),
    ).toBeNull();
  });

  it("observes a later completion on the same task link", () => {
    const first = selectNextResultObservation(
      workspace(),
      projects(),
      new Set(),
      LATER,
    )!;
    const persisted = reduceCofficeWorkspace(
      workspace(),
      first.mutation,
      LATER,
    );

    expect(
      selectNextResultObservation(persisted, projects(LATER), new Set(), LATER),
    ).toMatchObject({
      mutation: {
        result: {
          key: { kind: "revision", id: `task-a:completed:${LATER}` },
          observedAt: LATER,
        },
      },
    });
  });

  it("resolves only the exact reviewed revision key", () => {
    const first = selectNextResultObservation(
      workspace(),
      projects(),
      new Set(),
      LATER,
    )!;
    const observed = reduceCofficeWorkspace(workspace(), first.mutation, LATER);
    const reviewed = reduceCofficeWorkspace(
      observed,
      {
        type: "result.review",
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
        resultKey: {
          kind: "revision",
          id: `task-a:completed:${NOW}`,
        },
        reviewedAt: LATER,
      },
      LATER,
    );

    expect([...selectReviewedResultAttentionEventKeys(reviewed)]).toEqual([
      `task-a:completed:${NOW}`,
    ]);

    const next = "2026-08-11T12:10:00.000Z";
    const later = selectNextResultObservation(
      reviewed,
      projects(next),
      new Set(),
      next,
    )!;
    const withLater = reduceCofficeWorkspace(reviewed, later.mutation, next);
    expect([...selectReviewedResultAttentionEventKeys(withLater)]).toEqual([
      `task-a:completed:${NOW}`,
    ]);
  });

  it("persists a completion retained as an inferred idle status", () => {
    const retained = projects().map((project) => ({
      ...project,
      tasks: project.tasks.map((task) => ({
        ...task,
        status: {
          value: "idle" as const,
          evidence: "inferred" as const,
          source: "session-jsonl:event_msg.turn_complete",
          timestamp: NOW,
          stale: true,
        },
      })),
    }));

    expect(
      selectNextResultObservation(workspace(), retained, new Set(), LATER),
    ).toMatchObject({
      mutation: {
        type: "result.upsert",
        result: {
          key: { kind: "revision", id: `task-a:completed:${NOW}` },
          observedAt: NOW,
        },
      },
    });
  });

  it("does not duplicate the baseline result after a move and observes a later destination revision", () => {
    const withDestination = reduceCofficeWorkspace(
      workspace(),
      {
        type: "project.upsert",
        project: {
          id: "project-b",
          title: "Project B",
          createdAt: NOW,
          updatedAt: LATER,
          objectives: [
            {
              id: "objective-b",
              title: "Continue the result loop",
              status: "active",
              createdAt: NOW,
              updatedAt: LATER,
              workItems: [
                {
                  id: "work-b",
                  title: "Review future results",
                  expectedOutcome: "Only a later result appears here.",
                  status: "in_progress",
                  createdAt: NOW,
                  updatedAt: LATER,
                  attempts: [],
                },
              ],
            },
          ],
        },
      },
      LATER,
    );
    const moved = reduceCofficeWorkspace(
      withDestination,
      {
        type: "taskLink.move",
        codexTaskId: "task-a",
        from: {
          projectId: "project-a",
          objectiveId: "objective-a",
          workItemId: "work-a",
          attemptId: "attempt-a",
        },
        to: {
          projectId: "project-b",
          objectiveId: "objective-b",
          workItemId: "work-b",
          attemptId: "attempt-b",
        },
        movedAt: LATER,
        baselineResultKey: {
          kind: "revision",
          id: `task-a:completed:${NOW}`,
        },
      },
      LATER,
    );

    expect(
      selectNextResultObservation(moved, projectB(NOW), new Set(), LATER),
    ).toBeNull();
    const next = "2026-08-11T12:10:00.000Z";
    expect(
      selectNextResultObservation(moved, projectB(next), new Set(), next),
    ).toMatchObject({
      mutation: {
        projectId: "project-b",
        workItemId: "work-b",
        attemptId: "attempt-b",
        result: { observedAt: next },
      },
    });
    const clockSkewed = "2026-08-11T11:55:00.000Z";
    expect(
      selectNextResultObservation(
        moved,
        projectB(clockSkewed),
        new Set(),
        next,
      ),
    ).toMatchObject({
      mutation: {
        projectId: "project-b",
        result: {
          key: { id: `task-a:completed:${clockSkewed}` },
          observedAt: clockSkewed,
        },
      },
    });
  });

  it("stores a reassigned task's current completion in its still-open source link", () => {
    expect(
      selectNextResultObservation(workspace(), projectB(NOW), new Set(), LATER),
    ).toMatchObject({
      mutation: {
        projectId: "project-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
        result: { key: { id: `task-a:completed:${NOW}` } },
      },
    });
  });

  it("stores an explicitly unassigned task's completion in its still-open source link", () => {
    const unassigned = projectB(NOW).map((project) => ({
      ...project,
      id: "__unassigned__",
      tasks: project.tasks.map((task) => ({
        ...task,
        assignmentEvidence: "explicit_unassigned" as const,
      })),
    }));
    expect(
      selectNextResultObservation(workspace(), unassigned, new Set(), LATER),
    ).toMatchObject({
      mutation: { projectId: "project-a", attemptId: "attempt-a" },
    });
  });

  it("reports an actionable project mismatch only from explicit fresh assignment evidence", () => {
    expect(
      selectPlanLinkAttentionNotices(workspace(), projectB(LATER)[0]),
    ).toEqual([
      expect.objectContaining({
        kind: "plan_link_mismatch",
        taskId: "task-a",
        attemptId: "attempt-a",
        linkedProjectName: "Project A",
      }),
    ]);
    expect(
      selectPlanLinkAttentionNotices(workspace(), {
        ...projectB(LATER)[0],
        tasks: projectB(LATER)[0].tasks.map((task) => ({
          ...task,
          assignmentSourceFresh: false,
        })),
      }),
    ).toEqual([]);
  });

  it("does not persist stale or already-pending observations", () => {
    const current = workspace();
    const selected = selectNextResultObservation(
      current,
      projects(),
      new Set(),
      LATER,
    )!;

    expect(
      selectNextResultObservation(
        current,
        projects(NOW, true),
        new Set(),
        LATER,
      ),
    ).toBeNull();
    expect(
      selectNextResultObservation(
        current,
        projects(),
        new Set([selected.guardKey]),
        LATER,
      ),
    ).toBeNull();
  });

  it("joins a failed receipt to its exact result and remains honest after task archival", () => {
    const selected = selectNextResultObservation(
      workspace(),
      projects(),
      new Set(),
      LATER,
    )!;
    const persisted = reduceCofficeWorkspace(
      workspace(),
      selected.mutation,
      LATER,
    );
    const target = {
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-a",
      attemptId: "attempt-a",
      resultKey:
        selected.mutation.type === "result.upsert"
          ? selected.mutation.result.key
          : { kind: "revision" as const, id: "unreachable" },
    };
    const queued = createVerificationReceipt(
      {
        id: "receipt-a",
        idempotencyKey: "request-a",
        target,
        profile: { id: "test", version: "1" },
        checks: [{ id: "test", version: "1" }],
      },
      "a".repeat(64),
      LATER,
    );
    const running = transitionVerificationReceipt(
      queued,
      { check: { id: "test", version: "1" }, state: "running" },
      LATER,
    );
    const failed = transitionVerificationReceipt(
      running,
      {
        check: { id: "test", version: "1" },
        state: "failed",
        failureKind: "exit",
        exitCode: 1,
      },
      LATER,
    );
    const withReceipt = { ...persisted, verificationReceipts: [failed] };

    expect(
      selectVerificationAttentionReceipts(withReceipt, projects()[0]),
    ).toMatchObject([
      {
        id: "receipt-a",
        state: "failed",
        taskId: "task-a",
        taskTitle: "Complete the slice",
        workItemTitle: "Review repeated results",
        resultObservedAt: NOW,
      },
    ]);
    expect(
      selectVerificationAttentionReceipts(withReceipt, {
        ...projects()[0],
        tasks: [],
      }),
    ).toMatchObject([
      {
        id: "receipt-a",
        workItemTitle: "Review repeated results",
      },
    ]);
    expect(
      selectVerificationAttentionReceipts(withReceipt, {
        ...projects()[0],
        tasks: [],
      })[0],
    ).not.toHaveProperty("taskId");
  });

  it("keeps only the latest decisive outcome for an exact result and profile", () => {
    const selected = selectNextResultObservation(
      workspace(),
      projects(),
      new Set(),
      LATER,
    )!;
    const observed = reduceCofficeWorkspace(
      workspace(),
      selected.mutation,
      LATER,
    );
    const target: VerificationTarget = {
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-a",
      attemptId: "attempt-a",
      resultKey:
        selected.mutation.type === "result.upsert"
          ? selected.mutation.result.key
          : { kind: "revision", id: "unreachable" },
    };
    const failed = completedVerificationReceipt(
      target,
      "failed-first",
      "test",
      "failed",
      "2026-08-11T12:06:00.000Z",
    );
    const passed = completedVerificationReceipt(
      target,
      "passed-later",
      "test",
      "passed",
      "2026-08-11T12:07:00.000Z",
    );

    expect(
      selectVerificationAttentionReceipts(
        { ...observed, verificationReceipts: [failed, passed] },
        projects()[0],
      ),
    ).toEqual([]);

    const differentProfilePass = completedVerificationReceipt(
      target,
      "lint-passed",
      "lint",
      "passed",
      "2026-08-11T12:08:00.000Z",
    );
    const differentProfileVersionPass = completedVerificationReceipt(
      target,
      "test-v2-passed",
      "test",
      "passed",
      "2026-08-11T12:08:30.000Z",
      "2",
    );
    const differentResultPass = completedVerificationReceipt(
      {
        ...target,
        resultKey: { kind: "revision", id: "different-result" },
      },
      "other-result-passed",
      "test",
      "passed",
      "2026-08-11T12:09:00.000Z",
    );
    const observedWithDifferentResult = reduceCofficeWorkspace(
      observed,
      {
        type: "result.upsert",
        projectId: target.projectId,
        objectiveId: target.objectiveId,
        workItemId: target.workItemId,
        attemptId: target.attemptId,
        result: {
          key: differentResultPass.target.resultKey,
          observedAt: "2026-08-11T12:08:45.000Z",
        },
      },
      "2026-08-11T12:08:45.000Z",
    );
    expect(
      selectVerificationAttentionReceipts(
        {
          ...observedWithDifferentResult,
          verificationReceipts: [
            failed,
            differentProfilePass,
            differentProfileVersionPass,
            differentResultPass,
          ],
        },
        projects()[0],
      ).map((receipt) => receipt.id),
    ).toEqual(["failed-first"]);

    const queued = createVerificationReceipt(
      {
        id: "queued-later",
        idempotencyKey: "request-queued-later",
        target,
        profile: { id: "test", version: "1" },
        checks: [{ id: "test", version: "1" }],
      },
      "b".repeat(64),
      "2026-08-11T12:10:00.000Z",
    );
    const running = transitionVerificationReceipt(
      queued,
      { check: { id: "test", version: "1" }, state: "running" },
      "2026-08-11T12:10:00.000Z",
    );
    const unknown = completedVerificationReceipt(
      target,
      "unknown-later",
      "test",
      "unknown",
      "2026-08-11T12:11:00.000Z",
    );
    expect(
      selectVerificationAttentionReceipts(
        {
          ...observed,
          verificationReceipts: [failed, queued, running, unknown],
        },
        projects()[0],
      ).map((receipt) => receipt.id),
    ).toEqual(["failed-first"]);

    const reopened = completedVerificationReceipt(
      target,
      "failed-reopened",
      "test",
      "failed",
      "2026-08-11T20:07:00.000+08:00",
    );
    expect(
      selectVerificationAttentionReceipts(
        {
          ...observed,
          verificationReceipts: [failed, passed, reopened],
        },
        projects()[0],
      ).map((receipt) => receipt.id),
    ).toEqual(["failed-reopened"]);
  });
});
