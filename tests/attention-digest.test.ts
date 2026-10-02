import { describe, expect, it } from "vitest";

import {
  ATTENTION_DIGEST_HOLDING_GROUP_KEY,
  selectAttentionDigest,
  selectAttentionProjectProjection,
} from "../src/lib/attention-digest";
import type {
  AttentionDisposition,
  AttentionItem,
  AttentionKind,
} from "../src/lib/attention-inbox";

const EMPTY_COUNTS = {
  needsReply: 0,
  needsDecision: 0,
  unreadResults: 0,
  otherActions: 0,
  total: 0,
};

function item(
  eventKey: string,
  kind: AttentionKind,
  projectId: string,
  projectName: string,
  priority: number,
): AttentionItem {
  return {
    eventKey,
    kind,
    priority,
    projectId,
    projectName,
    taskId: `task-${eventKey}`,
    taskTitle: `Task ${eventKey}`,
    occurredAt: "2026-08-12T10:00:00.000Z",
    status:
      kind === "needs_input"
        ? "waiting_for_user"
        : kind === "ready_for_review"
          ? "completed"
          : "failed",
    evidence: "observed",
    stale: false,
    reason: "Reason",
    recommendedAction: "Act",
  };
}

describe("attention digest", () => {
  it("groups in Attention order, preserves item order, and counts each event once", () => {
    const items = [
      item("reply-b", "needs_input", "b", "Project B", 0),
      item("decision-b", "decision_needed", "b", "Project B", 0),
      item("failure-a", "task_failed", "a", "Project A", 1),
      item("result-b", "ready_for_review", "b", "Project B", 3),
      item("failure-a", "task_failed", "a", "Project A", 1),
    ];

    const digest = selectAttentionDigest(items);

    expect(digest.groups.map((group) => group.projectName)).toEqual([
      "Project B",
      "Project A",
    ]);
    expect(digest.groups[0].items.map((entry) => entry.item.eventKey)).toEqual([
      "reply-b",
      "decision-b",
      "result-b",
    ]);
    expect(digest.counts).toEqual({
      needsReply: 1,
      needsDecision: 1,
      unreadResults: 1,
      otherActions: 1,
      total: 4,
    });
  });

  it("keeps seen results actionable while removing them from the unread count", () => {
    const dispositions: Record<string, AttentionDisposition> = {
      seen: { kind: "needs_review", at: "2026-08-12T10:01:00.000Z" },
      reply: { kind: "needs_review", at: "2026-08-12T10:01:00.000Z" },
    };
    const digest = selectAttentionDigest(
      [
        item("seen", "ready_for_review", "a", "Project A", 3),
        item("new", "ready_for_review", "a", "Project A", 3),
        item("reply", "needs_input", "a", "Project A", 0),
      ],
      (eventKey) => dispositions[eventKey],
    );

    expect(digest.groups[0].items.map((entry) => entry.category)).toEqual([
      "other_actions",
      "unread_results",
      "needs_reply",
    ]);
    expect(digest.counts).toEqual({
      needsReply: 1,
      needsDecision: 0,
      unreadResults: 1,
      otherActions: 1,
      total: 3,
    });
  });

  it("places projectless items in one holding group without truncating them", () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      item(`orphan-${index}`, "blocked", "", "", 2),
    );

    const digest = selectAttentionDigest(items);

    expect(digest.groups).toHaveLength(1);
    expect(digest.groups[0]).toMatchObject({
      key: ATTENTION_DIGEST_HOLDING_GROUP_KEY,
      projectId: null,
      projectName: "Holding area",
    });
    expect(digest.groups[0].items).toHaveLength(25);
    expect(digest.counts.total).toBe(25);
  });

  it("projects A, B, and the exact projectless route without using names or task IDs as ownership", () => {
    const projectA = item("a", "task_failed", "project-a", "Same name", 1);
    const projectB = {
      ...item("b", "blocked", "project-b", "Same name", 2),
      taskId: projectA.taskId,
    };
    const holding = item(
      "holding",
      "needs_input",
      "__unassigned__",
      "Unassigned sessions",
      0,
    );
    const projection = selectAttentionProjectProjection(
      [holding, projectA, projectB],
      [
        { id: "project-a", name: "Project A" },
        { id: "project-b", name: "Project B" },
        { id: "__unassigned__", name: "Unassigned sessions" },
      ],
    );

    expect([...projection.byProjectId.keys()]).toEqual([
      "__unassigned__",
      "project-a",
      "project-b",
    ]);
    expect(
      projection.byProjectId
        .get("project-a")
        ?.items.map((entry) => entry.item.eventKey),
    ).toEqual(["a"]);
    expect(
      projection.byProjectId
        .get("project-b")
        ?.items.map((entry) => entry.item.eventKey),
    ).toEqual(["b"]);
    expect(
      projection.byProjectId
        .get("__unassigned__")
        ?.items.map((entry) => entry.item.eventKey),
    ).toEqual(["holding"]);
  });

  it("keeps exact stored-result ownership in the item's project ID", () => {
    const historical = {
      ...item(
        "verification-a",
        "verification_failed",
        "project-a",
        "Project A",
        1,
      ),
      taskId: "live-task-now-in-project-b",
      verificationTarget: {
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
        resultKey: { kind: "revision" as const, id: "result-a" },
      },
    };
    const projection = selectAttentionProjectProjection(
      [historical],
      [
        { id: "project-a", name: "Project A" },
        { id: "project-b", name: "Project B" },
      ],
    );

    expect(
      projection.byProjectId
        .get("project-a")
        ?.items.map((entry) => entry.item.eventKey),
    ).toEqual(["verification-a"]);
    expect(projection.byProjectId.get("project-b")?.items).toEqual([]);
  });

  it("zero-seeds visible routes without admitting an Attention item", () => {
    const projection = selectAttentionProjectProjection(
      [],
      [{ id: "project-zero", name: "Quiet Project" }],
    );

    expect(projection.digest).toEqual({ groups: [], counts: EMPTY_COUNTS });
    expect(projection.byProjectId.get("project-zero")).toEqual({
      key: "project:project-zero",
      projectId: "project-zero",
      projectName: "Quiet Project",
      items: [],
      counts: EMPTY_COUNTS,
    });
  });

  it("deduplicates globally before project grouping and keeps the first canonical owner", () => {
    const duplicateA = item(
      "duplicate",
      "task_failed",
      "project-a",
      "Project A",
      1,
    );
    const duplicateB = {
      ...duplicateA,
      projectId: "project-b",
      projectName: "Project B",
    };
    const projection = selectAttentionProjectProjection(
      [duplicateA, duplicateB],
      [
        { id: "project-a", name: "Project A" },
        { id: "project-b", name: "Project B" },
      ],
    );

    expect(projection.digest.counts.total).toBe(1);
    expect(projection.byProjectId.get("project-a")?.counts.total).toBe(1);
    expect(projection.byProjectId.get("project-b")?.counts.total).toBe(0);
  });

  it("uses needs-review only to change unread categorization and keeps global totals equal to scoped totals", () => {
    const dispositions: Record<string, AttentionDisposition> = {
      seen: { kind: "needs_review", at: "2026-08-12T10:01:00.000Z" },
    };
    const projection = selectAttentionProjectProjection(
      [
        item("seen", "ready_for_review", "project-a", "Project A", 3),
        item("unread", "ready_for_review", "project-a", "Project A", 3),
        item("reply", "needs_input", "project-b", "Project B", 0),
        item(
          "holding-action",
          "blocked",
          "__unassigned__",
          "Unassigned sessions",
          2,
        ),
      ],
      [
        { id: "project-a", name: "Project A" },
        { id: "project-b", name: "Project B" },
        { id: "__unassigned__", name: "Unassigned sessions" },
        { id: "project-zero", name: "Quiet Project" },
      ],
      (eventKey) => dispositions[eventKey],
    );

    expect(projection.byProjectId.get("project-a")?.counts).toEqual({
      needsReply: 0,
      needsDecision: 0,
      unreadResults: 1,
      otherActions: 1,
      total: 2,
    });
    expect(
      projection.byProjectId
        .get("project-a")
        ?.items.map((entry) => [entry.item.eventKey, entry.category]),
    ).toEqual([
      ["seen", "other_actions"],
      ["unread", "unread_results"],
    ]);
    const scopedTotal = [...projection.byProjectId.values()].reduce(
      (sum, group) => sum + group.counts.total,
      0,
    );
    expect(scopedTotal).toBe(projection.digest.counts.total);
    expect(projection.digest.counts).toEqual({
      needsReply: 1,
      needsDecision: 0,
      unreadResults: 1,
      otherActions: 2,
      total: 4,
    });
  });
});
