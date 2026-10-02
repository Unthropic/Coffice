import { describe, expect, it } from "vitest";

import {
  attentionEventKey,
  clearAttentionEvent,
  createAttentionItem,
  createInitialAttentionReviewState,
  MAX_ATTENTION_REVIEW_STORAGE_BYTES,
  parseAttentionReviewState,
  pruneAttentionReviewState,
  repairInvalidAttentionBaseline,
  resolvedPlanLinkEventKeys,
  restoreAttentionEvent,
  selectAttentionItems,
  serializeAttentionReviewState,
  setAttentionDisposition,
  snoozeAttentionEvent,
  type AttentionProject,
  type AttentionTask,
} from "../src/lib/attention-inbox";

const NOW = "2026-08-10T10:00:00.000Z";

function task(
  id: string,
  value: AttentionTask["status"]["value"],
  timestamp: string,
  options: Partial<AttentionTask> & {
    evidence?: AttentionTask["status"]["evidence"];
    source?: string;
    stale?: boolean;
  } = {},
): AttentionTask {
  return {
    id,
    title: options.title ?? `Task ${id}`,
    updatedAt: options.updatedAt ?? timestamp,
    lastActivityAt: options.lastActivityAt ?? timestamp,
    status: {
      value,
      evidence: options.evidence ?? "observed",
      source: options.source ?? `session-jsonl:event_msg.${value}`,
      timestamp,
      stale: options.stale ?? false,
    },
  };
}

function project(...tasks: AttentionTask[]): AttentionProject {
  return { id: "project-a", name: "Project A", tasks };
}

