import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  bindTopDownRoster,
  selectTopDownWorkflowArea,
  stableTopDownVisualIdentity,
  TOP_DOWN_AVATAR_VARIANT_COUNT,
} from "../src/lib/top-down-office-roster";
import {
  attentionEventKey,
  type AttentionItem,
} from "../src/lib/attention-inbox";

const NOW = "2026-08-12T08:00:00.000Z";

function observedStatus(
  value: "coding" | "blocked" | "waiting_for_user" | "failed" | "completed",
  stale = false,
) {
  return {
    value,
    evidence: "observed" as const,
    source: "app-server:test",
    timestamp: NOW,
    stale,
  };
}

function attentionItem(
  task: Parameters<typeof selectTopDownWorkflowArea>[0],
  overrides: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    eventKey: attentionEventKey(task),
    kind: "needs_input",
    priority: 0,
    projectId: "project-a",
    projectName: "Project A",
    taskId: task.id,
    openTaskId: task.id,
    taskTitle: task.title,
    occurredAt: NOW,
    status: task.status.value,
    evidence: task.status.evidence,
    stale: task.status.stale === true,
    reason: "Needs input",
    recommendedAction: "Respond",
    ...overrides,
  };
}

describe("top-down product roster binding", () => {
  it("adapts live project tasks without inventing demo workers", () => {
    const tasks = [
      {
        id: "task-live-alpha",
        title: "Implement live feature",
        agentName: "Mina",
        kind: "staff" as const,
        status: observedStatus("coding"),
      },
      {
        id: "task-live-beta",
        title: "Review release",
        kind: "temporary" as const,
        status: observedStatus("blocked", true),
      },
    ];

    expect(bindTopDownRoster(tasks)).toEqual([
      {
        taskId: "task-live-alpha",
        displayName: "Mina",
        status: "coding",
        attention: false,
        stale: false,
        workflowArea: "desk",
        visualIdentity: stableTopDownVisualIdentity("task-live-alpha"),
      },
      {
        taskId: "task-live-beta",
        displayName: "Review release",
        status: "blocked",
        attention: true,
        stale: true,
        workflowArea: "desk",
        visualIdentity: stableTopDownVisualIdentity("task-live-beta"),
      },
    ]);
  });

  it("uses readable fallbacks and accepts precomputed duplicate labels", () => {
    const workers = bindTopDownRoster(
      [
        {
          id: "019f7ee3-1111-2222-3333-444444444444",
          title: "019F7EE3-1111-2222-3333-444444444444",
          kind: "temporary" as const,
          status: {
            value: "idle" as const,
            evidence: "inferred" as const,
            timestamp: NOW,
          },
        },
        {
          id: "duplicate-scientist",
          title: "[AGENT] Scientist (2)",
          agentName: "Scientist (2)",
          kind: "staff" as const,
          status: {
            value: "idle" as const,
            evidence: "inferred" as const,
            timestamp: NOW,
          },
        },
      ],
      new Map([["duplicate-scientist", "Scientist B"]]),
    );

    expect(workers.map(({ displayName }) => displayName)).toEqual([
      "Session",
      "Scientist B",
    ]);
  });

  it("routes only the exact fresh observed input event to the meeting area", () => {
    const waiting = {
      id: "task-waiting",
      title: "Choose a direction",
      status: observedStatus("waiting_for_user"),
    };
    const exact = attentionItem(waiting);

    expect(selectTopDownWorkflowArea(waiting, "project-a", [exact])).toBe(
      "meeting",
    );
    expect(
      bindTopDownRoster([waiting], new Map(), {
        projectId: "project-a",
        attentionItems: [exact],
      })[0]?.workflowArea,
    ).toBe("meeting");
    expect(selectTopDownWorkflowArea(waiting, "project-b", [exact])).toBe(
      "desk",
    );
    expect(
      selectTopDownWorkflowArea(waiting, "project-a", [
        { ...exact, eventKey: `${exact.eventKey}:older` },
      ]),
    ).toBe("desk");
    expect(
      selectTopDownWorkflowArea(
        { ...waiting, status: { ...waiting.status, stale: true } },
        "project-a",
        [exact],
      ),
    ).toBe("desk");

    const coding = { ...waiting, status: observedStatus("coding") };
    expect(
      selectTopDownWorkflowArea(coding, "project-a", [
        attentionItem(coding, { kind: "needs_input" }),
      ]),
    ).toBe("desk");
  });

  it("routes an exact persistent completion to review and keeps other action kinds at desks", () => {
    const completed = {
      id: "task-completed",
      title: "Ship the result",
      status: {
        value: "idle" as const,
        evidence: "inferred" as const,
        source: "session-jsonl:event_msg.task_complete",
        timestamp: NOW,
        stale: true,
      },
    };
    const ready = attentionItem(completed, {
      kind: "ready_for_review",
      status: "completed",
      evidence: "inferred",
      stale: true,
    });

    expect(selectTopDownWorkflowArea(completed, "project-a", [ready])).toBe(
      "review",
    );
    expect(
      bindTopDownRoster([completed], new Map(), {
        projectId: "project-a",
        attentionItems: [ready],
      })[0]?.workflowArea,
    ).toBe("review");

    for (const kind of [
      "task_failed",
      "blocked",
      "verification_failed",
      "plan_link_mismatch",
    ] as const) {
      expect(
        selectTopDownWorkflowArea(completed, "project-a", [{ ...ready, kind }]),
      ).toBe("desk");
    }

    expect(selectTopDownWorkflowArea(completed, "project-a", [])).toBe("desk");

    const observedCompleted = {
      id: "task-observed-completed",
      title: "Observed completion",
      status: observedStatus("completed"),
    };
    expect(
      selectTopDownWorkflowArea(observedCompleted, "project-a", [
        attentionItem(observedCompleted, { kind: "ready_for_review" }),
      ]),
    ).toBe("review");

    const failed = {
      id: "task-failed",
      title: "Failed task",
      status: observedStatus("failed"),
    };
    expect(
      selectTopDownWorkflowArea(failed, "project-a", [
        attentionItem(failed, { kind: "task_failed" }),
      ]),
    ).toBe("desk");
  });

  it("gives a fresh input event precedence when exact items conflict", () => {
    const waiting = {
      id: "task-precedence",
      title: "Confirm the result",
      status: observedStatus("waiting_for_user"),
    };
    const input = attentionItem(waiting);
    const review = attentionItem(waiting, { kind: "ready_for_review" });

    expect(
      selectTopDownWorkflowArea(waiting, "project-a", [review, input]),
    ).toBe("meeting");
  });

  it("keeps live task identities stable within the authored avatar sheet", () => {
    const taskIds = ["task-0", "task-1", "task-2", "task-3", "task-4"];
    const identities = taskIds.map(stableTopDownVisualIdentity);

    expect(taskIds.map(stableTopDownVisualIdentity)).toEqual(identities);
    expect(identities.every((identity) => identity >= 0)).toBe(true);
    expect(
      identities.every((identity) => identity < TOP_DOWN_AVATAR_VARIANT_COUNT),
    ).toBe(true);
    expect(new Set(identities).size).toBeGreaterThan(1);
  });

  it("keeps the production route independent of rejected 3D renderers", () => {
    const officeSource = readFileSync(
      "src/components/pixel-office.tsx",
      "utf8",
    );
    const pageSource = readFileSync("src/app/page.tsx", "utf8");

    expect(officeSource).toContain(
      "bindTopDownRoster(project.tasks, visibleTaskLabels, {",
    );
    expect(officeSource).toContain('data-product-office-renderer="topdown"');
    expect(officeSource).not.toMatch(/Babylon|babylon|Phaser|phaser/);
    expect(pageSource).not.toMatch(/Babylon|babylon|Phaser|phaser/);
  });
});
