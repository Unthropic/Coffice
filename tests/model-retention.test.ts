import { describe, expect, it } from "vitest";

import {
  decodeSnapshot,
  retainLastKnownModels,
} from "../src/components/coffice-app";

function snapshot(model?: string) {
  return decodeSnapshot({
    generatedAt: "2026-07-20T12:00:00.000Z",
    projects: [{ id: "project", name: "Project", order: 0 }],
    tasks: [
      {
        id: "task",
        projectId: "project",
        title: "[AGENT] Scientist",
        model,
        status: {
          value: "thinking",
          provenance: "observed",
          source: "synthetic:test",
          timestamp: "2026-07-20T12:00:00.000Z",
        },
      },
    ],
    source: {
      health: "connected",
      freshness: "fresh",
      refreshState: "fresh",
    },
  });
}

describe("last-known model retention", () => {
  it("retains a missing model with a stale marker and clears it on new evidence", () => {
    const previous = snapshot("gpt-5.6-sol");
    const missing = snapshot();
    const retained = retainLastKnownModels(previous.projects, missing.projects);

    expect(retained[0].tasks[0].model).toBe("gpt-5.6-sol");
    expect(retained[0].tasks[0].modelStale).toBe(true);

    const refreshed = retainLastKnownModels(
      retained,
      snapshot("gpt-5.6-luna").projects,
    );
    expect(refreshed[0].tasks[0].model).toBe("gpt-5.6-luna");
    expect(refreshed[0].tasks[0].modelStale).toBe(false);
  });

  it("does not manufacture a model for a task with no prior evidence", () => {
    const task = retainLastKnownModels(undefined, snapshot().projects)[0]
      .tasks[0];
    expect(task.model).toBeUndefined();
    expect(task.modelStale).toBeUndefined();
  });
});
