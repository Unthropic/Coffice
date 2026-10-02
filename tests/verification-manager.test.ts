import { createHash } from "node:crypto";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createEmptyCofficeWorkspace,
  createVerificationReceipt,
  serializeVerificationStartRequest,
  transitionVerificationReceipt,
  type CofficeWorkspace,
  type VerificationCheckTransition,
  type VerificationReceipt,
  type VerificationStartRequest,
  type VerificationTarget,
} from "../src/lib/coffice-workspace";
import {
  CofficeVerificationCapacityError,
  CofficeVerificationIdempotencyError,
} from "../src/lib/coffice-workspace-store";
import { VerificationManager } from "../src/lib/verification-manager";
import type {
  VerificationExecutionRequest,
  VerificationExecutionResult,
} from "../src/lib/verification-execution";
import type {
  CodexSourceSnapshot,
  SourceProject,
} from "../src/lib/codex-source";

const NOW = "2026-08-12T12:00:00.000Z";
const ROOT = path.resolve("Coffice-verification-fixture");

function target(
  projectId = "project-a",
  resultId = "result-new",
): VerificationTarget {
  return {
    projectId,
    objectiveId: `objective-${projectId}`,
    workItemId: `work-${projectId}`,
    attemptId: `attempt-${projectId}`,
    resultKey: { kind: "turn", id: resultId },
  };
}

