import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  CODEX_APP_SERVER_OPT_OUT_NOTIFICATIONS,
  createCodexAppServerTransport,
  type AppServerTransport,
  type AppServerTransportFactory,
} from "./codex-app-server";
import { COFFICE_VERSION } from "./product-version";

export const VERIFICATION_PROFILE_IDS = [
  "test",
  "typecheck",
  "lint",
  "build",
] as const;

export type VerificationProfileId = (typeof VERIFICATION_PROFILE_IDS)[number];

export interface VerificationProfile {
  id: VerificationProfileId;
  label: string;
  script: string;
  version: "1";
  timeoutMs: number;
  eligible: boolean;
}

export type VerificationExecutionState = "completed" | "failed" | "unknown";

export type VerificationExecutionReason =
  | "exit_nonzero"
  | "cancelled"
  | "deadline"
  | "launch_failed"
  | "app_server_unavailable"
  | "protocol_error"
  | "restarted";

export interface VerificationExecutionResult {
  id: string;
  profileId: VerificationProfileId;
  profileVersion: "1";
  state: VerificationExecutionState;
  startedAt: string;
  finishedAt: string;
  exitCode?: number;
  reason?: VerificationExecutionReason;
}

export type VerificationExecutionErrorCode =
  "INVALID_REQUEST" | "EXECUTION_BUSY" | "EXECUTION_CAPACITY";

export class VerificationExecutionError extends Error {
  constructor(readonly code: VerificationExecutionErrorCode) {
    super(code);
    this.name = "VerificationExecutionError";
  }
}

interface FixedProfile {
  id: VerificationProfileId;
  label: string;
  script: string;
  command: readonly string[];
  timeoutMs: number;
}

export function npmCommandPrefix(
  platform = process.platform,
  nodeExecutable = process.execPath,
): readonly string[] {
  return platform === "win32"
    ? [
        nodeExecutable,
        join(
          dirname(nodeExecutable),
          "node_modules",
          "npm",
          "bin",
          "npm-cli.js",
        ),
      ]
    : ["npm"];
}

const NPM_COMMAND_PREFIX = npmCommandPrefix();

const FIXED_PROFILES: readonly FixedProfile[] = [
  {
    id: "test",
    label: "Tests",
    script: "test",
    command: [...NPM_COMMAND_PREFIX, "run", "test"],
    timeoutMs: 5 * 60_000,
  },
  {
    id: "typecheck",
    label: "Type check",
    script: "typecheck",
    command: [...NPM_COMMAND_PREFIX, "run", "typecheck"],
    timeoutMs: 2 * 60_000,
  },
  {
    id: "lint",
    label: "Lint",
    script: "lint",
    command: [...NPM_COMMAND_PREFIX, "run", "lint"],
    timeoutMs: 3 * 60_000,
  },
  {
    id: "build",
    label: "Production build",
    script: "build",
    command: [...NPM_COMMAND_PREFIX, "run", "build"],
    timeoutMs: 5 * 60_000,
  },
] as const;

const PROFILE_BY_ID = new Map(FIXED_PROFILES.map((item) => [item.id, item]));
// Two capped 32 KiB streams can expand substantially when JSON escaping is
// required. This remains bounded while accepting their worst-case envelope.
const MAX_PROTOCOL_LINE_BYTES = 1024 * 1024;
const MAX_EXECUTIONS = 128;
const OUTPUT_BYTES_CAP = 32_768;
const INITIALIZE_TIMEOUT_MS = 15_000;
const TERMINATE_GRACE_MS = 2_000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 160;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

export function listVerificationProfiles(root: string): VerificationProfile[] {
  const eligible = isAbsolute(root);
  return FIXED_PROFILES.map((profile) => ({
    id: profile.id,
    label: profile.label,
    script: profile.script,
    version: "1",
    timeoutMs: profile.timeoutMs,
    eligible,
  }));
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: VerificationExecutionReason) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

interface RequestHandle {
  promise: Promise<unknown>;
  forget(): void;
}