describe("attention inbox", () => {
  it("admits authoritative blocked goal state, resolves it, and pages a newer recurrence", () => {
    const first = task("goal-blocked", "blocked", "2026-08-10T09:58:00.000Z", {
      source: "codex-app-server:thread/goal/get",
    });
    const state = createInitialAttentionReviewState(NOW);
    const firstItems = selectAttentionItems(
      [project(first)],
      state,
      Date.parse(NOW),
    );
    expect(firstItems).toMatchObject([
      {
        kind: "blocked",
        evidence: "observed",
        reason: "The task reported that it is blocked.",
      },
    ]);

    const reviewed = setAttentionDisposition(
      state,
      firstItems[0].eventKey,
      "reviewed",
      NOW,
    );
    expect(
      selectAttentionItems(
        [project(task("goal-blocked", "active", "2026-08-10T10:01:00.000Z"))],
        reviewed,
        Date.parse("2026-08-10T10:02:00.000Z"),
      ),
    ).toEqual([]);
    const recurrence = selectAttentionItems(
      [
        project(
          task("goal-blocked", "blocked", "2026-08-10T10:03:00.000Z", {
            source: "codex-app-server:thread/goal/get",
          }),
        ),
      ],
      reviewed,
      Date.parse("2026-08-10T10:04:00.000Z"),
    );
    expect(recurrence).toHaveLength(1);
    expect(recurrence[0].eventKey).not.toBe(firstItems[0].eventKey);
  });

  it("keeps a stale exact goal block visible without claiming live confirmation", () => {
    const blocked = task(
      "goal-blocked",
      "blocked",
      "2026-08-10T09:58:00.000Z",
      {
        source: "codex-app-server:thread/goal/get",
        stale: true,
      },
    );
    const items = selectAttentionItems(
      [project(blocked)],
      createInitialAttentionReviewState(NOW),
      Date.parse(NOW),
    );

    expect(items).toMatchObject([
      {
        kind: "blocked",
        stale: true,
        reason:
          "The task was last observed blocked; live confirmation is unavailable.",
      },
    ]);
  });

  it("surfaces a plan-link mismatch and auto-resolves it with workspace state", () => {
    const state = createInitialAttentionReviewState(NOW);
    const projectWithMismatch = {
      ...project(),
      id: "project-b",
      name: "Project B",
      planLinkNotices: [
        {
          kind: "plan_link_mismatch" as const,
          taskId: "task-a",
          taskTitle: "Task A",
          attemptId: "attempt-a",
          linkedProjectName: "Project A",
          occurredAt: null,
        },
      ],
    };

    expect(
      selectAttentionItems([projectWithMismatch], state, Date.parse(NOW)),
    ).toMatchObject([
      {
        kind: "plan_link_mismatch",
        openTaskId: "task-a",
        reason:
          "Codex now assigns this task here, but its active plan link remains in Project A.",
        recommendedAction: "Move plan link",
      },
    ]);
    expect(
      selectAttentionItems(
        [{ ...projectWithMismatch, planLinkNotices: [] }],
        state,
        Date.parse(NOW),
      ),
    ).toEqual([]);
  });

  it("clears a resolved plan-link disposition so the same mismatch can recur", () => {
    const projectWithMismatch = {
      ...project(),
      id: "project-b",
      name: "Project B",
      planLinkNotices: [
        {
          kind: "plan_link_mismatch" as const,
          taskId: "task-a",
          taskTitle: "Task A",
          attemptId: "attempt-a",
          linkedProjectName: "Project A",
          occurredAt: null,
        },
      ],
    };
    const eventKey = selectAttentionItems(
      [projectWithMismatch],
      createInitialAttentionReviewState(NOW),
      Date.parse(NOW),
    )[0].eventKey;
    const reviewed = setAttentionDisposition(
      createInitialAttentionReviewState(NOW),
      eventKey,
      "reviewed",
      NOW,
    );
    expect(
      selectAttentionItems([projectWithMismatch], reviewed, Date.parse(NOW)),
    ).toEqual([]);

    const resolvedProjects = [{ ...projectWithMismatch, planLinkNotices: [] }];
    expect(resolvedPlanLinkEventKeys(reviewed, resolvedProjects)).toEqual([
      eventKey,
    ]);
    const reset = clearAttentionEvent(reviewed, eventKey);
    expect(
      selectAttentionItems([projectWithMismatch], reset, Date.parse(NOW)),
    ).toHaveLength(1);
  });

  it("admits only failed durable quality receipts and deduplicates their exact event", () => {
    const failed = {
      id: "receipt-a",
      state: "failed" as const,
      completedAt: "2026-08-10T10:05:00.000Z",
      target: {
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
        resultKey: { kind: "revision" as const, id: "result-a" },
      },
      workItemTitle: "Review the durable result",
      resultObservedAt: "2026-08-10T10:04:00.000Z",
      taskId: "task-a",
      taskTitle: "Live task A",
    };
    const state = createInitialAttentionReviewState(NOW);
    const items = selectAttentionItems(
      [
        {
          ...project(),
          verificationReceipts: [
            failed,
            { ...failed },
            { ...failed, id: "receipt-passed", state: "passed" as const },
            { ...failed, id: "receipt-running", state: "running" as const },
            { ...failed, id: "receipt-unknown", state: "unknown" as const },
          ],
        },
      ],
      state,
      Date.parse(NOW),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      eventKey: "verification:receipt-a",
      kind: "verification_failed",
      taskId: "task-a",
      taskTitle: "Live task A",
      verificationTarget: failed.target,
    });
    expect(items[0].openTaskId).toBeUndefined();
    const reviewed = setAttentionDisposition(
      state,
      items[0].eventKey,
      "reviewed",
      NOW,
    );
    expect(
      selectAttentionItems(
        [{ ...project(), verificationReceipts: [failed] }],
        reviewed,
        Date.parse(NOW),
      ),
    ).toEqual([]);
    expect(failed.state).toBe("failed");
  });

  it("keeps an archived task's failed receipt actionable through stored work context", () => {
    const items = selectAttentionItems(
      [
        {
          ...project(),
          verificationReceipts: [
            {
              id: "receipt-archived",
              state: "failed",
              completedAt: "2026-08-10T10:05:00.000Z",
              target: {
                projectId: "project-a",
                objectiveId: "objective-a",
                workItemId: "work-a",
                attemptId: "attempt-archived",
                resultKey: { kind: "revision", id: "result-a" },
              },
              workItemTitle: "Stored work result",
              resultObservedAt: "2026-08-10T10:04:00.000Z",
            },
          ],
        },
      ],
      createInitialAttentionReviewState(NOW),
      Date.parse(NOW),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      taskTitle: "Stored work result",
      recommendedAction: "Review the stored work result",
    });
    expect(items[0].openTaskId).toBeUndefined();
  });

  it("repairs only the invalid epoch baseline and keeps live input or failure evidence actionable", () => {
    const eventKey = "task-snoozed:failed:2026-08-10T09:30:00.000Z";
    const invalid = {
      ...createInitialAttentionReviewState("not-a-timestamp"),
      dispositions: {
        [eventKey]: { kind: "needs_review" as const, at: NOW },
      },
      snoozedUntil: {
        [eventKey]: "2026-08-10T11:00:00.000Z",
      },
    };
    const repaired = repairInvalidAttentionBaseline(invalid, NOW);
    const items = selectAttentionItems(
      [
        project(
          task("old-result", "completed", "2026-08-09T09:00:00.000Z"),
          task("input", "waiting_for_user", "2026-08-09T09:00:00.000Z"),
          task("failed", "failed", "2026-08-09T09:00:00.000Z"),
        ),
      ],
      repaired,
      Date.parse(NOW),
    );

    expect(repaired.initializedAt).toBe(NOW);
    expect(repaired.dispositions).toBe(invalid.dispositions);
    expect(repaired.snoozedUntil).toBe(invalid.snoozedUntil);
    expect(items.map((item) => item.kind)).toEqual([
      "needs_input",
      "task_failed",
    ]);

    const historical = createInitialAttentionReviewState(
      "2025-01-01T00:00:00.000Z",
    );
    expect(repairInvalidAttentionBaseline(historical, NOW)).toBe(historical);
  });

  it("baselines historical completions without hiding current input and failure states", () => {
    const tasks = Array.from({ length: 83 }, (_, index) =>
      task(
        `done-${index}`,
        "completed",
        `2026-08-09T09:${String(index % 60).padStart(2, "0")}:00.000Z`,
      ),
    );
    tasks.push(
      task("input", "waiting_for_user", "2026-08-10T09:59:00.000Z"),
      task("failed", "failed", "2026-08-10T09:58:00.000Z"),
    );
    const projects = [project(...tasks)];
    const state = createInitialAttentionReviewState(NOW);
    const items = selectAttentionItems(projects, state, Date.parse(NOW));

    expect(items.map((item) => item.kind)).toEqual([
      "needs_input",
      "task_failed",
    ]);
    expect(Object.values(state.dispositions)).toHaveLength(0);
    expect(items.every((item) => !item.reason.includes("idle"))).toBe(true);
  });

  it("creates one review item for a new completion after the baseline", () => {
    const state = createInitialAttentionReviewState("2026-08-10T09:00:00.000Z");
    const newer = task("result", "completed", "2026-08-10T10:05:00.000Z");
    const items = selectAttentionItems(
      [project(newer)],
      state,
      Date.parse("2026-08-10T10:06:00.000Z"),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "ready_for_review",
      taskId: "result",
      reason: "A new completed result is ready for review.",
    });
  });

  it("baselines an arbitrarily large historical result set with constant-size storage", () => {
    const historical = Array.from({ length: 1_000 }, (_, index) =>
      task(
        `historical-${index}`,
        "completed",
        `2026-08-09T${String(index % 24).padStart(2, "0")}:${String(
          index % 60,
        ).padStart(2, "0")}:00.000Z`,
      ),
    );
    const state = createInitialAttentionReviewState(NOW);

    expect(
      selectAttentionItems([project(...historical)], state, Date.parse(NOW)),
    ).toHaveLength(0);
    expect(state.dispositions).toEqual({});
    expect(serializeAttentionReviewState(state).length).toBeLessThan(200);
  });

  it("keeps 601 reviewed completions and does not resurrect one after a partial roster refresh", () => {
    const results = Array.from({ length: 601 }, (_, index) =>
      task(
        `result-${index}`,
        "completed",
        `2026-08-10T11:${String(index % 60).padStart(2, "0")}:00.000Z`,
      ),
    );
    const reviewed = results.reduce(
      (state, result) =>
        setAttentionDisposition(
          state,
          attentionEventKey(result),
          "reviewed",
          "2026-08-10T12:00:00.000Z",
        ),
      createInitialAttentionReviewState(NOW),
    );

    expect(Object.keys(reviewed.dispositions)).toHaveLength(601);
    expect(
      selectAttentionItems(
        [project(...results)],
        reviewed,
        Date.parse("2026-08-10T12:00:00.000Z"),
      ),
    ).toHaveLength(0);
    expect(
      parseAttentionReviewState(serializeAttentionReviewState(reviewed)),
    ).toEqual(reviewed);

    const pruned = pruneAttentionReviewState(reviewed, []);
    expect(Object.keys(pruned.dispositions)).toHaveLength(601);
    expect(
      selectAttentionItems(
        [project(results[0])],
        pruned,
        Date.parse("2026-08-10T12:01:00.000Z"),
      ),
    ).toHaveLength(0);
  });

  it("applies one byte bound to dispositions and snoozes together", () => {
    const dispositions: Record<
      string,
      { kind: "needs_review" | "reviewed"; at: string }
    > = {};
    const snoozedUntil: Record<string, string> = {};
    const maxKey = (index: number, status = "failed") => {
      const suffix = `:${status}:2026-08-10T11:00:00.000Z`;
      const prefix = `event-${String(index).padStart(4, "0")}-`;
      return `${prefix}${"x".repeat(320 - prefix.length - suffix.length)}${suffix}`;
    };

    for (let index = 0; index < 1_000; index += 1) {
      const eventKey = maxKey(index);
      dispositions[eventKey] = {
        kind: "needs_review",
        at: `2026-08-10T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
      };
      snoozedUntil[eventKey] = "2026-08-11T10:00:00.000Z";
    }
    const protectedCompletionKey = maxKey(1_001, "completed");
    dispositions[protectedCompletionKey] = {
      kind: "reviewed",
      at: "2026-08-10T10:01:00.000Z",
    };

    const serialized = serializeAttentionReviewState({
      version: 2,
      initializedAt: NOW,
      dispositions,
      snoozedUntil,
    });
    const parsed = parseAttentionReviewState(serialized);

    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      MAX_ATTENTION_REVIEW_STORAGE_BYTES,
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.dispositions[protectedCompletionKey]).toEqual({
      kind: "reviewed",
      at: "2026-08-10T10:01:00.000Z",
    });
    expect(
      Object.keys(parsed?.snoozedUntil ?? {}).every(
        (eventKey) => parsed?.dispositions[eventKey]?.kind === "needs_review",
      ),
    ).toBe(true);
    expect(serializeAttentionReviewState(parsed!)).toBe(serialized);
  });

  it("migrates v1 state and makes an orphaned snooze return after expiry", () => {
    const completed = task(
      "legacy-result",
      "completed",
      "2026-08-10T09:00:00.000Z",
    );
    const eventKey = attentionEventKey(completed);
    const migrated = parseAttentionReviewState(
      JSON.stringify({
        version: 1,
        initializedAt: NOW,
        dispositions: {},
        snoozedUntil: { [eventKey]: "2026-08-10T11:00:00.000Z" },
      }),
    );

    expect(migrated).toMatchObject({
      version: 2,
      dispositions: {
        [eventKey]: { kind: "needs_review", at: NOW },
      },
    });
    expect(
      selectAttentionItems(
        [project(completed)],
        migrated!,
        Date.parse("2026-08-10T10:30:00.000Z"),
      ),
    ).toHaveLength(0);
    expect(
      selectAttentionItems(
        [project(completed)],
        migrated!,
        Date.parse("2026-08-10T11:01:00.000Z"),
      ),
    ).toHaveLength(1);
  });

  it("uses the semantic status timestamp so unrelated updatedAt changes do not duplicate an event", () => {
    const first = task("same-result", "completed", "2026-08-10T10:05:00.000Z", {
      updatedAt: "2026-08-10T10:06:00.000Z",
    });
    const metadataUpdate = task(
      "same-result",
      "completed",
      "2026-08-10T10:05:00.000Z",
      { updatedAt: "2026-08-10T10:07:00.000Z" },
    );
    expect(attentionEventKey(first)).toBe(attentionEventKey(metadataUpdate));
  });

  it("does not invent an attention event from general activity timestamps", () => {
    const withoutStatusTimestamp = task(
      "unknown-revision",
      "completed",
      "2026-08-10T10:05:00.000Z",
      { updatedAt: "2026-08-10T10:06:00.000Z" },
    );
    withoutStatusTimestamp.status.timestamp = null;

    expect(
      createAttentionItem(
        project(withoutStatusTimestamp),
        withoutStatusTimestamp,
      ),
    ).toBeNull();
  });

  it("hides a reviewed revision and resurfaces a later result", () => {
    const initial = createInitialAttentionReviewState(NOW);
    const first = task("result", "completed", "2026-08-10T10:05:00.000Z");
    const reviewed = setAttentionDisposition(
      initial,
      attentionEventKey(first),
      "reviewed",
      "2026-08-10T10:06:00.000Z",
    );
    expect(
      selectAttentionItems([project(first)], reviewed, Date.parse(NOW)),
    ).toHaveLength(0);

    const later = task("result", "completed", "2026-08-10T10:10:00.000Z");
    expect(
      selectAttentionItems(
        [project(later)],
        reviewed,
        Date.parse("2026-08-10T10:11:00.000Z"),
      ),
    ).toHaveLength(1);
  });

  it("treats an exact durable result review as resolved without an Attention disposition", () => {
    const state = createInitialAttentionReviewState(NOW);
    const first = task("result", "completed", "2026-08-10T10:05:00.000Z");
    const firstKey = attentionEventKey(first);

    expect(
      selectAttentionItems(
        [project(first)],
        state,
        Date.parse("2026-08-10T10:06:00.000Z"),
        new Set([firstKey]),
      ),
    ).toEqual([]);
    expect(state.dispositions[firstKey]).toBeUndefined();

    const later = task("result", "completed", "2026-08-10T10:10:00.000Z");
    expect(
      selectAttentionItems(
        [project(later)],
        state,
        Date.parse("2026-08-10T10:11:00.000Z"),
        new Set([firstKey]),
      ).map((item) => item.eventKey),
    ).toEqual([attentionEventKey(later)]);
  });

  it("keeps a persistent staff completion on one semantic revision after it settles to idle", () => {
    const completed = task(
      "resident",
      "completed",
      "2026-08-10T09:00:00.000Z",
      { source: "session-jsonl:event_msg.task_complete" },
    );
    const settled = task("resident", "idle", "2026-08-10T09:00:00.000Z", {
      evidence: "inferred",
      source: "session-jsonl:event_msg.task_complete",
      stale: true,
    });

    expect(attentionEventKey(completed)).toBe(attentionEventKey(settled));
    expect(createAttentionItem(project(settled), settled)?.kind).toBe(
      "ready_for_review",
    );
  });

  it("rejects weak current-state inferences and stale decision signals", () => {
    const inferredFailure = task("weak", "failed", "2026-08-10T09:00:00.000Z", {
      evidence: "inferred",
    });
    const staleWaiting = task(
      "old-input",
      "waiting_for_user",
      "2026-08-09T09:00:00.000Z",
      { stale: true },
    );
    expect(
      createAttentionItem(project(inferredFailure), inferredFailure),
    ).toBeNull();
    expect(createAttentionItem(project(staleWaiting), staleWaiting)).toBeNull();
  });

  it("calls a generic failure a task failure, never a verification failure", () => {
    const failed = task("failed", "failed", "2026-08-10T09:58:00.000Z");
    const item = createAttentionItem(project(failed), failed);
    expect(item).toMatchObject({
      kind: "task_failed",
      reason: "The task reported a failure.",
    });
    expect(JSON.stringify(item)).not.toMatch(/verification failed/i);
  });

  it("snoozes, dismisses, and restores the exact event without hiding a new revision", () => {
    const failed = task("failed", "failed", "2026-08-10T09:58:00.000Z");
    const initial = createInitialAttentionReviewState(NOW);
    const snoozed = snoozeAttentionEvent(
      initial,
      attentionEventKey(failed),
      "2026-08-10T11:00:00.000Z",
      NOW,
    );
    expect(
      selectAttentionItems([project(failed)], snoozed, Date.parse(NOW)),
    ).toHaveLength(0);
    expect(
      selectAttentionItems(
        [project(failed)],
        snoozed,
        Date.parse("2026-08-10T11:01:00.000Z"),
      ),
    ).toHaveLength(1);

    const dismissed = setAttentionDisposition(
      snoozed,
      attentionEventKey(failed),
      "dismissed",
      NOW,
    );
    expect(
      selectAttentionItems([project(failed)], dismissed, Date.parse(NOW)),
    ).toHaveLength(0);
    const restored = restoreAttentionEvent(
      dismissed,
      attentionEventKey(failed),
      "2026-08-10T11:02:00.000Z",
    );
    expect(
      selectAttentionItems([project(failed)], restored, Date.parse(NOW)),
    ).toHaveLength(1);
  });

  it("orders input, failure, blocker, and completed result by understandable urgency", () => {
    const projects = [
      project(
        task("done", "completed", "2026-08-10T09:59:59.000Z"),
        task("blocked", "blocked", "2026-08-10T09:59:58.000Z"),
        task("failed", "failed", "2026-08-10T09:59:57.000Z"),
        task("input", "waiting_for_user", "2026-08-10T09:59:56.000Z"),
      ),
    ];
    const state = createInitialAttentionReviewState("2026-08-10T09:00:00.000Z");
    expect(
      selectAttentionItems(projects, state, Date.parse(NOW)).map(
        (item) => item.kind,
      ),
    ).toEqual(["needs_input", "task_failed", "blocked", "ready_for_review"]);
  });

  it("validates bounded storage and persists no task title or content", () => {
    const privateTitle = "Do not persist this private task title";
    const completed = task(
      "opaque-id",
      "completed",
      "2026-08-10T09:00:00.000Z",
      { title: privateTitle },
    );
    const state = setAttentionDisposition(
      createInitialAttentionReviewState(NOW),
      attentionEventKey(completed),
      "reviewed",
      NOW,
    );
    const serialized = serializeAttentionReviewState(state);

    expect(serialized).not.toContain(privateTitle);
    expect(serialized).not.toMatch(/prompt|response|transcript/i);
    expect(parseAttentionReviewState(serialized)).toEqual(state);
    expect(parseAttentionReviewState("not json")).toBeNull();
    expect(
      parseAttentionReviewState(JSON.stringify({ ...state, version: 99 })),
    ).toBeNull();
  });
});
