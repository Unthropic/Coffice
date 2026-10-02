import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppServerTransport } from "../src/lib/codex-app-server";
import {
  listVerificationProfiles,
  npmCommandPrefix,
  recoverVerificationExecutionAfterRestart,
  VerificationAppServerExecutor,
  VerificationExecutionError,
} from "../src/lib/verification-execution";

type Message = Record<string, unknown>;

class FakeTransport implements AppServerTransport {
  writes: Message[] = [];
  commandResponse: unknown = { exitCode: 0, stdout: "", stderr: "" };
  holdCommand = false;
  respondToTerminate = true;
  failCommandWrite = false;
  closeCount = 0;
  private lineListener: ((line: string) => void) | undefined;
  private exitListener: (() => void) | undefined;
  private commandId: number | undefined;

  async write(line: string): Promise<void> {
    const message = JSON.parse(line) as Message;
    this.writes.push(message);
    const id = message.id;
    if (typeof id !== "number") return;
    if (message.method === "initialize") this.respond(id, {});
    if (message.method === "command/exec") {
      this.commandId = id;
      if (this.failCommandWrite) throw new Error("private write failure");
      if (!this.holdCommand) this.respond(id, this.commandResponse);
    }
    if (message.method === "command/exec/terminate" && this.respondToTerminate)
      this.respond(id, {});
  }

  onLine(listener: (line: string) => void): void {
    this.lineListener = listener;
  }

  onExit(listener: () => void): void {
    this.exitListener = listener;
  }

  close(): void {
    this.closeCount += 1;
  }

  respond(id: number, result: unknown): void {
    queueMicrotask(() => this.lineListener?.(JSON.stringify({ id, result })));
  }

  rejectCommand(error: unknown): void {
    if (this.commandId === undefined) throw new Error("No held command");
    const id = this.commandId;
    queueMicrotask(() => this.lineListener?.(JSON.stringify({ id, error })));
  }

  completeHeld(result: unknown): void {
    if (this.commandId === undefined) throw new Error("No held command");
    this.respond(this.commandId, result);
  }

  sendRaw(line: string): void {
    this.lineListener?.(line);
  }

  notify(method: string, params: unknown): void {
    this.lineListener?.(JSON.stringify({ method, params }));
  }

  serverRequest(id: number, method: string, params: unknown): void {
    this.lineListener?.(JSON.stringify({ id, method, params }));
  }

  exit(): void {
    this.exitListener?.();
  }
}