class VerificationProtocolClient {
  private transport: AppServerTransport | undefined;
  private initialized: Promise<void> | undefined;
  private cleanupPromise: Promise<void> | undefined;
  private cleanupResolve: (() => void) | undefined;
  private cleanupTransport: AppServerTransport | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly factory: AppServerTransportFactory) {}

  async connect(): Promise<void> {
    if (this.cleanupPromise) throw "app_server_unavailable";
    if (this.initialized) return this.initialized;
    this.initialized = (async () => {
      try {
        const transport = this.factory();
        this.transport = transport;
        transport.onLine((line) => this.receive(line));
        transport.onExit(() => this.handleExit(transport));
        await this.request(
          "initialize",
          {
            clientInfo: {
              name: "coffice-verifier",
              title: "Coffice Verifier",
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
          INITIALIZE_TIMEOUT_MS,
        ).promise;
        await transport.write(JSON.stringify({ method: "initialized" }));
      } catch (reason) {
        this.transport?.close?.();
        this.transport = undefined;
        this.initialized = undefined;
        throw reason;
      }
    })();
    return this.initialized;
  }

  request(
    method: "initialize" | "command/exec" | "command/exec/terminate",
    params: JsonRecord,
    timeoutMs?: number,
  ): RequestHandle {
    const transport = this.transport;
    if (!transport) {
      return {
        promise: Promise.reject("app_server_unavailable"),
        forget() {},
      };
    }
    const id = this.nextId++;
    let pending: PendingRequest;
    const promise = new Promise<unknown>((resolve, reject) => {
      pending = { resolve, reject };
      if (timeoutMs !== undefined) {
        pending.timeout = setTimeout(() => {
          this.pending.delete(id);
          reject("app_server_unavailable");
        }, timeoutMs);
      }
      this.pending.set(id, pending);
      void transport.write(JSON.stringify({ method, id, params })).catch(() => {
        if (this.pending.get(id) !== pending) return;
        this.reset("app_server_unavailable");
      });
    });
    return {
      promise,
      forget: () => this.remove(id),
    };
  }

  close(): void {
    this.reset("app_server_unavailable");
  }

  isResetting(): boolean {
    return this.cleanupPromise !== undefined;
  }

  cleanupBarrier(): Promise<void> | undefined {
    return this.cleanupPromise;
  }

  private receive(line: string): void {
    if (Buffer.byteLength(line, "utf8") > MAX_PROTOCOL_LINE_BYTES) {
      this.reset("protocol_error");
      return;
    }
    let message: JsonRecord | undefined;
    try {
      message = record(JSON.parse(line));
    } catch {
      this.reset("protocol_error");
      return;
    }
    if (!message) return;
    if (typeof message.method === "string" && message.id !== undefined) {
      void this.transport
        ?.write(
          JSON.stringify({
            id: message.id,
            error: { code: -32001, message: "Unsupported server request" },
          }),
        )
        .catch(() => undefined);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.remove(message.id);
    if (message.error !== undefined) pending.reject("protocol_error");
    else pending.resolve(message.result);
  }

  private remove(id: number): void {
    const pending = this.pending.get(id);
    if (pending?.timeout) clearTimeout(pending.timeout);
    this.pending.delete(id);
  }

  private failAll(reason: VerificationExecutionReason): void {
    for (const [id, pending] of this.pending) {
      this.remove(id);
      pending.reject(reason);
    }
    this.transport = undefined;
    this.initialized = undefined;
  }

  private reset(reason: VerificationExecutionReason): void {
    const transport = this.transport;
    if (transport && !this.cleanupPromise) {
      this.cleanupTransport = transport;
      this.cleanupPromise = new Promise<void>((resolvePromise) => {
        this.cleanupResolve = resolvePromise;
      });
    }
    this.failAll(reason);
    try {
      transport?.close?.();
    } catch {
      // The cleanup barrier remains closed until transport exit is observed.
    }
  }

  private handleExit(transport: AppServerTransport): void {
    if (this.transport === transport) {
      this.failAll("app_server_unavailable");
    }
    if (this.cleanupTransport !== transport) return;
    const resolveCleanup = this.cleanupResolve;
    this.cleanupResolve = undefined;
    this.cleanupPromise = undefined;
    this.cleanupTransport = undefined;
    resolveCleanup?.();
  }
}

interface ExecutionEntry {
  fingerprint: string;
  promise: Promise<VerificationExecutionResult>;
  result?: VerificationExecutionResult;
}

export interface VerificationExecutionRequest {
  root: string;
  profileId: VerificationProfileId;
  idempotencyKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: VerificationExecutionProgress) => void;
}

export interface VerificationExecutionProgress {
  checkId: VerificationProfileId;
  checkVersion: "1";
  state: "queued" | "running" | "passed" | "failed" | "unknown";
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  failureKind?: "exit" | "timeout" | "launch";
  exitCode?: number;
}

export interface VerificationAppServerExecutorOptions {
  transportFactory?: AppServerTransportFactory;
  now?: () => Date;
  idFactory?: () => string;
  terminateGraceMs?: number;
}

export class VerificationAppServerExecutor {
  private readonly client: VerificationProtocolClient;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly terminateGraceMs: number;
  private readonly entries = new Map<string, ExecutionEntry>();
  private readonly activeRoots = new Set<string>();
  private readonly quarantinedRoots = new Set<string>();

  constructor(options: VerificationAppServerExecutorOptions = {}) {
    this.client = new VerificationProtocolClient(
      options.transportFactory ?? createCodexAppServerTransport,
    );
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.terminateGraceMs = options.terminateGraceMs ?? TERMINATE_GRACE_MS;
  }

  listResults(): VerificationExecutionResult[] {
    return [...this.entries.values()].flatMap((entry) =>
      entry.result ? [{ ...entry.result }] : [],
    );
  }

  isRootBlocked(root: string): boolean {
    return (
      this.client.isResetting() ||
      this.activeRoots.has(normalizeRoot(root).lockKey)
    );
  }

  async execute(
    request: VerificationExecutionRequest,
  ): Promise<VerificationExecutionResult> {
    if (
      typeof request.root !== "string" ||
      typeof request.idempotencyKey !== "string"
    )
      throw new VerificationExecutionError("INVALID_REQUEST");
    const { root, lockKey } = normalizeRoot(request.root);
    const profile = PROFILE_BY_ID.get(request.profileId);
    if (
      !profile ||
      request.idempotencyKey.length === 0 ||
      request.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
    )
      throw new VerificationExecutionError("INVALID_REQUEST");
    const fingerprint = JSON.stringify([lockKey, profile.id]);
    const prior = this.entries.get(request.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new VerificationExecutionError("INVALID_REQUEST");
      return prior.promise;
    }
    if (this.client.isResetting() || this.activeRoots.has(lockKey))
      throw new VerificationExecutionError("EXECUTION_BUSY");
    this.trimEntries();
    if (this.entries.size >= MAX_EXECUTIONS)
      throw new VerificationExecutionError("EXECUTION_CAPACITY");

    const queuedAt = this.now().toISOString();
    emitProgress(request.onProgress, {
      checkId: profile.id,
      checkVersion: "1",
      state: "queued",
      queuedAt,
    });
    this.activeRoots.add(lockKey);
    const promise = this.run(
      root,
      lockKey,
      profile,
      queuedAt,
      request.signal,
      request.onProgress,
    )
      .then((result) => {
        emitProgress(request.onProgress, {
          checkId: profile.id,
          checkVersion: "1",
          state: progressState(result),
          queuedAt,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          ...progressFailure(result),
        });
        return result;
      })
      .finally(() => {
        if (!this.quarantinedRoots.has(lockKey)) {
          this.activeRoots.delete(lockKey);
        }
      });
    const entry: ExecutionEntry = { fingerprint, promise };
    this.entries.set(request.idempotencyKey, entry);
    void promise.then(
      (result) => {
        entry.result = result;
      },
      () => undefined,
    );
    return promise;
  }

  close(): void {
    this.client.close();
  }

  private async run(
    root: string,
    lockKey: string,
    profile: FixedProfile,
    queuedAt: string,
    signal: AbortSignal | undefined,
    onProgress: VerificationExecutionRequest["onProgress"],
  ): Promise<VerificationExecutionResult> {
    const id = this.idFactory();
    const startedAt = this.now().toISOString();
    const finish = (
      state: VerificationExecutionState,
      fields: Pick<VerificationExecutionResult, "exitCode" | "reason"> = {},
    ): VerificationExecutionResult => ({
      id,
      profileId: profile.id,
      profileVersion: "1",
      state,
      startedAt,
      finishedAt: this.now().toISOString(),
      ...(fields.exitCode === undefined ? {} : { exitCode: fields.exitCode }),
      ...(fields.reason === undefined ? {} : { reason: fields.reason }),
    });

    if (signal?.aborted) return finish("unknown", { reason: "cancelled" });
    try {
      await this.client.connect();
    } catch {
      return finish("failed", { reason: "launch_failed" });
    }
    if (signal?.aborted) return finish("unknown", { reason: "cancelled" });

    emitProgress(onProgress, {
      checkId: profile.id,
      checkVersion: "1",
      state: "running",
      queuedAt,
      startedAt,
    });

    const processId = id;
    const execution = this.client.request("command/exec", {
      command: [...profile.command],
      processId,
      tty: false,
      streamStdin: false,
      streamStdoutStderr: false,
      outputBytesCap: OUTPUT_BYTES_CAP,
      timeoutMs: profile.timeoutMs,
      cwd: root,
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [root],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    });
    const trigger = cancellationTrigger(signal, profile.timeoutMs);
    const first = await Promise.race([
      execution.promise.then(
        (value) => ({ type: "response" as const, value }),
        (reason) => ({ type: "error" as const, reason }),
      ),
      trigger.promise,
    ]);
    trigger.dispose();
    if (first.type === "response") return projectExecution(first.value, finish);
    if (first.type === "error") {
      const cleanup = this.client.cleanupBarrier();
      if (cleanup) this.quarantineRootUntil(lockKey, cleanup);
      return finish("unknown", {
        reason: protocolReason(first.reason),
      });
    }

    const termination = this.client.request(
      "command/exec/terminate",
      { processId },
      this.terminateGraceMs,
    );
    void termination.promise.catch(() => undefined);
    const afterTerminate = await Promise.race([
      execution.promise.then(
        (value) => ({ type: "response" as const, value }),
        (reason) => ({ type: "error" as const, reason }),
      ),
      delay(this.terminateGraceMs).then(() => ({ type: "ambiguous" as const })),
    ]);
    if (afterTerminate.type === "response")
      return projectTerminatedExecution(
        afterTerminate.value,
        first.type,
        finish,
      );
    termination.forget();
    this.quarantineRootUntil(lockKey, execution.promise);
    return finish("unknown", {
      reason: first.type === "cancelled" ? "cancelled" : "deadline",
    });
  }

  private trimEntries(): void {
    while (this.entries.size >= MAX_EXECUTIONS) {
      const oldest = [...this.entries].find(([, entry]) => entry.result)?.[0];
      if (!oldest) return;
      this.entries.delete(oldest);
    }
  }

  private releaseQuarantinedRoot(lockKey: string): void {
    this.quarantinedRoots.delete(lockKey);
    this.activeRoots.delete(lockKey);
  }

  private quarantineRootUntil(
    lockKey: string,
    settlement: Promise<unknown>,
  ): void {
    this.quarantinedRoots.add(lockKey);
    void settlement.then(
      () => this.releaseQuarantinedRoot(lockKey),
      () => this.releaseQuarantinedRoot(lockKey),
    );
  }
}

function normalizeRoot(root: string): { root: string; lockKey: string } {
  if (!isAbsolute(root))
    throw new VerificationExecutionError("INVALID_REQUEST");
  const normalized = resolve(root);
  return {
    root: normalized,
    lockKey:
      process.platform === "win32" ? normalized.toLowerCase() : normalized,
  };
}

function protocolReason(reason: unknown): VerificationExecutionReason {
  return reason === "app_server_unavailable"
    ? "app_server_unavailable"
    : "protocol_error";
}

function projectExecution(
  value: unknown,
  finish: (
    state: VerificationExecutionState,
    fields?: Pick<VerificationExecutionResult, "exitCode" | "reason">,
  ) => VerificationExecutionResult,
): VerificationExecutionResult {
  const response = record(value);
  const exitCode = response?.exitCode;
  if (!validExitCode(exitCode))
    return finish("unknown", { reason: "protocol_error" });
  if (exitCode === 0) return finish("completed", { exitCode: 0 });
  return finish("failed", {
    exitCode: exitCode as number,
    reason: "exit_nonzero",
  });
}

function projectTerminatedExecution(
  value: unknown,
  cause: "cancelled" | "deadline",
  finish: (
    state: VerificationExecutionState,
    fields?: Pick<VerificationExecutionResult, "exitCode" | "reason">,
  ) => VerificationExecutionResult,
): VerificationExecutionResult {
  const exitCode = record(value)?.exitCode;
  if (!validExitCode(exitCode))
    return finish("unknown", { reason: "protocol_error" });
  if (exitCode === 0) return finish("completed", { exitCode: 0 });
  if (cause === "cancelled")
    return finish("unknown", {
      exitCode: exitCode as number,
      reason: "cancelled",
    });
  return finish("failed", {
    exitCode: exitCode as number,
    reason: "deadline",
  });
}

function validExitCode(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= -2_147_483_648 &&
    (value as number) <= 2_147_483_647
  );
}

