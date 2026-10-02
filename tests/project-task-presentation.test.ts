import { describe, expect, it } from "vitest";

import {
  formatVisibleProjectName,
  formatVisibleTaskName,
  selectDuplicateStaffBadges,
  selectProjectCountsById,
  selectProjectTaskCounts,
  selectVisibleTaskLabels,
  shortTaskId,
} from "../src/lib/project-task-presentation";

describe("project task presentation", () => {
  it("counts fresh active status and attention from one selector", () => {
    expect(
      selectProjectTaskCounts([
        { status: { value: "coding" } },
        { status: { value: "thinking", stale: true } },
        { status: { value: "waiting_for_user" } },
        { status: { value: "blocked" } },
        { status: { value: "failed" } },
        { status: { value: "completed" } },
      ]),
    ).toEqual({ active: 1, waiting: 1, attention: 2, completed: 1 });
  });

  it("builds the shared per-project count map once per snapshot", () => {
    const counts = selectProjectCountsById([
      {
        id: "alpha",
        tasks: [{ status: { value: "coding" } }],
      },
      {
        id: "beta",
        tasks: [{ status: { value: "blocked" } }],
      },
    ]);

    expect(counts.get("alpha")?.active).toBe(1);
    expect(counts.get("beta")?.attention).toBe(1);
  });

  it("adds deterministic short IDs only to exact duplicate staff names", () => {
    const badges = selectDuplicateStaffBadges([
      {
        id: "019f7ee3-1111-2222-3333-444444444444",
        title: "[AGENT] Scientist (2)",
        agentName: "Scientist (2)",
        kind: "staff",
      },
      {
        id: "019f6aa9-1111-2222-3333-444444444444",
        title: "[AGENT] Scientist (2)",
        agentName: "Scientist (2)",
        kind: "staff",
      },
      {
        id: "019f4b33-1111-2222-3333-444444444444",
        title: "[AGENT] Scientist",
        agentName: "Scientist",
        kind: "staff",
      },
      {
        id: "temporary-duplicate",
        title: "Scientist (2)",
        kind: "temporary",
      },
    ]);

    expect([...badges.entries()]).toEqual([
      ["019f7ee3-1111-2222-3333-444444444444", "019f7ee3"],
      ["019f6aa9-1111-2222-3333-444444444444", "019f6aa9"],
      ["019f4b33-1111-2222-3333-444444444444", "019f4b33"],
    ]);
    expect(shortTaskId("ab-cd-ef")).toBe("abcdef");
  });

  it("formats visible task and project labels without agent prefixes or hash-only names", () => {
    expect(
      formatVisibleTaskName({
        id: "019f7ee3-1111-2222-3333-444444444444",
        title: "[AGENT] Scientist (2)",
        agentName: "Scientist (2)",
        kind: "staff",
      }),
    ).toBe("Scientist");

    expect(
      formatVisibleTaskName({
        id: "019f6aa9-1111-2222-3333-444444444444",
        title: "019F6AA9-1111-2222-3333-444444444444",
        kind: "temporary",
      }),
    ).toBe("Session");

    expect(
      formatVisibleProjectName({
        id: "019f-project",
        name: "fast_unweighted_APSP",
      }),
    ).toBe("Fast Unweighted APSP");

    expect(
      formatVisibleProjectName({
        id: "019f-project",
        name: "019F6AA9-1111-2222-3333-444444444444",
      }),
    ).toBe("Project 019F");
  });

  it("assigns human ordinal labels to duplicate people and opaque sessions", () => {
    const labels = selectVisibleTaskLabels([
      {
        id: "scientist-a",
        title: "[AGENT] Scientist",
        agentName: "Scientist",
        kind: "staff",
      },
      {
        id: "scientist-b",
        title: "[AGENT] Scientist (2)",
        agentName: "Scientist (2)",
        kind: "staff",
      },
      {
        id: "scientist-c",
        title: "[AGENT] Scientist (3)",
        agentName: "Scientist (3)",
        kind: "staff",
      },
      {
        id: "opaque-1",
        title: "019FB5B1-1111-2222-3333-444444444444",
        kind: "temporary",
      },
      {
        id: "opaque-2",
        title: "019FC629-1111-2222-3333-444444444444",
        kind: "temporary",
      },
    ]);

    expect([...labels.entries()]).toEqual([
      ["scientist-a", "Scientist A"],
      ["scientist-b", "Scientist B"],
      ["scientist-c", "Scientist C"],
      ["opaque-1", "Session A"],
      ["opaque-2", "Session B"],
    ]);
  });
});
