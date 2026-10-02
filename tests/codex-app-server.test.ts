import { afterEach, describe, expect, it, vi } from "vitest";
import { COFFICE_VERSION } from "../src/lib/product-version";

import {
  appServerSpawnSpec,
  CODEX_APP_SERVER_OPT_OUT_NOTIFICATIONS,
  CodexAppServerManager,
  executableOnPath,
  OPERATION_RECONCILE_INTERVAL_MS,
  MAX_GOAL_STATUS_THREADS_PER_READ,
  type AppServerTransport,
} from "../src/lib/codex-app-server";

class MockTransport implements AppServerTransport {
  writes: Array<Record<string, unknown>> = [];
  threadReadStatus: "active" | "idle" | "notLoaded" | "systemError" = "active";
  resumeTurns: unknown[] = [];
  threadReadTurns: unknown[] = [];
  goalResults = new Map<string, unknown>();
  rejectedGoalIds = new Set<string>();
  completeReviewBeforeResponseContinuation = false;
  completeInterruptBeforeResponseContinuation = false;
  private lineListener: ((line: string) => void) | undefined;
  private exitListener: (() => void) | undefined;

  async write(line: string): Promise<void> {
    const message = JSON.parse(line) as Record<string, unknown>;
    this.writes.push(message);
    const id = message.id;
    if (typeof id !== "number") return;
    const params = message.params as Record<string, unknown>;
    if (message.method === "initialize") this.respond(id, {});
    if (message.method === "thread/resume") {
      this.respond(id, {
        thread: {
          id: params.threadId,
          status: { type: "idle" },
          preview: "must never be retained",
          turns: this.resumeTurns,
        },
      });
    }
    if (message.method === "thread/read") {
      this.respond(id, {
        thread: {
          id: params.threadId,
          status: { type: this.threadReadStatus },
          turns: this.threadReadTurns,
        },
      });
    }
    if (message.method === "thread/goal/get") {
      if (this.rejectedGoalIds.has(String(params.threadId))) {
        this.reject(id);
        return;
      }
      this.respond(
        id,
        this.goalResults.get(String(params.threadId)) ?? { goal: null },
      );
    }
    if (message.method === "thread/archive")
      this.respond(id, { ignoredPrivateField: "must not be retained" });
    if (message.method === "turn/interrupt") {
      if (this.completeInterruptBeforeResponseContinuation) {
        queueMicrotask(() => {
          this.lineListener?.(JSON.stringify({ id, result: {} }));
          this.lineListener?.(
            JSON.stringify({
              method: "turn/completed",
              params: {
                threadId: params.threadId,
                turn: {
                  id: params.turnId,
                  status: "interrupted",
                  items: [{ text: "private interrupted output" }],
                },
              },
            }),
          );
        });
      } else {
        this.respond(id, { ignoredPrivateField: "must not be retained" });
      }
    }
    if (message.method === "turn/start")
      this.respond(id, { turn: { id: "turn-follow-up" } });
    if (message.method === "review/start") {
      const result = {
        turn: { id: "turn-review" },
        reviewThreadId: "review-thread",
      };
      if (this.completeReviewBeforeResponseContinuation) {
        queueMicrotask(() => {
          this.lineListener?.(JSON.stringify({ id, result }));
          this.lineListener?.(
            JSON.stringify({
              method: "turn/completed",
              params: {
                threadId: "review-thread",
                turn: {
                  id: "turn-review",
                  status: "completed",
                  items: [{ text: "private completion content" }],
                },
              },
            }),
          );
        });
      } else {
        this.respond(id, result);
      }
    }
    if (message.method === "thread/unsubscribe")
      this.respond(id, { status: "notLoaded" });
  }

  onLine(listener: (line: string) => void): void {
    this.lineListener = listener;
  }

  onExit(listener: () => void): void {
    this.exitListener = listener;
  }

  respond(id: number, result: unknown): void {
    queueMicrotask(() => this.lineListener?.(JSON.stringify({ id, result })));
  }

  reject(id: number): void {
    queueMicrotask(() =>
      this.lineListener?.(
        JSON.stringify({ id, error: { code: -32602, message: "unsupported" } }),
      ),
    );
  }

  notify(method: string, params: unknown): void {
    this.lineListener?.(JSON.stringify({ method, params }));
  }

  serverRequest(id: string, method: string, params: unknown): void {
    this.lineListener?.(JSON.stringify({ id, method, params }));
  }

  exit(): void {
    this.exitListener?.();
  }
}