function project(projectId: string): CofficeWorkspace["projects"][number] {
  return {
    id: projectId,
    title: projectId,
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [
      {
        id: `objective-${projectId}`,
        title: "Ship the result",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        workItems: [
          {
            id: `work-${projectId}`,
            title: "Implement",
            expectedOutcome: "A verified result",
            status: "ready_for_review",
            createdAt: NOW,
            updatedAt: NOW,
            attempts: [
              {
                id: `attempt-${projectId}`,
                codexTaskId: `task-${projectId}`,
                relationship: "primary",
                linkedAt: NOW,
                resultCycles: [
                  {
                    key: { kind: "turn", id: "result-old" },
                    observedAt: NOW,
                  },
                  {
                    key: { kind: "turn", id: "result-new" },
                    observedAt: "2026-08-12T12:01:00.000Z",
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

function workspace(...projectIds: string[]): CofficeWorkspace {
  return {
    ...createEmptyCofficeWorkspace(NOW),
    projects: projectIds.map(project),
  };
}

function source(projects: SourceProject[]): CodexSourceSnapshot {
  return {
    projects,
    threadRootHints: new Map(),
    threadProjectAssignments: new Map(),
    invalidThreadProjectAssignments: new Set(),
    currentAssignmentsAvailable: true,
    sessions: [],
    sessionLocations: new Map(),
    sessionMetadata: new Map(),
    diagnostics: [],
    globalStateAvailable: true,
    sessionIndexAvailable: true,
    rosterAvailable: true,
  };
}

function sourceProject(id: string, rootPath = ROOT): SourceProject {
  return { id, name: id, rootPath, rootPaths: [rootPath], order: 0 };
}

class FakeStore {
  reconcileCalls = 0;
  readonly events: string[] = [];
  transitionFailures = 0;
  failAllTransitions = false;
  startError: Error | undefined;

  constructor(public workspace: CofficeWorkspace) {}

  async load() {
    return { workspace: this.workspace, recovery: { kind: "none" as const } };
  }

  async startVerification(request: VerificationStartRequest) {
    if (this.startError) throw this.startError;
    const replay = this.workspace.verificationReceipts.find(
      (receipt) => receipt.idempotencyKey === request.idempotencyKey,
    );
    const hash = createHash("sha256")
      .update(serializeVerificationStartRequest(request))
      .digest("hex");
    if (replay) {
      if (replay.requestHash !== hash) {
        throw new CofficeVerificationIdempotencyError(request.idempotencyKey);
      }
      return await this.load();
    }
    this.events.push("stored");
    this.workspace = {
      ...this.workspace,
      verificationReceipts: [
        ...this.workspace.verificationReceipts,
        createVerificationReceipt(request, hash, NOW),
      ],
    };
    return await this.load();
  }

  async transitionVerification(
    receiptId: string,
    transition: VerificationCheckTransition,
  ) {
    this.events.push(`transition:${transition.state}`);
    if (this.failAllTransitions || this.transitionFailures-- > 0) {
      throw new Error("PRIVATE_WORKSPACE_FAILURE");
    }
    this.workspace = {
      ...this.workspace,
      verificationReceipts: this.workspace.verificationReceipts.map(
        (receipt) =>
          receipt.id === receiptId
            ? transitionVerificationReceipt(receipt, transition, NOW)
            : receipt,
      ),
    };
    return await this.load();
  }

  async reconcileActiveVerifications() {
    this.reconcileCalls += 1;
    for (const receipt of this.workspace.verificationReceipts) {
      if (receipt.state !== "queued" && receipt.state !== "running") continue;
      const check = receipt.checks.find(
        (candidate) =>
          candidate.state === "queued" || candidate.state === "running",
      );
      if (check) {
        await this.transitionVerification(receipt.id, {
          check: { id: check.id, version: check.version },
          state: "unknown",
        });
      }
    }
    return await this.load();
  }
}

function receipt(
  requestTarget = target(),
  fields: Partial<Pick<VerificationReceipt, "id" | "idempotencyKey">> = {},
): VerificationReceipt {
  const request = {
    id: fields.id ?? "receipt-one",
    idempotencyKey: fields.idempotencyKey ?? "request-one",
    target: requestTarget,
    profile: { id: "test", version: "1" },
    checks: [{ id: "test", version: "1" }],
  } satisfies VerificationStartRequest;
  return createVerificationReceipt(
    request,
    createHash("sha256")
      .update(serializeVerificationStartRequest(request))
      .digest("hex"),
    NOW,
  );
}

function execution(
  state: VerificationExecutionResult["state"],
  fields: Partial<VerificationExecutionResult> = {},
): VerificationExecutionResult {
  return {
    id: "execution-one",
    profileId: "test",
    profileVersion: "1",
    state,
    startedAt: NOW,
    finishedAt: "2026-08-12T12:02:00.000Z",
    ...fields,
  };
}

function fakeExecutor(
  execute: (
    request: VerificationExecutionRequest,
  ) => Promise<VerificationExecutionResult>,
  isRootBlocked: (root: string) => boolean = () => false,
) {
  return { execute, isRootBlocked };
}

function request(requestTarget = target(), idempotencyKey = "request-one") {
  return {
    profileId: "test" as const,
    profileVersion: "1",
    idempotencyKey,
    target: requestTarget,
  };
}

async function waitForTerminal(
  manager: VerificationManager,
  projectId = "project-a",
) {
  await vi.waitFor(async () => {
    const snapshot = await manager.snapshot(projectId);
    expect(snapshot.operations).toHaveLength(0);
    expect(snapshot.receipts.at(-1)?.state).not.toMatch(/queued|running/);
  });
  return (await manager.snapshot(projectId)).receipts.at(-1)!;
}

describe("VerificationManager", () => {
  it("reconciles persisted active work once and never replays it", async () => {
    const durable = workspace("project-a");
    durable.verificationReceipts = [receipt()];
    const store = new FakeStore(durable);
    const execute = vi.fn();
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(execute),
      readSource: async () => source([sourceProject("project-a")]),
    });

    await manager.snapshot("project-a");
    const second = await manager.snapshot("project-a");

    expect(store.reconcileCalls).toBe(1);
    expect(second.receipts[0].state).toBe("unknown");
    expect(second.operations).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("admits only the exact newest result and derives the root from Codex", async () => {
    const store = new FakeStore(workspace("project-a"));
    const events = store.events;
    const execute = vi.fn(async (input: VerificationExecutionRequest) => {
      events.push("execute");
      expect(input.root).toBe(ROOT);
      expect(Object.keys(input).sort()).toEqual([
        "idempotencyKey",
        "onProgress",
        "profileId",
        "root",
        "signal",
      ]);
      return execution("completed", { exitCode: 0 });
    });
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(execute),
      readSource: async () => source([sourceProject("project-a")]),
      idFactory: () => "receipt-new",
    });

    await expect(
      manager.run(request(target("project-a", "result-old"))),
    ).rejects.toMatchObject({
      code: "TARGET_STALE",
    });
    await expect(
      manager.run(request(target("project-a", "missing"))),
    ).rejects.toMatchObject({
      code: "TARGET_NOT_FOUND",
    });
    const admitted = await manager.run(request());

    expect(admitted.receipt.id).toBe("receipt-new");
    expect(events.slice(0, 2)).toEqual(["stored", "execute"]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await waitForTerminal(manager)).state).toBe("passed");
  });

  it("binds confirmation to the current exact profile version", async () => {
    const store = new FakeStore(workspace("project-a"));
    const execute = vi.fn();
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(execute),
      readSource: async () => source([sourceProject("project-a")]),
    });

    await expect(
      manager.run({ ...request(), profileVersion: "2" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    expect(store.workspace.verificationReceipts).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns a durable replay before mutable target and source admission", async () => {
    const store = new FakeStore(workspace("project-a"));
    let resolveExecution!: (value: VerificationExecutionResult) => void;
    const execute = vi.fn(
      () =>
        new Promise<VerificationExecutionResult>((resolvePromise) => {
          resolveExecution = resolvePromise;
        }),
    );
    const readSource = vi.fn(async () => source([sourceProject("project-a")]));
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(execute),
      readSource,
      idFactory: () => "receipt-replay",
    });

    const first = await manager.run(request());
    readSource.mockRejectedValue(new Error("private source is gone"));
    store.workspace.projects[0].objectives[0].workItems[0].attempts[0].resultCycles.push(
      {
        key: { kind: "turn", id: "result-even-newer" },
        observedAt: "2026-08-12T12:03:00.000Z",
      },
    );

    const replay = await manager.run(request());
    await expect(
      manager.run(request(target("project-a", "result-old"))),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      manager.run({ ...request(), profileVersion: "2" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.id).toBe(first.receipt.id);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(readSource).toHaveBeenCalledTimes(1);
    resolveExecution(execution("unknown", { reason: "cancelled" }));
    expect((await waitForTerminal(manager)).state).toBe("unknown");
  });

  it("serializes each authoritative root while allowing exact active replay", async () => {
    const store = new FakeStore(workspace("project-a", "project-b"));
    let finish!: (value: VerificationExecutionResult) => void;
    const execute = vi.fn(
      () =>
        new Promise<VerificationExecutionResult>((resolvePromise) => {
          finish = resolvePromise;
        }),
    );
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(execute),
      readSource: async () =>
        source([
          sourceProject("project-a"),
          sourceProject("project-b", ROOT.toUpperCase()),
        ]),
      idFactory: () => "receipt-root-lock",
    });

    await manager.run(request());
    await expect(
      manager.run(request(target("project-b"), "request-two")),
    ).rejects.toMatchObject({ code: "ROOT_BUSY" });
    expect((await manager.run(request())).replayed).toBe(true);

    finish(execution("unknown", { reason: "cancelled" }));
    await waitForTerminal(manager);
  });

  it("does not create a receipt while the executor quarantines an ambiguous root", async () => {
    const store = new FakeStore(workspace("project-a"));
    let blocked = false;
    const execute = vi.fn(async () => {
      blocked = true;
      return execution("unknown", { reason: "protocol_error" });
    });
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(execute, () => blocked),
      readSource: async () => source([sourceProject("project-a")]),
      idFactory: () => "receipt-ambiguous-root",
    });

    await manager.run(request());
    expect((await waitForTerminal(manager)).state).toBe("unknown");
    expect(
      (await manager.snapshot("project-a")).profiles.every(
        (profile) => !profile.eligible,
      ),
    ).toBe(true);
    await expect(
      manager.run(request(target(), "request-after-ambiguity")),
    ).rejects.toMatchObject({ code: "ROOT_BUSY" });

    expect(store.workspace.verificationReceipts).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    [execution("completed", { exitCode: 0 }), "passed", undefined, undefined],
    [execution("completed"), "unknown", undefined, undefined],
    [
      execution("failed", { reason: "exit_nonzero", exitCode: 7 }),
      "failed",
      "exit",
      7,
    ],
    [
      execution("failed", { reason: "deadline" }),
      "failed",
      "timeout",
      undefined,
    ],
    [
      execution("failed", { reason: "launch_failed" }),
      "failed",
      "launch",
      undefined,
    ],
    [
      execution("unknown", { reason: "cancelled" }),
      "unknown",
      undefined,
      undefined,
    ],
    [
      execution("unknown", { reason: "protocol_error" }),
      "unknown",
      undefined,
      undefined,
    ],
    [
      execution("unknown", { reason: "app_server_unavailable" }),
      "unknown",
      undefined,
      undefined,
    ],
  ] as const)(
    "persists an honest structural execution outcome %#",
    async (result, expectedState, failureKind, exitCode) => {
      const store = new FakeStore(workspace("project-a"));
      const manager = new VerificationManager({
        store,
        executor: fakeExecutor(async () => result),
        readSource: async () => source([sourceProject("project-a")]),
        idFactory: () => "receipt-outcome",
      });

      await manager.run(request());
      const projected = await waitForTerminal(manager);

      expect(projected.state).toBe(expectedState);
      expect(projected.checks[0].failureKind).toBe(failureKind);
      expect(projected.checks[0].exitCode).toBe(exitCode);
    },
  );

  it("does not trust a terminal projection for a different profile", async () => {
    const store = new FakeStore(workspace("project-a"));
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(async () =>
        execution("completed", {
          profileId: "build",
          exitCode: 0,
        }),
      ),
      readSource: async () => source([sourceProject("project-a")]),
      idFactory: () => "receipt-profile-mismatch",
    });

    await manager.run(request());

    expect((await waitForTerminal(manager)).state).toBe("unknown");
  });

  it("cancels only a known active receipt and persists cancellation as unknown", async () => {
    const store = new FakeStore(workspace("project-a"));
    const execute = vi.fn(
      async ({ signal }: VerificationExecutionRequest) =>
        await new Promise<VerificationExecutionResult>((resolvePromise) => {
          signal?.addEventListener(
            "abort",
            () => resolvePromise(execution("unknown", { reason: "cancelled" })),
            { once: true },
          );
        }),
    );
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(execute),
      readSource: async () => source([sourceProject("project-a")]),
      idFactory: () => "receipt-cancel",
    });

    const started = await manager.run(request());
    const cancelled = await manager.cancel(started.receipt.id);

    expect(cancelled.receipt.state).toBe("unknown");
    expect(cancelled.receipt.checks[0].failureKind).toBeUndefined();
    await expect(manager.cancel(started.receipt.id)).rejects.toMatchObject({
      code: "RECEIPT_NOT_ACTIVE",
    });
  });

  it("recovers the terminal write after an earlier progress write fails", async () => {
    const store = new FakeStore(workspace("project-a"));
    store.transitionFailures = 1;
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(async (input) => {
        input.onProgress?.({
          checkId: "test",
          checkVersion: "1",
          state: "running",
          queuedAt: NOW,
          startedAt: NOW,
        });
        return execution("completed", { exitCode: 0 });
      }),
      readSource: async () => source([sourceProject("project-a")]),
      idFactory: () => "receipt-recovered-write",
    });

    await manager.run(request());
    const projected = await waitForTerminal(manager);

    expect(projected.state).toBe("passed");
    expect(store.events).toEqual([
      "stored",
      "transition:running",
      "transition:running",
      "transition:passed",
    ]);
  });

  it("keeps a permanently unpersisted terminal operation unavailable and locked", async () => {
    const store = new FakeStore(workspace("project-a"));
    store.failAllTransitions = true;
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(
        async ({ signal }) =>
          await new Promise<VerificationExecutionResult>((resolvePromise) => {
            signal?.addEventListener(
              "abort",
              () =>
                resolvePromise(execution("unknown", { reason: "cancelled" })),
              { once: true },
            );
          }),
      ),
      readSource: async () => source([sourceProject("project-a")]),
      idFactory: () => "receipt-permanent-failure",
    });

    const started = await manager.run(request());
    await expect(manager.cancel(started.receipt.id)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    const snapshot = await manager.snapshot("project-a");

    expect(snapshot.receipts[0].state).toBe("queued");
    expect(snapshot.operations).toEqual([
      { receiptId: started.receipt.id, state: "cancelling" },
    ]);
    await expect(
      manager.run(request(target(), "request-after-failure")),
    ).rejects.toMatchObject({ code: "ROOT_BUSY" });
  });

  it("consumes a background terminal-persistence rejection without a cancel waiter", async () => {
    const store = new FakeStore(workspace("project-a"));
    store.failAllTransitions = true;
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(async () =>
        execution("unknown", { reason: "protocol_error" }),
      ),
      readSource: async () => source([sourceProject("project-a")]),
      idFactory: () => "receipt-background-failure",
    });

    const started = await manager.run(request());
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
    const snapshot = await manager.snapshot("project-a");

    expect(snapshot.receipts[0].state).toBe("queued");
    expect(snapshot.operations).toEqual([
      { receiptId: started.receipt.id, state: "running" },
    ]);
  });

  it("maps exhausted durable receipt capacity without starting a command", async () => {
    const store = new FakeStore(workspace("project-a"));
    store.startError = new CofficeVerificationCapacityError();
    const execute = vi.fn();
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(execute),
      readSource: async () => source([sourceProject("project-a")]),
    });

    await expect(manager.run(request())).rejects.toMatchObject({
      code: "CAPACITY",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("projects only bounded structural data and never private execution material", async () => {
    const durable = workspace("project-a");
    durable.verificationReceipts = Array.from({ length: 140 }, (_, index) =>
      receipt(target(), {
        id: `receipt-${index}`,
        idempotencyKey: `request-${index}`,
      }),
    );
    const store = new FakeStore(durable);
    const privateRoot = path.resolve("PRIVATE_ROOT_SENTINEL");
    const manager = new VerificationManager({
      store,
      executor: fakeExecutor(vi.fn()),
      readSource: async () => source([sourceProject("project-a", privateRoot)]),
    });

    const snapshot = await manager.snapshot("project-a");
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.receipts).toHaveLength(128);
    expect(snapshot.profiles[0]).toEqual(
      expect.objectContaining({
        id: "test",
        version: "1",
        label: expect.any(String),
        description: expect.any(String),
        eligible: true,
      }),
    );
    expect(serialized).not.toContain(privateRoot);
    expect(serialized).not.toContain("npm");
    expect(serialized).not.toContain("requestHash");
    expect(serialized).not.toContain("idempotencyKey");
    expect(serialized).not.toContain("stdout");
    expect(serialized).not.toContain("stderr");
  });
});