describe("verification execution", () => {
  it("uses Node plus npm's JavaScript CLI on Windows without a command shell", () => {
    expect(npmCommandPrefix("win32", "C:\\Node\\node.exe")).toEqual([
      "C:\\Node\\node.exe",
      "C:\\Node\\node_modules\\npm\\bin\\npm-cli.js",
    ]);
    expect(npmCommandPrefix("linux", "/usr/bin/node")).toEqual(["npm"]);
  });

  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "coffice-verification-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it("offers only fixed, versioned profiles without reading repository files", () => {
    const profiles = listVerificationProfiles(root);

    expect(
      profiles.map(({ id, script, eligible }) => ({ id, script, eligible })),
    ).toEqual([
      { id: "test", script: "test", eligible: true },
      { id: "typecheck", script: "typecheck", eligible: true },
      { id: "lint", script: "lint", eligible: true },
      { id: "build", script: "build", eligible: true },
    ]);
    expect(
      listVerificationProfiles("relative").every((item) => !item.eligible),
    ).toBe(true);
  });

  it("sends the exact stable command/exec request and retains no output", async () => {
    const transport = new FakeTransport();
    transport.commandResponse = {
      exitCode: 0,
      stdout: "private stdout",
      stderr: "private stderr",
    };
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
      idFactory: () => "process-one",
    });

    const progress: unknown[] = [];
    const result = await executor.execute({
      root,
      profileId: "test",
      idempotencyKey: "test-one",
      onProgress: (update) => progress.push(update),
    });

    expect(transport.writes.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "command/exec",
    ]);
    expect(
      (
        transport.writes[0].params as {
          capabilities: { optOutNotificationMethods: string[] };
        }
      ).capabilities.optOutNotificationMethods,
    ).toEqual(
      expect.arrayContaining([
        "command/exec/outputDelta",
        "item/agentMessage/delta",
        "turn/diff/updated",
      ]),
    );
    expect(transport.writes[2]).toEqual({
      method: "command/exec",
      id: 2,
      params: {
        command: [
          ...(process.platform === "win32"
            ? [
                process.execPath,
                join(
                  dirname(process.execPath),
                  "node_modules",
                  "npm",
                  "bin",
                  "npm-cli.js",
                ),
              ]
            : ["npm"]),
          "run",
          "test",
        ],
        processId: "process-one",
        tty: false,
        streamStdin: false,
        streamStdoutStderr: false,
        outputBytesCap: 32768,
        timeoutMs: 300000,
        cwd: root,
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [root],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      },
    });
    expect(result).toMatchObject({
      id: "process-one",
      profileId: "test",
      profileVersion: "1",
      state: "completed",
      exitCode: 0,
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(executor.listResults())).not.toContain("private");
    expect(progress).toEqual([
      expect.objectContaining({
        checkId: "test",
        checkVersion: "1",
        state: "queued",
      }),
      expect.objectContaining({
        checkId: "test",
        checkVersion: "1",
        state: "running",
      }),
      expect.objectContaining({
        checkId: "test",
        checkVersion: "1",
        state: "passed",
      }),
    ]);
    expect(JSON.stringify(progress)).not.toContain("private");
  });

  it("ignores output notifications and never retains their payload", async () => {
    const transport = new FakeTransport();
    transport.holdCommand = true;
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });
    const pending = executor.execute({
      root,
      profileId: "test",
      idempotencyKey: "output-delta",
    });
    await vi.waitFor(() =>
      expect(
        transport.writes.some((item) => item.method === "command/exec"),
      ).toBe(true),
    );
    transport.notify("command/exec/outputDelta", {
      processId: "private-process",
      delta: "notification sentinel",
    });
    transport.completeHeld({
      exitCode: 0,
      stdout: "final stdout sentinel",
      stderr: "final stderr sentinel",
    });
    await pending;

    expect(JSON.stringify(executor.listResults())).not.toContain("sentinel");
    expect(JSON.stringify(executor.listResults())).not.toContain("private");
  });

  it("accepts worst-case escaped capped output and discards it", async () => {
    const transport = new FakeTransport();
    transport.commandResponse = {
      exitCode: 0,
      stdout: "\u0000".repeat(32_768),
      stderr: "\u0001".repeat(32_768),
    };
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });

    await expect(
      executor.execute({
        root,
        profileId: "test",
        idempotencyKey: "escaped-output",
      }),
    ).resolves.toMatchObject({ state: "completed", exitCode: 0 });
    expect(JSON.stringify(executor.listResults())).not.toContain("\\u0000");
  });

  it("rejects colliding server requests without consuming the exec response", async () => {
    const transport = new FakeTransport();
    transport.holdCommand = true;
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });
    const pending = executor.execute({
      root,
      profileId: "test",
      idempotencyKey: "server-request-collision",
    });
    await vi.waitFor(() =>
      expect(
        transport.writes.some((item) => item.method === "command/exec"),
      ).toBe(true),
    );
    transport.serverRequest(2, "item/tool/requestUserInput", {
      prompt: "callback body sentinel",
    });
    await vi.waitFor(() =>
      expect(transport.writes.at(-1)).toEqual({
        id: 2,
        error: { code: -32001, message: "Unsupported server request" },
      }),
    );
    transport.completeHeld({ exitCode: 0 });

    await expect(pending).resolves.toMatchObject({ state: "completed" });
    expect(JSON.stringify(executor.listResults())).not.toContain("sentinel");
  });

  it("projects nonzero exits and malformed responses structurally", async () => {
    const failedTransport = new FakeTransport();
    failedTransport.commandResponse = { exitCode: 7, stdout: "secret" };
    const failed = new VerificationAppServerExecutor({
      transportFactory: () => failedTransport,
    });
    await expect(
      failed.execute({ root, profileId: "lint", idempotencyKey: "lint" }),
    ).resolves.toMatchObject({
      state: "failed",
      exitCode: 7,
      reason: "exit_nonzero",
    });

    const malformedTransport = new FakeTransport();
    malformedTransport.commandResponse = { exitCode: "zero", stdout: "secret" };
    const malformed = new VerificationAppServerExecutor({
      transportFactory: () => malformedTransport,
    });
    await expect(
      malformed.execute({
        root,
        profileId: "typecheck",
        idempotencyKey: "typecheck",
      }),
    ).resolves.toMatchObject({ state: "unknown", reason: "protocol_error" });
    expect(JSON.stringify(malformed.listResults())).not.toContain("secret");
  });

  it("treats a structured error after command admission as unknown", async () => {
    const transport = new FakeTransport();
    transport.holdCommand = true;
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });
    const pending = executor.execute({
      root,
      profileId: "test",
      idempotencyKey: "structured-command-error",
    });
    await vi.waitFor(() =>
      expect(
        transport.writes.some((item) => item.method === "command/exec"),
      ).toBe(true),
    );
    transport.rejectCommand({
      code: -32602,
      message: "private command error sentinel",
    });

    await expect(pending).resolves.toMatchObject({
      state: "unknown",
      reason: "protocol_error",
    });
    expect(JSON.stringify(executor.listResults())).not.toContain("private");
    expect(JSON.stringify(executor.listResults())).not.toContain("sentinel");
  });

  it("quarantines malformed protocol and partial-write ambiguity until transport exit", async () => {
    const malformedTransport = new FakeTransport();
    malformedTransport.holdCommand = true;
    const malformedExecutor = new VerificationAppServerExecutor({
      transportFactory: () => malformedTransport,
    });
    const malformed = malformedExecutor.execute({
      root,
      profileId: "test",
      idempotencyKey: "malformed-line",
    });
    await vi.waitFor(() =>
      expect(
        malformedTransport.writes.some(
          (item) => item.method === "command/exec",
        ),
      ).toBe(true),
    );
    malformedTransport.sendRaw("{malformed");
    await expect(malformed).resolves.toMatchObject({
      state: "unknown",
      reason: "protocol_error",
    });
    expect(malformedTransport.closeCount).toBe(1);
    expect(malformedExecutor.isRootBlocked(root)).toBe(true);
    await expect(
      malformedExecutor.execute({
        root,
        profileId: "lint",
        idempotencyKey: "blocked-after-malformed-line",
      }),
    ).rejects.toMatchObject({ code: "EXECUTION_BUSY" });
    expect(
      malformedTransport.writes.filter(
        (item) => item.method === "command/exec",
      ),
    ).toHaveLength(1);
    malformedTransport.exit();
    await Promise.resolve();
    expect(malformedExecutor.isRootBlocked(root)).toBe(false);

    const writeTransport = new FakeTransport();
    writeTransport.failCommandWrite = true;
    const writeExecutor = new VerificationAppServerExecutor({
      transportFactory: () => writeTransport,
    });
    await expect(
      writeExecutor.execute({
        root,
        profileId: "test",
        idempotencyKey: "partial-write",
      }),
    ).resolves.toMatchObject({
      state: "unknown",
      reason: "app_server_unavailable",
    });
    expect(writeTransport.closeCount).toBe(1);
    expect(writeExecutor.isRootBlocked(root)).toBe(true);
    writeTransport.exit();
    await Promise.resolve();
    expect(writeExecutor.isRootBlocked(root)).toBe(false);
  });

  it("does not let a stale transport exit release a newer cleanup barrier", async () => {
    const firstTransport = new FakeTransport();
    firstTransport.holdCommand = true;
    const secondTransport = new FakeTransport();
    secondTransport.holdCommand = true;
    const transports = [firstTransport, secondTransport];
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transports.shift()!,
    });

    const first = executor.execute({
      root,
      profileId: "test",
      idempotencyKey: "first-reset-generation",
    });
    await vi.waitFor(() =>
      expect(
        firstTransport.writes.some((item) => item.method === "command/exec"),
      ).toBe(true),
    );
    firstTransport.sendRaw("{malformed");
    await first;
    firstTransport.exit();
    await Promise.resolve();
    expect(executor.isRootBlocked(root)).toBe(false);

    const second = executor.execute({
      root,
      profileId: "lint",
      idempotencyKey: "second-reset-generation",
    });
    await vi.waitFor(() =>
      expect(
        secondTransport.writes.some((item) => item.method === "command/exec"),
      ).toBe(true),
    );
    secondTransport.sendRaw("{malformed");
    await second;
    expect(executor.isRootBlocked(root)).toBe(true);

    firstTransport.exit();
    await Promise.resolve();
    expect(executor.isRootBlocked(root)).toBe(true);
    secondTransport.exit();
    await Promise.resolve();
    expect(executor.isRootBlocked(root)).toBe(false);
  });

  it("fails closed on oversized protocol messages", async () => {
    const transport = new FakeTransport();
    transport.holdCommand = true;
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });
    const pending = executor.execute({
      root,
      profileId: "build",
      idempotencyKey: "oversized",
    });
    await vi.waitFor(() =>
      expect(
        transport.writes.some((item) => item.method === "command/exec"),
      ).toBe(true),
    );
    transport.sendRaw(
      `{"id":2,"result":{"stdout":"${"x".repeat(1_100_000)}"}}`,
    );

    await expect(pending).resolves.toMatchObject({
      state: "unknown",
      reason: "protocol_error",
    });
  });

  it("deduplicates exact requests and rejects changed reuse or root concurrency", async () => {
    const transport = new FakeTransport();
    transport.holdCommand = true;
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });
    const first = executor.execute({
      root,
      profileId: "test",
      idempotencyKey: "same",
    });
    const duplicate = executor.execute({
      root,
      profileId: "test",
      idempotencyKey: "same",
    });
    await expect(
      executor.execute({
        root,
        profileId: "lint",
        idempotencyKey: "same",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      executor.execute({
        root: process.platform === "win32" ? root.toUpperCase() : root,
        profileId: "lint",
        idempotencyKey: "other",
      }),
    ).rejects.toMatchObject({ code: "EXECUTION_BUSY" });
    await vi.waitFor(() =>
      expect(
        transport.writes.filter((item) => item.method === "command/exec"),
      ).toHaveLength(1),
    );
    transport.completeHeld({ exitCode: 0 });
    expect(await duplicate).toEqual(await first);
  });

  it("terminates on cancellation and waits for the original final response", async () => {
    const transport = new FakeTransport();
    transport.holdCommand = true;
    const controller = new AbortController();
    const progress: unknown[] = [];
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });
    const pending = executor.execute({
      root,
      profileId: "lint",
      idempotencyKey: "cancel",
      signal: controller.signal,
      onProgress: (update) => progress.push(update),
    });
    await vi.waitFor(() =>
      expect(
        transport.writes.some((item) => item.method === "command/exec"),
      ).toBe(true),
    );
    controller.abort();
    await vi.waitFor(() =>
      expect(transport.writes.at(-1)).toMatchObject({
        method: "command/exec/terminate",
        params: { processId: expect.any(String) },
      }),
    );
    transport.completeHeld({ exitCode: 130, stdout: "discard me" });

    await expect(pending).resolves.toMatchObject({
      state: "unknown",
      exitCode: 130,
      reason: "cancelled",
    });
    expect(progress.at(-1)).toEqual(
      expect.objectContaining({ state: "unknown" }),
    );
    expect(progress.at(-1)).not.toHaveProperty("failureKind");
    expect(progress.at(-1)).not.toHaveProperty("exitCode");
  });

  it("accepts a successful final response that wins the cancellation race", async () => {
    const transport = new FakeTransport();
    transport.holdCommand = true;
    const controller = new AbortController();
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });
    const pending = executor.execute({
      root,
      profileId: "lint",
      idempotencyKey: "cancel-race-success",
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(
        transport.writes.some((item) => item.method === "command/exec"),
      ).toBe(true),
    );
    controller.abort();
    await vi.waitFor(() =>
      expect(transport.writes.at(-1)).toMatchObject({
        method: "command/exec/terminate",
      }),
    );
    transport.completeHeld({ exitCode: 0, stdout: "discarded success" });

    await expect(pending).resolves.toMatchObject({
      state: "completed",
      exitCode: 0,
    });
  });

  it("preserves deadline cause when termination yields a late nonzero exit", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    transport.holdCommand = true;
    const progress: unknown[] = [];
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
      terminateGraceMs: 50,
    });
    const pending = executor.execute({
      root,
      profileId: "typecheck",
      idempotencyKey: "late-deadline-exit",
      onProgress: (update) => progress.push(update),
    });
    await vi.advanceTimersByTimeAsync(120_000);
    transport.completeHeld({ exitCode: 124, stderr: "discarded timeout" });

    await expect(pending).resolves.toMatchObject({
      state: "failed",
      exitCode: 124,
      reason: "deadline",
    });
    expect(progress.at(-1)).toEqual(
      expect.objectContaining({ state: "failed", failureKind: "timeout" }),
    );
    expect(progress.at(-1)).not.toHaveProperty("exitCode");
  });

  it("marks an ambiguous deadline unknown after terminate grace", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    transport.holdCommand = true;
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
      terminateGraceMs: 50,
    });
    const pending = executor.execute({
      root,
      profileId: "typecheck",
      idempotencyKey: "deadline",
    });
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toMatchObject({
      state: "unknown",
      reason: "deadline",
    });
    expect(executor.isRootBlocked(root)).toBe(true);
    expect(transport.writes).toContainEqual(
      expect.objectContaining({ method: "command/exec/terminate" }),
    );

    await expect(
      executor.execute({
        root,
        profileId: "lint",
        idempotencyKey: "blocked-by-ambiguous-process",
      }),
    ).rejects.toMatchObject({ code: "EXECUTION_BUSY" });

    transport.completeHeld({ exitCode: 124, stderr: "discarded late output" });
    await Promise.resolve();
    await Promise.resolve();
    expect(executor.isRootBlocked(root)).toBe(false);
    transport.holdCommand = false;
    await expect(
      executor.execute({
        root,
        profileId: "lint",
        idempotencyKey: "after-definitive-settlement",
      }),
    ).resolves.toMatchObject({ state: "completed" });
  });

  it("accepts signed exit codes and rejects values outside the durable range", async () => {
    const negativeTransport = new FakeTransport();
    negativeTransport.commandResponse = {
      exitCode: -1,
      stdout: "discarded",
      stderr: "discarded",
    };
    const negativeProgress: unknown[] = [];
    const negativeExecutor = new VerificationAppServerExecutor({
      transportFactory: () => negativeTransport,
    });
    await expect(
      negativeExecutor.execute({
        root,
        profileId: "test",
        idempotencyKey: "negative-exit",
        onProgress: (progress) => negativeProgress.push(progress),
      }),
    ).resolves.toMatchObject({
      state: "failed",
      reason: "exit_nonzero",
      exitCode: -1,
    });
    expect(negativeProgress.at(-1)).toEqual(
      expect.objectContaining({
        state: "failed",
        failureKind: "exit",
        exitCode: -1,
      }),
    );

    const oversizedTransport = new FakeTransport();
    oversizedTransport.commandResponse = { exitCode: 2_147_483_648 };
    const oversizedExecutor = new VerificationAppServerExecutor({
      transportFactory: () => oversizedTransport,
    });
    await expect(
      oversizedExecutor.execute({
        root,
        profileId: "test",
        idempotencyKey: "oversized-exit",
      }),
    ).resolves.toMatchObject({ state: "unknown", reason: "protocol_error" });
  });

  it("rejects non-authoritative relative roots without starting App Server", async () => {
    const transport = new FakeTransport();
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });

    await expect(
      executor.execute({
        root: "relative",
        profileId: "build",
        idempotencyKey: "missing",
      }),
    ).rejects.toBeInstanceOf(VerificationExecutionError);
    expect(transport.writes).toEqual([]);
  });

  it("maps cancellation before launch to unknown rather than a failed check", async () => {
    const transport = new FakeTransport();
    const controller = new AbortController();
    controller.abort();
    const executor = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });

    await expect(
      executor.execute({
        root,
        profileId: "test",
        idempotencyKey: "cancel-before-launch",
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ state: "unknown", reason: "cancelled" });
    expect(transport.writes).toEqual([]);
  });

  it("distinguishes launch failure from ambiguity after command admission", async () => {
    const launchFailure = new VerificationAppServerExecutor({
      transportFactory: () => {
        throw new Error("private transport detail");
      },
    });
    await expect(
      launchFailure.execute({
        root,
        profileId: "test",
        idempotencyKey: "launch-failure",
      }),
    ).resolves.toMatchObject({ state: "failed", reason: "launch_failed" });

    const transport = new FakeTransport();
    transport.holdCommand = true;
    const admitted = new VerificationAppServerExecutor({
      transportFactory: () => transport,
    });
    const pending = admitted.execute({
      root,
      profileId: "test",
      idempotencyKey: "admitted-exit",
    });
    await vi.waitFor(() =>
      expect(
        transport.writes.some((item) => item.method === "command/exec"),
      ).toBe(true),
    );
    transport.exit();

    await expect(pending).resolves.toMatchObject({
      state: "unknown",
      reason: "app_server_unavailable",
    });
    expect(JSON.stringify(admitted.listResults())).not.toContain("private");
  });

  it("turns executions known to be active at restart into unknown receipts", () => {
    expect(
      recoverVerificationExecutionAfterRestart(
        {
          id: "old-process",
          profileId: "test",
          profileVersion: "1",
          startedAt: "2026-08-12T00:00:00.000Z",
        },
        new Date("2026-08-12T00:05:00.000Z"),
      ),
    ).toEqual({
      id: "old-process",
      profileId: "test",
      profileVersion: "1",
      state: "unknown",
      startedAt: "2026-08-12T00:00:00.000Z",
      finishedAt: "2026-08-12T00:05:00.000Z",
      reason: "restarted",
    });
  });
});