describe("authoritative thread goal projection", () => {
  it("retains only exact blocked identity and timestamp, never objective text", async () => {
    const transport = new MockTransport();
    transport.goalResults.set("thread-blocked", {
      goal: {
        threadId: "thread-blocked",
        objective: "PRIVATE_GOAL_CANARY must never escape",
        status: "blocked",
        tokenBudget: 99,
        tokensUsed: 42,
        timeUsedSeconds: 10,
        createdAt: 1_784_500_000,
        updatedAt: 1_784_505_600,
      },
    });
    transport.goalResults.set("thread-paused", {
      goal: {
        threadId: "thread-paused",
        objective: "SECOND_PRIVATE_CANARY",
        status: "paused",
        updatedAt: 1_784_505_601,
      },
    });
    const manager = new CodexAppServerManager(() => transport);

    const result = await manager.readBlockedGoalEvidence([
      "thread-blocked",
      "thread-paused",
    ]);

    expect(result.available).toBe(true);
    expect([...result.evidence]).toEqual([
      [
        "thread-blocked",
        {
          threadId: "thread-blocked",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
    ]);
    expect(JSON.stringify([...result.evidence])).not.toContain(
      "PRIVATE_GOAL_CANARY",
    );
    expect(JSON.stringify([...result.evidence])).not.toContain("objective");
    expect(
      transport.writes.filter((write) => write.method === "thread/goal/get"),
    ).toHaveLength(2);
  });

  it("fails closed for malformed, mismatched, duplicate, and over-bound input", async () => {
    const malformed = new MockTransport();
    malformed.goalResults.set("thread-a", {
      goal: {
        threadId: "another-thread",
        objective: "PRIVATE_MISMATCH_CANARY",
        status: "blocked",
        updatedAt: 1_784_505_600,
      },
    });
    const manager = new CodexAppServerManager(() => malformed);

    expect(await manager.readBlockedGoalEvidence(["thread-a"])).toEqual({
      available: false,
      evidence: new Map(),
    });

    const partial = new MockTransport();
    partial.goalResults.set("thread-a", {
      goal: {
        threadId: "thread-a",
        objective: "PRIVATE_PARTIAL_CANARY",
        status: "blocked",
        updatedAt: 1_784_505_600,
      },
    });
    partial.goalResults.set("thread-b", {
      goal: {
        threadId: "wrong-thread",
        status: "blocked",
        updatedAt: 1_784_505_601,
      },
    });
    expect(
      await new CodexAppServerManager(() => partial).readBlockedGoalEvidence([
        "thread-a",
        "thread-b",
      ]),
    ).toEqual({ available: false, evidence: new Map() });
    expect(
      await manager.readBlockedGoalEvidence(["thread-a", "thread-a"]),
    ).toEqual({ available: false, evidence: new Map() });
    expect(
      await manager.readBlockedGoalEvidence(
        Array.from(
          { length: MAX_GOAL_STATUS_THREADS_PER_READ + 1 },
          (_, index) => `thread-${index}`,
        ),
      ),
    ).toEqual({ available: false, evidence: new Map() });
  });

  it("fails closed when the goal endpoint is unavailable", async () => {
    const transport = new MockTransport();
    transport.goalResults.set("thread-a", {
      goal: {
        threadId: "thread-a",
        status: "blocked",
        updatedAt: "not-a-protocol-number",
      },
    });
    const manager = new CodexAppServerManager(() => transport);

    expect(await manager.readBlockedGoalEvidence(["thread-a"])).toEqual({
      available: false,
      evidence: new Map(),
    });

    const unavailable = new MockTransport();
    unavailable.rejectedGoalIds.add("thread-a");
    expect(
      await new CodexAppServerManager(
        () => unavailable,
      ).readBlockedGoalEvidence(["thread-a"]),
    ).toEqual({ available: false, evidence: new Map() });
  });

  it.each(["paused", "usageLimited", "budgetLimited", "active", "complete"])(
    "does not map %s goal state to blocked",
    async (status) => {
      const transport = new MockTransport();
      transport.goalResults.set("thread-a", {
        goal: {
          threadId: "thread-a",
          objective: "PRIVATE_NON_BLOCKED_CANARY",
          status,
          updatedAt: 1_784_505_600,
        },
      });
      expect(
        await new CodexAppServerManager(
          () => transport,
        ).readBlockedGoalEvidence(["thread-a"]),
      ).toEqual({ available: true, evidence: new Map() });
    },
  );

  it("retains a prior exact blocked observation as stale until a successful read resolves it", async () => {
    const transport = new MockTransport();
    transport.goalResults.set("thread-a", {
      goal: {
        threadId: "thread-a",
        objective: "PRIVATE_TRANSIENT_CANARY",
        status: "blocked",
        updatedAt: 1_784_505_600,
      },
    });
    const manager = new CodexAppServerManager(() => transport);

    const blocked = await manager.readBlockedGoalEvidence(["thread-a"]);
    expect(blocked.available).toBe(true);
    expect(blocked.evidence.get("thread-a")).toEqual({
      threadId: "thread-a",
      updatedAt: "2026-07-20T00:00:00.000Z",
    });

    transport.rejectedGoalIds.add("thread-a");
    const unavailable = await manager.readBlockedGoalEvidence(["thread-a"]);
    expect(unavailable.available).toBe(false);
    expect(unavailable.evidence).toEqual(blocked.evidence);

    transport.rejectedGoalIds.delete("thread-a");
    transport.goalResults.set("thread-a", { goal: null });
    expect(await manager.readBlockedGoalEvidence(["thread-a"])).toEqual({
      available: true,
      evidence: new Map(),
    });
  });
});

describe("Codex executable resolution", () => {
  it("honors PATH directory order before Windows extension preference", () => {
    const accessible = new Set(["first\\codex.cmd", "second\\codex.exe"]);

    expect(
      executableOnPath(
        ["codex.exe", "codex.cmd", "codex.bat"],
        '"first";second',
        ";",
        (candidate) => accessible.has(candidate),
      ),
    ).toBe("first\\codex.cmd");
  });

  it("continues through unavailable candidates without changing PATH order", () => {
    expect(
      executableOnPath(
        ["codex.exe", "codex.cmd", "codex.bat"],
        "first;second",
        ";",
        (candidate) => candidate === "second\\codex.bat",
      ),
    ).toBe("second\\codex.bat");
  });

  it("preserves the exact Windows command-shim quoting for cmd.exe", () => {
    expect(
      appServerSpawnSpec(
        "C:\\Program Files\\Codex\\codex.cmd",
        "C:\\Windows\\System32\\cmd.exe",
      ),
    ).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '""C:\\Program Files\\Codex\\codex.cmd" app-server --stdio"',
      ],
      windowsVerbatimArguments: true,
    });
  });

  it("launches native executables without cmd.exe quoting", () => {
    expect(appServerSpawnSpec("C:\\Codex\\codex.exe")).toEqual({
      command: "C:\\Codex\\codex.exe",
      args: ["app-server", "--stdio"],
      windowsVerbatimArguments: false,
    });
  });
});