function cancellationTrigger(
  signal: AbortSignal | undefined,
  timeoutMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const promise = new Promise<{ type: "cancelled" } | { type: "deadline" }>(
    (resolvePromise) => {
      timeout = setTimeout(
        () => resolvePromise({ type: "deadline" }),
        timeoutMs,
      );
      if (signal) {
        abortListener = () => resolvePromise({ type: "cancelled" });
        signal.addEventListener("abort", abortListener, { once: true });
        if (signal.aborted) resolvePromise({ type: "cancelled" });
      }
    },
  );
  return {
    promise,
    dispose() {
      if (timeout) clearTimeout(timeout);
      if (signal && abortListener)
        signal.removeEventListener("abort", abortListener);
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function emitProgress(
  callback: VerificationExecutionRequest["onProgress"],
  progress: VerificationExecutionProgress,
): void {
  try {
    callback?.({ ...progress });
  } catch {
    // A persistence observer cannot change the execution outcome.
  }
}

function progressState(
  result: VerificationExecutionResult,
): "passed" | "failed" | "unknown" {
  return result.state === "completed" ? "passed" : result.state;
}

function progressFailure(
  result: VerificationExecutionResult,
): Pick<VerificationExecutionProgress, "failureKind" | "exitCode"> {
  if (result.state !== "failed") return {};
  if (result.reason === "exit_nonzero" && result.exitCode !== undefined)
    return { failureKind: "exit", exitCode: result.exitCode };
  if (result.reason === "deadline") return { failureKind: "timeout" };
  return { failureKind: "launch" };
}

export function recoverVerificationExecutionAfterRestart(
  execution: Omit<
    VerificationExecutionResult,
    "state" | "finishedAt" | "reason" | "exitCode"
  >,
  now: Date = new Date(),
): VerificationExecutionResult {
  return {
    ...execution,
    state: "unknown",
    finishedAt: now.toISOString(),
    reason: "restarted",
  };
}

declare global {
  var __cofficeVerificationExecutor: VerificationAppServerExecutor | undefined;
}

export function getVerificationAppServerExecutor(): VerificationAppServerExecutor {
  return (globalThis.__cofficeVerificationExecutor ??=
    new VerificationAppServerExecutor());
}
