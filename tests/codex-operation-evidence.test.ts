import { describe, expect, it } from "vitest";

import type { CodexOperation } from "../src/lib/codex-app-server";
import { selectNextCodexOperationEvidence } from "../src/lib/codex-operation-evidence";

function operation(
  id: string,
  taskId: string,
  state: CodexOperation["state"] = "completed",
): CodexOperation {
  return {
    id,
    kind: "send_follow_up",
    taskId,
    state,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:01:00.000Z",
  };
}

describe("Codex operation evidence selection", () => {
  it("skips an orphaned terminal operation and records the next associable one", () => {
    const selected = selectNextCodexOperationEvidence(
      [operation("orphan", "archived-task"), operation("valid", "task-one")],
      [{ id: "project-one", tasks: [{ id: "task-one" }] }],
      new Set(),
      new Set(),
    );

    expect(selected).toMatchObject({
      operation: { id: "valid" },
      projectId: "project-one",
    });
  });

  it("ignores active, recorded, and currently-writing operations", () => {
    const selected = selectNextCodexOperationEvidence(
      [
        operation("active", "task-one", "running"),
        operation("recorded", "task-one"),
        operation("pending", "task-one"),
        operation("next", "task-one", "failed"),
      ],
      [{ id: "project-one", tasks: [{ id: "task-one" }] }],
      new Set(["codex-operation:recorded"]),
      new Set(["pending"]),
    );

    expect(selected?.operation.id).toBe("next");
  });
});