describe("CodexAppServerManager", () => {
  afterEach(() => vi.useRealTimers());

  it("uses the stable privacy capability and retains only structural follow-up state", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "sensitive follow-up",
      "idem-one",
    );

    expect(transport.writes.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "thread/resume",
      "turn/start",
    ]);
    expect(transport.writes[0]).toEqual({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "coffice",
          title: "Coffice",
          version: COFFICE_VERSION,
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: [
            ...CODEX_APP_SERVER_OPT_OUT_NOTIFICATIONS,
          ],
        },
      },
    });
    expect(transport.writes[2]).toEqual({
      method: "thread/resume",
      id: 2,
      params: { threadId: "thread-one", excludeTurns: true },
    });
    expect(CODEX_APP_SERVER_OPT_OUT_NOTIFICATIONS).not.toContain(
      "thread/status/changed",
    );
    expect(CODEX_APP_SERVER_OPT_OUT_NOTIFICATIONS).not.toContain(
      "turn/started",
    );
    expect(CODEX_APP_SERVER_OPT_OUT_NOTIFICATIONS).not.toContain(
      "turn/completed",
    );
    expect(CODEX_APP_SERVER_OPT_OUT_NOTIFICATIONS).not.toContain("error");
    expect(CODEX_APP_SERVER_OPT_OUT_NOTIFICATIONS).toHaveLength(68);
    expect(operation).toMatchObject({
      kind: "send_follow_up",
      taskId: "thread-one",
      state: "running",
      turnId: "turn-follow-up",
    });
    expect(JSON.stringify(manager.listOperations())).not.toContain("sensitive");
    expect(JSON.stringify(manager.listOperations())).not.toContain("private");
  });

  it("fails closed when history appears in a metadata-only resume response", async () => {
    const transport = new MockTransport();
    transport.resumeTurns = [{ items: [{ text: "private" }] }];
    const manager = new CodexAppServerManager(() => transport);

    await expect(
      manager.sendFollowUp("thread-one", "continue", "history-response"),
    ).resolves.toMatchObject({
      state: "failed",
      errorCode: "APP_SERVER_PROTOCOL_ERROR",
    });
    expect(transport.writes.map((message) => message.method)).not.toContain(
      "turn/start",
    );
    expect(
      transport.writes.filter(
        (message) => message.method === "thread/unsubscribe",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(manager.listOperations())).not.toContain("private");
  });

  it("deduplicates an action by idempotency key without sending again", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const first = await manager.requestReview("thread-one", "review-key");
    const writes = transport.writes.length;
    const second = await manager.requestReview("thread-one", "review-key");

    expect(second.id).toBe(first.id);
    expect(transport.writes).toHaveLength(writes);
    expect(transport.writes.at(-1)).toMatchObject({
      method: "review/start",
      params: {
        threadId: "thread-one",
        target: { type: "uncommittedChanges" },
        delivery: "detached",
      },
    });

    await expect(
      manager.requestReview("thread-two", "review-key"),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
    await expect(
      manager.sendFollowUp("thread-one", "different action", "review-key"),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
    expect(transport.writes).toHaveLength(writes);
  });

  it("archives one metadata-only idle thread and retains only its structural receipt", async () => {
    const transport = new MockTransport();
    transport.threadReadStatus = "idle";
    const manager = new CodexAppServerManager(() => transport);

    const first = await manager.archiveTask("thread-one", "archive-key");
    const writes = transport.writes.length;
    const replay = await manager.archiveTask("thread-one", "archive-key");

    expect(first).toMatchObject({
      kind: "archive_task",
      taskId: "thread-one",
      state: "completed",
    });
    expect(replay.id).toBe(first.id);
    expect(transport.writes).toHaveLength(writes);
    expect(transport.writes.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "thread/read",
      "thread/archive",
    ]);
    expect(transport.writes[2]).toEqual({
      method: "thread/read",
      id: 2,
      params: { threadId: "thread-one", includeTurns: false },
    });
    expect(transport.writes[3]).toEqual({
      method: "thread/archive",
      id: 3,
      params: { threadId: "thread-one" },
    });
    expect(JSON.stringify(manager.listOperations())).not.toContain("Private");
  });

  it("refuses to archive a thread that is no longer idle", async () => {
    const transport = new MockTransport();
    transport.threadReadStatus = "active";
    const manager = new CodexAppServerManager(() => transport);

    await expect(
      manager.archiveTask("thread-one", "archive-active"),
    ).resolves.toMatchObject({ state: "failed", errorCode: "TASK_NOT_IDLE" });
    expect(transport.writes.map((message) => message.method)).not.toContain(
      "thread/archive",
    );
  });

  it("keeps an unconfirmed archive outcome unknown without retrying", async () => {
    const transport = new MockTransport();
    transport.threadReadStatus = "idle";
    const originalWrite = transport.write.bind(transport);
    transport.write = async (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.method !== "thread/archive") return await originalWrite(line);
      transport.writes.push(message);
      queueMicrotask(() => transport.exit());
    };
    const manager = new CodexAppServerManager(() => transport);

    await expect(
      manager.archiveTask("thread-one", "archive-unconfirmed"),
    ).resolves.toMatchObject({
      state: "unknown",
      errorCode: "APP_SERVER_EXITED",
    });
    expect(
      transport.writes.filter((message) => message.method === "thread/archive"),
    ).toHaveLength(1);
  });

  it("requests one exact interruption and waits for the structural terminal event", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(
      () => transport,
      () => new Date("2026-08-19T10:00:00.000Z"),
    );
    const running = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "cancel-source",
    );

    const cancelling = await manager.cancelOperation(running.id, "thread-one");
    const writes = transport.writes.length;
    const replay = await manager.cancelOperation(running.id, "thread-one");

    expect(cancelling).toMatchObject({
      id: running.id,
      state: "running",
      cancelRequestedAt: "2026-08-19T10:00:00.000Z",
    });
    expect(replay).toEqual(cancelling);
    expect(transport.writes).toHaveLength(writes);
    expect(transport.writes.at(-1)).toEqual({
      method: "turn/interrupt",
      id: 4,
      params: { threadId: "thread-one", turnId: "turn-follow-up" },
    });

    transport.notify("turn/completed", {
      threadId: "thread-one",
      turn: {
        id: "turn-follow-up",
        status: "interrupted",
        items: [{ text: "private interrupted output" }],
      },
    });
    expect(manager.getOperation(running.id)).toMatchObject({
      state: "interrupted",
      cancelRequestedAt: "2026-08-19T10:00:00.000Z",
    });
    expect(JSON.stringify(manager.listOperations())).not.toContain("private");
  });

  it("coalesces concurrent stop requests for the same operation", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const running = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "cancel-concurrent",
    );
    const originalWrite = transport.write.bind(transport);
    let interruptRequestId: number | undefined;
    transport.write = async (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.method !== "turn/interrupt") return await originalWrite(line);
      transport.writes.push(message);
      interruptRequestId = message.id as number;
    };

    const first = manager.cancelOperation(running.id, "thread-one");
    await Promise.resolve();
    const second = manager.cancelOperation(running.id, "thread-one");

    expect(
      transport.writes.filter((message) => message.method === "turn/interrupt"),
    ).toHaveLength(1);
    transport.respond(interruptRequestId!, {});
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toEqual(firstResult);
    expect(firstResult.cancelRequestedAt).toBeDefined();
  });

  it("targets the detached review thread when cancelling a review", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const review = await manager.requestReview("thread-one", "review-cancel");

    await manager.cancelOperation(review.id, "thread-one");

    expect(transport.writes.at(-1)).toMatchObject({
      method: "turn/interrupt",
      params: { threadId: "review-thread", turnId: "turn-review" },
    });
  });

  it("does not revive a turn that reports interruption before the response resumes", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const running = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "cancel-inline",
    );
    transport.completeInterruptBeforeResponseContinuation = true;

    await expect(
      manager.cancelOperation(running.id, "thread-one"),
    ).resolves.toMatchObject({ state: "interrupted" });
    expect(manager.getOperation(running.id)?.state).toBe("interrupted");
    expect(JSON.stringify(manager.listOperations())).not.toContain("private");
  });

  it("keeps a lost interruption request unknown without sending it twice", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const running = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "cancel-unknown",
    );
    const originalWrite = transport.write.bind(transport);
    transport.write = async (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.method !== "turn/interrupt") return await originalWrite(line);
      transport.writes.push(message);
      queueMicrotask(() => transport.exit());
    };

    await expect(
      manager.cancelOperation(running.id, "thread-one"),
    ).resolves.toMatchObject({
      state: "unknown",
      errorCode: "APP_SERVER_EXITED",
    });
    expect(
      transport.writes.filter((message) => message.method === "turn/interrupt"),
    ).toHaveLength(1);
  });

  it("rejects cancellation that is not bound to one active tracked turn", async () => {
    const transport = new MockTransport();
    transport.threadReadStatus = "idle";
    const manager = new CodexAppServerManager(() => transport);
    const running = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "cancel-binding",
    );
    const archived = await manager.archiveTask("thread-two", "archive-binding");

    await expect(
      manager.cancelOperation(running.id, "different-thread"),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
    await expect(
      manager.cancelOperation(archived.id, "thread-two"),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
    await expect(
      manager.cancelOperation("missing-operation", "thread-one"),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
  });

  it("retains an immediate detached-review completion without retaining its body", async () => {
    const transport = new MockTransport();
    transport.completeReviewBeforeResponseContinuation = true;
    const manager = new CodexAppServerManager(() => transport);

    const operation = await manager.requestReview(
      "thread-one",
      "review-completes-inline",
    );

    expect(operation).toMatchObject({
      state: "completed",
      turnId: "turn-review",
      reviewThreadId: "review-thread",
    });
    expect(manager.getOperation(operation.id)?.state).toBe("completed");
    expect(JSON.stringify(manager.listOperations())).not.toContain("private");
    expect(
      transport.writes
        .filter((message) => message.method === "thread/unsubscribe")
        .map(
          (message) =>
            (message.params as Record<string, unknown>).threadId as string,
        ),
    ).toEqual(["thread-one", "review-thread"]);
  });

  it("rejects changed follow-up text under the same idempotency key", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    await manager.sendFollowUp("thread-one", "first", "same-key");
    const writes = transport.writes.length;
    await expect(
      manager.sendFollowUp("thread-one", "second", "same-key"),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
    expect(transport.writes).toHaveLength(writes);
    expect(JSON.stringify(manager.listOperations())).not.toContain("first");
    expect(JSON.stringify(manager.listOperations())).not.toContain("second");
  });

  it("fails closed when the resumed thread is not idle", async () => {
    const transport = new MockTransport();
    const originalWrite = transport.write.bind(transport);
    transport.write = async (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.method !== "thread/resume") return await originalWrite(line);
      transport.writes.push(message);
      transport.respond(message.id as number, {
        thread: { id: "thread-one", status: { type: "active" } },
      });
    };
    const manager = new CodexAppServerManager(() => transport);

    await expect(
      manager.sendFollowUp("thread-one", "do not send", "busy-key"),
    ).resolves.toMatchObject({ state: "failed", errorCode: "TASK_NOT_IDLE" });
    expect(transport.writes.some((item) => item.method === "turn/start")).toBe(
      false,
    );
    expect(
      transport.writes.filter(
        (item) =>
          item.method === "thread/unsubscribe" &&
          (item.params as Record<string, unknown>).threadId === "thread-one",
      ),
    ).toHaveLength(1);
  });

  it("fails closed when excludeTurns is unsupported", async () => {
    const transport = new MockTransport();
    const originalWrite = transport.write.bind(transport);
    transport.write = async (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.method !== "thread/resume") return await originalWrite(line);
      transport.writes.push(message);
      transport.reject(message.id as number);
    };
    const manager = new CodexAppServerManager(() => transport);

    await expect(
      manager.sendFollowUp("thread-one", "do not send", "unsupported-resume"),
    ).resolves.toMatchObject({
      state: "failed",
      errorCode: "REQUEST_REJECTED",
    });
    expect(transport.writes.some((item) => item.method === "turn/start")).toBe(
      false,
    );
  });

  it("projects structural completion and makes in-flight work unknown on exit", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const first = await manager.sendFollowUp("thread-one", "one", "one");
    transport.notify("turn/completed", {
      threadId: "thread-one",
      turn: {
        id: first.turnId,
        status: "completed",
        items: [{ text: "private" }],
      },
    });
    expect(manager.getOperation(first.id)?.state).toBe("completed");
    transport.notify("turn/started", {
      threadId: "thread-one",
      turn: { id: first.turnId, status: "inProgress" },
    });
    transport.notify("thread/status/changed", {
      threadId: "thread-one",
      status: { type: "active" },
    });
    expect(manager.getOperation(first.id)?.state).toBe("completed");
    transport.notify("turn/completed", {
      threadId: "thread-one",
      turn: { id: first.turnId, status: "completed" },
    });
    expect(
      transport.writes.filter(
        (item) =>
          item.method === "thread/unsubscribe" &&
          (item.params as Record<string, unknown>).threadId === "thread-one",
      ),
    ).toHaveLength(1);

    const second = await manager.sendFollowUp("thread-two", "two", "two");
    transport.exit();
    expect(manager.getOperation(second.id)).toMatchObject({
      state: "unknown",
      errorCode: "APP_SERVER_EXITED",
    });
  });

  it("unsubscribes both the original and detached review thread exactly once", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const review = await manager.requestReview("thread-one", "review-cleanup");

    transport.notify("turn/completed", {
      threadId: "review-thread",
      turn: { id: review.turnId, status: "completed", items: ["private"] },
    });
    transport.notify("turn/completed", {
      threadId: "review-thread",
      turn: { id: review.turnId, status: "completed" },
    });

    const unsubscribed = transport.writes
      .filter((item) => item.method === "thread/unsubscribe")
      .map(
        (item) => (item.params as Record<string, unknown>).threadId as string,
      );
    expect(unsubscribed).toEqual(["thread-one", "review-thread"]);
    expect(JSON.stringify(manager.listOperations())).not.toContain("private");
  });

  it("rejects conflicting simultaneous actions on the same task", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    await manager.sendFollowUp("thread-one", "first", "first-action");

    await expect(
      manager.requestReview("thread-one", "conflicting-action"),
    ).rejects.toMatchObject({ code: "APP_SERVER_BUSY" });
    expect(
      transport.writes.filter((item) => item.method === "thread/resume"),
    ).toHaveLength(1);
  });

  it("never evicts an active operation to satisfy the history bound", async () => {
    vi.useFakeTimers();
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const first = await manager.sendFollowUp("thread-0", "work", "capacity-0");
    for (let index = 1; index < 128; index += 1) {
      await manager.sendFollowUp(
        `thread-${index}`,
        "work",
        `capacity-${index}`,
      );
    }

    await expect(
      manager.sendFollowUp("thread-overflow", "work", "capacity-overflow"),
    ).rejects.toMatchObject({ code: "APP_SERVER_BUSY" });
    expect(manager.listOperations()).toHaveLength(128);
    expect(manager.getOperation(first.id)?.state).toBe("running");
  });

  it("holds one exact command approval only in memory and responds once", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "waiting-key",
    );
    transport.serverRequest(
      "server-request-one",
      "item/commandExecution/requestApproval",
      {
        threadId: "thread-one",
        turnId: operation.turnId,
        itemId: "command-item",
        startedAtMs: 1,
        command: "private command body",
        cwd: "C:\\trusted-project",
        reason: "Run the focused check",
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      },
    );

    expect(manager.getOperation(operation.id)).toMatchObject({
      state: "waiting",
    });
    expect(manager.listPendingRequests()).toEqual([
      expect.objectContaining({
        kind: "command_approval",
        operationId: operation.id,
        taskId: "thread-one",
        command: "private command body",
        cwd: "C:\\trusted-project",
        allowOnce: true,
        canDecline: true,
        canCancel: true,
        requiresCodexReview: false,
      }),
    ]);
    expect(JSON.stringify(manager.listOperations())).not.toContain("command");

    const requestId = manager.listPendingRequests()[0].id;
    await expect(
      manager.respondToPendingRequest(requestId, "thread-one", {
        kind: "approval",
        decision: "accept",
      }),
    ).resolves.toMatchObject({ state: "running" });
    expect(manager.listPendingRequests()).toEqual([]);
    expect(transport.writes.at(-1)).toEqual({
      id: "server-request-one",
      result: { decision: "accept" },
    });
    await expect(
      manager.respondToPendingRequest(requestId, "thread-one", {
        kind: "approval",
        decision: "accept",
      }),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
  });

  it("maps local clarification tokens back to original question ids without durable text", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "clarification-key",
    );

    transport.serverRequest("question-request", "item/tool/requestUserInput", {
      threadId: "thread-one",
      turnId: operation.turnId,
      itemId: "question-item",
      questions: [
        {
          id: "private-original-id",
          header: "Deployment target",
          question: "Which environment should be used?",
          isSecret: false,
          isOther: true,
          options: [
            { label: "Staging", description: "Use the staging environment." },
          ],
        },
      ],
    });

    const pending = manager.listPendingRequests()[0];
    expect(pending).toMatchObject({
      kind: "clarification",
      taskId: "thread-one",
      questions: [
        expect.objectContaining({
          header: "Deployment target",
          allowOther: true,
        }),
      ],
    });
    expect(JSON.stringify(pending)).not.toContain("private-original-id");
    if (pending.kind !== "clarification") throw new Error("wrong request");
    const localQuestionId = pending.questions[0].id;

    await manager.respondToPendingRequest(pending.id, "thread-one", {
      kind: "clarification",
      answers: { [localQuestionId]: ["Staging"] },
    });
    expect(transport.writes.at(-1)).toEqual({
      id: "question-request",
      result: {
        answers: { "private-original-id": { answers: ["Staging"] } },
      },
    });
    expect(manager.listPendingRequests()).toEqual([]);
    expect(JSON.stringify(manager.listOperations())).not.toContain("Staging");
  });

  it("never exposes persistent grants or file-change acceptance", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "restricted-approval",
    );
    transport.serverRequest(
      "command-policy",
      "item/commandExecution/requestApproval",
      {
        threadId: "thread-one",
        turnId: operation.turnId,
        itemId: "policy-item",
        startedAtMs: 2,
        command: "trusted command",
        availableDecisions: ["accept", "acceptForSession", "decline"],
        additionalPermissions: { network: true },
      },
    );
    expect(manager.listPendingRequests()[0]).toMatchObject({
      kind: "command_approval",
      allowOnce: false,
      requiresCodexReview: true,
    });

    const firstId = manager.listPendingRequests()[0].id;
    await expect(
      manager.respondToPendingRequest(firstId, "thread-one", {
        kind: "approval",
        decision: "accept",
      }),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });

    await manager.respondToPendingRequest(firstId, "thread-one", {
      kind: "approval",
      decision: "decline",
    });
    transport.serverRequest("file-change", "item/fileChange/requestApproval", {
      threadId: "thread-one",
      turnId: operation.turnId,
      itemId: "file-item",
      startedAtMs: 3,
      grantRoot: "C:\\trusted-project",
      reason: "Apply a patch that Coffice did not receive",
      availableDecisions: ["accept", "decline", "cancel"],
    });
    const fileRequest = manager.listPendingRequests()[0];
    expect(fileRequest).toMatchObject({
      kind: "file_change_approval",
      canDecline: true,
      canCancel: true,
    });
    await expect(
      manager.respondToPendingRequest(fileRequest.id, "thread-one", {
        kind: "approval",
        decision: "accept",
      }),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
  });

  it("keeps permission-profile requests in Codex without exposing their body", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "permission-request",
    );

    transport.serverRequest(
      "permission-profile",
      "item/permissions/requestApproval",
      {
        threadId: "thread-one",
        turnId: operation.turnId,
        itemId: "permission-item",
        permissions: { privateCapability: "must not be exposed" },
      },
    );

    expect(manager.getOperation(operation.id)).toMatchObject({
      state: "failed",
      errorCode: "USER_ACTION_REQUIRED",
    });
    expect(manager.listPendingRequests()).toEqual([]);
    expect(JSON.stringify(manager.listOperations())).not.toContain(
      "privateCapability",
    );
    expect(transport.writes.at(-1)).toEqual({
      id: "permission-profile",
      error: { code: -32001, message: "User action required" },
    });
  });

  it("clears a transient callback when its exact turn becomes terminal", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "terminal-callback",
    );
    transport.serverRequest("terminal-question", "item/tool/requestUserInput", {
      threadId: "thread-one",
      turnId: operation.turnId,
      itemId: "terminal-item",
      questions: [
        {
          id: "original-question",
          header: "Choice",
          question: "Choose now",
          options: [],
        },
      ],
    });
    expect(manager.listPendingRequests()).toHaveLength(1);

    transport.notify("turn/completed", {
      threadId: "thread-one",
      turn: { id: operation.turnId, status: "interrupted" },
    });

    expect(manager.listPendingRequests()).toEqual([]);
    expect(manager.getOperation(operation.id)?.state).toBe("interrupted");
    expect(transport.writes).toContainEqual({
      id: "terminal-question",
      error: { code: -32001, message: "User action required" },
    });
  });

  it("correlates thread status without requiring a turn id", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "status-correlation",
    );

    transport.notify("thread/status/changed", {
      threadId: "thread-one",
      status: { type: "systemError" },
    });
    expect(manager.getOperation(operation.id)?.state).toBe("failed");
  });

  it("waits for the turn outcome when thread status becomes idle", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "idle-before-completion",
    );

    transport.notify("thread/status/changed", {
      threadId: "thread-one",
      status: { type: "idle" },
    });
    expect(manager.getOperation(operation.id)?.state).toBe("running");

    transport.notify("turn/completed", {
      threadId: "thread-one",
      turn: { id: operation.turnId, status: "completed" },
    });
    expect(manager.getOperation(operation.id)?.state).toBe("completed");
  });

  it("reconciles long-running work from metadata instead of imposing a duration cap", async () => {
    vi.useFakeTimers();
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "watchdog",
    );

    await vi.advanceTimersByTimeAsync(OPERATION_RECONCILE_INTERVAL_MS);
    expect(manager.getOperation(operation.id)?.state).toBe("running");
    expect(transport.writes.at(-1)).toMatchObject({
      method: "thread/read",
      params: { threadId: "thread-one", includeTurns: false },
    });

    transport.threadReadStatus = "idle";
    await vi.advanceTimersByTimeAsync(OPERATION_RECONCILE_INTERVAL_MS);
    expect(manager.getOperation(operation.id)).toMatchObject({
      state: "unknown",
      errorCode: "APP_SERVER_PROTOCOL_ERROR",
    });
    expect(JSON.stringify(manager.listOperations())).not.toContain(
      "must never",
    );
  });

  it("becomes unknown only after repeated metadata reconciliation failures", async () => {
    vi.useFakeTimers();
    const transport = new MockTransport();
    const originalWrite = transport.write.bind(transport);
    transport.write = async (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.method === "thread/read") {
        transport.writes.push(message);
        throw new Error("synthetic read failure");
      }
      await originalWrite(line);
    };
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "reconcile-failure",
    );

    await vi.advanceTimersByTimeAsync(OPERATION_RECONCILE_INTERVAL_MS * 2);
    expect(manager.getOperation(operation.id)?.state).toBe("running");
    await vi.advanceTimersByTimeAsync(OPERATION_RECONCILE_INTERVAL_MS);
    expect(manager.getOperation(operation.id)).toMatchObject({
      state: "unknown",
      errorCode: "APP_SERVER_TIMEOUT",
    });
  });

  it("fails safely when stdin rejects an asynchronous write", async () => {
    const transport = new MockTransport();
    const originalWrite = transport.write.bind(transport);
    transport.write = async (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.method === "turn/start") {
        transport.writes.push(message);
        throw new Error("synthetic stdin failure");
      }
      await originalWrite(line);
    };
    const manager = new CodexAppServerManager(() => transport);

    await expect(
      manager.sendFollowUp("thread-one", "private", "stdin-failure"),
    ).resolves.toMatchObject({
      state: "unknown",
      errorCode: "APP_SERVER_UNAVAILABLE",
    });
    expect(JSON.stringify(manager.listOperations())).not.toContain("private");
  });

  it("does not let an unrelated error notification fail another operation", async () => {
    const transport = new MockTransport();
    const manager = new CodexAppServerManager(() => transport);
    const operation = await manager.sendFollowUp(
      "thread-one",
      "continue",
      "correlation-key",
    );
    transport.notify("error", {
      threadId: "another-thread",
      turnId: "another-turn",
      error: { message: "private error" },
    });
    expect(manager.getOperation(operation.id)?.state).toBe("running");
    expect(JSON.stringify(manager.listOperations())).not.toContain(
      "private error",
    );
    transport.notify("error", {
      threadId: "thread-one",
      turnId: operation.turnId,
      error: { message: "matching private error" },
    });
    expect(manager.getOperation(operation.id)?.state).toBe("failed");
    expect(JSON.stringify(manager.listOperations())).not.toContain(
      "matching private error",
    );
  });
});
