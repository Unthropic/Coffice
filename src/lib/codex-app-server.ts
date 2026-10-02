import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";

import { COFFICE_VERSION } from "./product-version";

export const CODEX_OPERATION_STATES = [
  "queued",
  "connecting",
  "sent",
  "running",
  "waiting",
  "completed",
  "failed",
  "interrupted",
  "unknown",
] as const;

export type CodexOperationState = (typeof CODEX_OPERATION_STATES)[number];
export type CodexOperationKind =
  "send_follow_up" | "request_review" | "archive_task";

export interface CodexOperation {
  id: string;
  kind: CodexOperationKind;
  taskId: string;
  state: CodexOperationState;
  createdAt: string;
  updatedAt: string;
  turnId?: string;
  reviewThreadId?: string;
  cancelRequestedAt?: string;
  errorCode?: CodexActionErrorCode;
}

export type CodexApprovalDecision = "accept" | "decline" | "cancel";

interface CodexPendingRequestBase {
  id: string;
  operationId: string;
  taskId: string;
  receivedAt: string;
}

export interface CodexPendingCommandApproval extends CodexPendingRequestBase {
  kind: "command_approval";
  command?: string;
  cwd?: string;
  reason?: string;
  environmentId?: string;
  network?: { host: string; protocol: string };
  allowOnce: boolean;
  canDecline: boolean;
  canCancel: boolean;
  requiresCodexReview: boolean;
}

export interface CodexPendingFileChangeApproval extends CodexPendingRequestBase {
  kind: "file_change_approval";
  grantRoot?: string;
  reason?: string;
  canDecline: boolean;
  canCancel: boolean;
}

export interface CodexPendingClarificationQuestion {
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  allowOther: boolean;
  options: readonly { label: string; description: string }[];
}

export interface CodexPendingClarification extends CodexPendingRequestBase {
  kind: "clarification";
  autoResolutionMs?: number;
  questions: readonly CodexPendingClarificationQuestion[];
}

export type CodexPendingRequest =
  | CodexPendingCommandApproval
  | CodexPendingFileChangeApproval
  | CodexPendingClarification;

export type CodexPendingResponse =
  | { kind: "approval"; decision: CodexApprovalDecision }
  | {
      kind: "clarification";
      answers: Record<string, readonly string[]>;
    };

export type CodexActionErrorCode =
  | "APP_SERVER_UNAVAILABLE"
  | "APP_SERVER_EXITED"
  | "APP_SERVER_PROTOCOL_ERROR"
  | "APP_SERVER_TIMEOUT"
  | "APP_SERVER_BUSY"
  | "TASK_NOT_IDLE"
  | "USER_ACTION_REQUIRED"
  | "REQUEST_REJECTED";

export class CodexActionError extends Error {
  constructor(readonly code: CodexActionErrorCode) {
    super(code);
    this.name = "CodexActionError";
  }
}

export interface AppServerTransport {
  write(line: string): Promise<void>;
  onLine(listener: (line: string) => void): void;
  onExit(listener: () => void): void;
  close?(): void;
}

export type AppServerTransportFactory = () => AppServerTransport;

export const MAX_GOAL_STATUS_THREADS_PER_READ = 64;
const MAX_GOAL_STATUS_CONCURRENCY = 8;

export interface CodexBlockedGoalEvidence {
  threadId: string;
  updatedAt: string;
}

export interface CodexBlockedGoalRead {
  available: boolean;
  evidence: ReadonlyMap<string, CodexBlockedGoalEvidence>;
}

// Coffice requests metadata-only resume/read responses and opts out of every
// content-bearing notification. Keep a defensive ceiling in case a mismatched
// server violates that contract.
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_PENDING_REQUESTS = 16;
const MAX_OPERATIONS = 128;
const REQUEST_TIMEOUT_MS = 15_000;
export const OPERATION_RECONCILE_INTERVAL_MS = 2 * 60 * 1_000;
const MAX_RECONCILIATION_FAILURES = 3;
const MAX_SAFE_ID_LENGTH = 160;
const MAX_CALLBACK_TEXT_LENGTH = 16_000;
const MAX_CALLBACK_FIELD_LENGTH = 4_096;
const MAX_CALLBACK_QUESTIONS = 8;
const MAX_CALLBACK_OPTIONS = 16;
const MAX_CALLBACK_TOTAL_TEXT = 24_000;
const MAX_UNMATCHED_COMPLETIONS = 32;
const ALLOWED_REQUEST_METHODS = new Set([
  "initialize",
  "thread/resume",
  "thread/read",
  "thread/goal/get",
  "thread/archive",
  "thread/unsubscribe",
  "turn/interrupt",
  "turn/start",
  "review/start",
]);
const ALLOWED_NOTIFICATION_METHODS = new Set([
  "initialized",
  "thread/status/changed",
  "turn/started",
  "turn/completed",
  "error",
]);
const ALLOWED_WAITING_REQUEST_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "item/permissions/requestApproval",
]);
const TERMINAL_OPERATION_STATES = new Set<CodexOperationState>([
  "completed",
  "failed",
  "interrupted",
  "unknown",
]);
const OPERATION_STATE_RANK: Record<CodexOperationState, number> = {
  queued: 0,
  connecting: 1,
  sent: 2,
  running: 3,
  waiting: 4,
  completed: 5,
  failed: 5,
  interrupted: 5,
  unknown: 5,
};

export const CODEX_APP_SERVER_OPT_OUT_NOTIFICATIONS = [
  "account/login/completed",
  "account/rateLimits/updated",
  "account/updated",
  "app/list/updated",
  "command/exec/outputDelta",
  "configWarning",
  "deprecationNotice",
  "externalAgentConfig/import/completed",
  "externalAgentConfig/import/progress",
  "fs/changed",
  "fuzzyFileSearch/sessionCompleted",
  "fuzzyFileSearch/sessionUpdated",
  "guardianWarning",
  "hook/completed",
  "hook/started",
  "item/agentMessage/delta",
  "item/autoApprovalReview/completed",
  "item/autoApprovalReview/started",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/completed",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/mcpToolCall/progress",
  "item/plan/delta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/started",
  "mcpServer/oauthLogin/completed",
  "mcpServer/startupStatus/updated",
  "model/rerouted",
  "model/safetyBuffering/updated",
  "model/verification",
  "process/exited",
  "process/outputDelta",
  "rawResponse/completed",
  "rawResponseItem/completed",
  "remoteControl/status/changed",
  "serverRequest/resolved",
  "skills/changed",
  "thread/archived",
  "thread/closed",
  "thread/compacted",
  "thread/deleted",
  "thread/environment/connected",
  "thread/environment/disconnected",
  "thread/goal/cleared",
  "thread/goal/updated",
  "thread/name/updated",
  "thread/realtime/closed",
  "thread/realtime/error",
  "thread/realtime/itemAdded",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/started",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/settings/updated",
  "thread/started",
  "thread/tokenUsage/updated",
  "thread/unarchived",
  "turn/diff/updated",
  "turn/moderationMetadata",
  "turn/plan/updated",
  "warning",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
] as const;

type JsonRecord = Record<string, unknown>;

type PendingServerRequest = {
  request: CodexPendingRequest;
  serverRequestId: string | number;
  serverItemId: string;
  questionIds?: ReadonlyMap<string, string>;
};

function clonePendingRequest(
  request: CodexPendingRequest,
): CodexPendingRequest {
  if (request.kind === "clarification") {
    return {
      ...request,
      questions: request.questions.map((question) => ({
        ...question,
        options: question.options.map((option) => ({ ...option })),
      })),
    };
  }
  return {
    ...request,
    ...(request.kind === "command_approval" && request.network
      ? { network: { ...request.network } }
      : {}),
  };
}

function projectPendingServerRequest(
  method: string,
  params: JsonRecord,
  operation: CodexOperation,
  receivedAt: string,
): Omit<PendingServerRequest, "serverRequestId"> | undefined {
  const serverItemId = safeId(params.itemId);
  if (!serverItemId) return undefined;
  if (
    (method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval") &&
    (typeof params.startedAtMs !== "number" ||
      !Number.isSafeInteger(params.startedAtMs) ||
      params.startedAtMs < 0)
  )
    return undefined;
  const base = {
    id: randomUUID(),
    operationId: operation.id,
    taskId: operation.taskId,
    receivedAt,
  };
  if (method === "item/commandExecution/requestApproval") {
    const command = boundedCallbackText(
      params.command,
      MAX_CALLBACK_TEXT_LENGTH,
    );
    const cwd = boundedCallbackText(params.cwd);
    const reason = boundedCallbackText(params.reason);
    const environmentId = boundedCallbackText(params.environmentId, 160);
    const networkContext = record(params.networkApprovalContext);
    const host = boundedCallbackText(networkContext?.host, 253);
    const protocol = boundedCallbackText(networkContext?.protocol, 32);
    const decisions = decisionStrings(params.availableDecisions);
    const requiresCodexReview =
      params.additionalPermissions != null ||
      params.proposedExecpolicyAmendment != null ||
      params.proposedNetworkPolicyAmendments != null;
    const total =
      (command?.length ?? 0) +
      (cwd?.length ?? 0) +
      (reason?.length ?? 0) +
      (environmentId?.length ?? 0) +
      (host?.length ?? 0) +
      (protocol?.length ?? 0);
    if (total > MAX_CALLBACK_TOTAL_TEXT) return undefined;
    return {
      serverItemId,
      request: {
        ...base,
        kind: "command_approval",
        ...(command ? { command } : {}),
        ...(cwd ? { cwd } : {}),
        ...(reason ? { reason } : {}),
        ...(environmentId ? { environmentId } : {}),
        ...(host && protocol ? { network: { host, protocol } } : {}),
        allowOnce:
          Boolean(command) && decisions.has("accept") && !requiresCodexReview,
        canDecline: decisions.has("decline"),
        canCancel: decisions.has("cancel"),
        requiresCodexReview,
      },
    };
  }
  if (method === "item/fileChange/requestApproval") {
    const grantRoot = boundedCallbackText(params.grantRoot);
    const reason = boundedCallbackText(params.reason);
    if (
      (grantRoot?.length ?? 0) + (reason?.length ?? 0) >
      MAX_CALLBACK_TOTAL_TEXT
    )
      return undefined;
    return {
      serverItemId,
      request: {
        ...base,
        kind: "file_change_approval",
        ...(grantRoot ? { grantRoot } : {}),
        ...(reason ? { reason } : {}),
        canDecline: true,
        canCancel: true,
      },
    };
  }
  if (method === "item/tool/requestUserInput") {
    if (
      !Array.isArray(params.questions) ||
      params.questions.length < 1 ||
      params.questions.length > MAX_CALLBACK_QUESTIONS
    )
      return undefined;
    const questionIds = new Map<string, string>();
    let total = 0;
    const questions: CodexPendingClarificationQuestion[] = [];
    for (const rawQuestion of params.questions) {
      const question = record(rawQuestion);
      const originalId = safeId(question?.id);
      const header = boundedCallbackText(question?.header, 160);
      const prompt = boundedCallbackText(question?.question);
      if (!question || !originalId || !header || !prompt) return undefined;
      const rawOptions = question.options;
      if (
        rawOptions !== undefined &&
        (!Array.isArray(rawOptions) || rawOptions.length > MAX_CALLBACK_OPTIONS)
      )
        return undefined;
      const options: Array<{ label: string; description: string }> = [];
      for (const rawOption of Array.isArray(rawOptions) ? rawOptions : []) {
        const option = record(rawOption);
        const label = boundedCallbackText(option?.label, 500);
        const description = boundedCallbackText(option?.description, 2_000);
        if (!label || !description) return undefined;
        total += label.length + description.length;
        options.push({ label, description });
      }
      total += header.length + prompt.length;
      if (total > MAX_CALLBACK_TOTAL_TEXT) return undefined;
      const localId = randomUUID();
      questionIds.set(localId, originalId);
      questions.push({
        id: localId,
        header,
        question: prompt,
        isSecret: question.isSecret === true,
        allowOther: question.isOther === true,
        options,
      });
    }
    const autoResolutionMs =
      typeof params.autoResolutionMs === "number" &&
      Number.isSafeInteger(params.autoResolutionMs) &&
      params.autoResolutionMs > 0
        ? params.autoResolutionMs
        : undefined;
    return {
      serverItemId,
      request: {
        ...base,
        kind: "clarification",
        ...(autoResolutionMs ? { autoResolutionMs } : {}),
        questions,
      },
      questionIds,
    };
  }
  return undefined;
}

type CompletionReceipt = {
  state: "completed" | "failed" | "interrupted" | "unknown";
  errorCode?: CodexActionErrorCode;
};

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function safeId(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SAFE_ID_LENGTH
    ? value
    : undefined;
}

function boundedCallbackText(
  value: unknown,
  max = MAX_CALLBACK_FIELD_LENGTH,
): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : undefined;
}

function decisionStrings(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value)
      ? value.filter((decision): decision is string =>
          ["accept", "decline", "cancel"].includes(String(decision)),
        )
      : [],
  );
}

function completionReceipt(status: unknown): CompletionReceipt {
  if (status === "completed") return { state: "completed" };
  if (status === "failed")
    return { state: "failed", errorCode: "REQUEST_REJECTED" };
  if (status === "interrupted") return { state: "interrupted" };
  return { state: "unknown" };
}

function completionKey(threadId: string, turnId: string): string {
  return JSON.stringify([threadId, turnId]);
}

export function executableOnPath(
  names: readonly string[],
  pathValue = process.env.PATH ?? "",
  pathDelimiter = delimiter,
  canExecute: (candidate: string) => boolean = (candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
): string | undefined {
  for (const directory of pathValue.split(pathDelimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = join(directory.replace(/^"|"$/g, ""), name);
      if (canExecute(candidate)) return candidate;
    }
  }
  return undefined;
}

export function resolveCodexExecutable(): string {
  const configured = process.env.COFFICE_CODEX_EXECUTABLE;
  if (configured) {
    try {
      accessSync(configured, constants.X_OK);
      return configured;
    } catch {
      throw new CodexActionError("APP_SERVER_UNAVAILABLE");
    }
  }
  const names =
    process.platform === "win32"
      ? ["codex.exe", "codex.cmd", "codex.bat"]
      : ["codex"];
  const match = executableOnPath(names);
  if (match) return match;
  throw new CodexActionError("APP_SERVER_UNAVAILABLE");
}

export function appServerSpawnSpec(
  executable: string,
  commandShell = process.env.ComSpec ?? "cmd.exe",
): {
  command: string;
  args: string[];
  windowsVerbatimArguments: boolean;
} {
  const isCommandShim = /\.(?:cmd|bat)$/i.test(executable);
  return isCommandShim
    ? {
        command: commandShell,
        args: ["/d", "/s", "/c", `""${executable}" app-server --stdio"`],
        windowsVerbatimArguments: true,
      }
    : {
        command: executable,
        args: ["app-server", "--stdio"],
        windowsVerbatimArguments: false,
      };
}

class ChildProcessTransport implements AppServerTransport {
  private lineListener: ((line: string) => void) | undefined;
  private exitListener: (() => void) | undefined;
  private buffered = "";
  private exitNotified = false;
  private readonly child: ChildProcessByStdio<Writable, Readable, null>;

  constructor() {
    const launch = appServerSpawnSpec(resolveCodexExecutable());
    this.child = spawn(launch.command, launch.args, {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.consume(chunk));
    this.child.stdin.on("error", () => this.close());
    this.child.once("close", () => this.notifyExit());
    this.child.once("error", () => {
      if (!this.child.pid) this.notifyExit();
      else this.close();
    });
  }

  write(line: string): Promise<void> {
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES)
      return Promise.reject(new CodexActionError("APP_SERVER_PROTOCOL_ERROR"));
    return new Promise((resolve, reject) => {
      this.child.stdin.write(`${line}\n`, (error) => {
        if (error) reject(new CodexActionError("APP_SERVER_UNAVAILABLE"));
        else resolve();
      });
    });
  }

  onLine(listener: (line: string) => void): void {
    this.lineListener = listener;
  }

  onExit(listener: () => void): void {
    this.exitListener = listener;
  }

  close(): void {
    this.child.kill();
  }

  private consume(chunk: string): void {
    this.buffered += chunk;
    for (;;) {
      const newline = this.buffered.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffered.slice(0, newline).replace(/\r$/, "");
      this.buffered = this.buffered.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        this.buffered = "";
        this.close();
        return;
      }
      if (line) this.lineListener?.(line);
    }
    if (Buffer.byteLength(this.buffered, "utf8") > MAX_LINE_BYTES) {
      this.buffered = "";
      this.close();
    }
  }

  private notifyExit(): void {
    if (this.exitNotified) return;
    this.exitNotified = true;
    this.exitListener?.();
  }
}

export function createCodexAppServerTransport(): AppServerTransport {
  return new ChildProcessTransport();
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: CodexActionError) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class CodexAppServerManager {
  private lastBlockedGoalEvidence = new Map<string, CodexBlockedGoalEvidence>();
  private transport: AppServerTransport | undefined;
  private initialized: Promise<void> | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly operations = new Map<string, CodexOperation>();
  private readonly subscriptions = new Map<string, Set<string>>();
  private readonly unsubscribeStarted = new Map<string, Set<string>>();
  private readonly watchdogs = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly reconciliationFailures = new Map<string, number>();
  private readonly unmatchedCompletions = new Map<string, CompletionReceipt>();
  private readonly cancellationRequests = new Map<
    string,
    Promise<CodexOperation>
  >();
  private readonly pendingServerRequests = new Map<
    string,
    PendingServerRequest
  >();
  private readonly idempotency = new Map<
    string,
    { operationId: string; fingerprint: string }
  >();

  constructor(
    private readonly transportFactory: AppServerTransportFactory = createCodexAppServerTransport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Reads only structural goal state for an already-admitted visible roster.
   * The all-or-nothing bound and error handling prevent a partial response from
   * being mistaken for an authoritative lifecycle transition. Goal objective
   * text is discarded by projectResponse before this method can observe it.
   */
  async readBlockedGoalEvidence(
    threadIds: readonly string[],
  ): Promise<CodexBlockedGoalRead> {
    const ids = [...new Set(threadIds.map(safeId).filter(Boolean))] as string[];
    if (
      ids.length !== threadIds.length ||
      ids.length > MAX_GOAL_STATUS_THREADS_PER_READ
    ) {
      return this.unavailableBlockedGoalRead(ids);
    }
    if (ids.length === 0) {
      this.lastBlockedGoalEvidence = new Map();
      return { available: true, evidence: new Map() };
    }
    try {
      await this.connect();
      const blocked = new Map<string, CodexBlockedGoalEvidence>();
      for (
        let offset = 0;
        offset < ids.length;
        offset += MAX_GOAL_STATUS_CONCURRENCY
      ) {
        const batch = ids.slice(offset, offset + MAX_GOAL_STATUS_CONCURRENCY);
        const responses = await Promise.all(
          batch.map(async (threadId) => ({
            threadId,
            response: record(
              await this.request("thread/goal/get", { threadId }),
            ),
          })),
        );
        for (const { threadId, response } of responses) {
          if (!response || response.available !== true) {
            throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
          }
          const goal = record(response.goal);
          if (!goal) continue;
          if (safeId(goal.threadId) !== threadId) {
            throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
          }
          if (goal.status === "blocked" && typeof goal.updatedAt === "string") {
            blocked.set(threadId, { threadId, updatedAt: goal.updatedAt });
          }
        }
      }
      this.lastBlockedGoalEvidence = blocked;
      return { available: true, evidence: new Map(blocked) };
    } catch {
      return this.unavailableBlockedGoalRead(ids);
    }
  }

  private unavailableBlockedGoalRead(
    threadIds: readonly string[],
  ): CodexBlockedGoalRead {
    const admittedIds = new Set(threadIds);
    return {
      available: false,
      evidence: new Map(
        [...this.lastBlockedGoalEvidence].filter(([threadId]) =>
          admittedIds.has(threadId),
        ),
      ),
    };
  }

  listOperations(): CodexOperation[] {
    return [...this.operations.values()].map((operation) => ({ ...operation }));
  }

  listPendingRequests(): CodexPendingRequest[] {
    return [...this.pendingServerRequests.values()].map(({ request }) =>
      clonePendingRequest(request),
    );
  }

  getOperation(id: string): CodexOperation | undefined {
    const operation = this.operations.get(id);
    return operation ? { ...operation } : undefined;
  }

  lookupIdempotentOperation(
    kind: CodexOperationKind,
    taskId: string,
    idempotencyKey: string,
    text = "",
  ): CodexOperation | undefined {
    const prior = this.idempotency.get(idempotencyKey);
    if (!prior) return undefined;
    if (prior.fingerprint !== actionFingerprint(kind, taskId, text))
      throw new CodexActionError("REQUEST_REJECTED");
    return this.getOperation(prior.operationId);
  }

  async sendFollowUp(
    taskId: string,
    text: string,
    idempotencyKey: string,
  ): Promise<CodexOperation> {
    const fingerprint = actionFingerprint("send_follow_up", taskId, text);
    return this.runOperation(
      "send_follow_up",
      taskId,
      idempotencyKey,
      fingerprint,
      async (id) => {
        this.addSubscription(id, taskId);
        const resumed = record(
          await this.request("thread/resume", {
            threadId: taskId,
            excludeTurns: true,
          }),
        );
        const thread = record(resumed?.thread);
        const status = record(thread?.status);
        const resumedThreadId = safeId(thread?.id);
        if (resumedThreadId) this.addSubscription(id, resumedThreadId);
        if (resumedThreadId !== taskId || status?.type !== "idle") {
          throw new CodexActionError("TASK_NOT_IDLE");
        }
        this.update(id, "sent");
        const responsePromise = this.request("turn/start", {
          threadId: taskId,
          clientUserMessageId: idempotencyKey,
          input: [{ type: "text", text, text_elements: [] }],
        });
        // The content is serialized synchronously by request(). Clear this
        // scope before awaiting the response so it is not retained in an
        // operation, pending request, error, or long-lived closure.
        text = "";
        const response = record(await responsePromise);
        const turnId = safeId(record(response?.turn)?.id);
        if (!turnId) throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
        this.update(id, "running", { turnId });
      },
    );
  }

  async requestReview(
    taskId: string,
    idempotencyKey: string,
  ): Promise<CodexOperation> {
    const fingerprint = actionFingerprint("request_review", taskId);
    return this.runOperation(
      "request_review",
      taskId,
      idempotencyKey,
      fingerprint,
      async (id) => {
        this.addSubscription(id, taskId);
        const resumed = record(
          await this.request("thread/resume", {
            threadId: taskId,
            excludeTurns: true,
          }),
        );
        const thread = record(resumed?.thread);
        const resumedThreadId = safeId(thread?.id);
        if (resumedThreadId) this.addSubscription(id, resumedThreadId);
        if (
          resumedThreadId !== taskId ||
          record(thread?.status)?.type !== "idle"
        )
          throw new CodexActionError("TASK_NOT_IDLE");
        this.update(id, "sent");
        const response = record(
          await this.request("review/start", {
            threadId: taskId,
            target: { type: "uncommittedChanges" },
            delivery: "detached",
          }),
        );
        const turnId = safeId(record(response?.turn)?.id);
        const reviewThreadId = safeId(response?.reviewThreadId);
        if (reviewThreadId) this.addSubscription(id, reviewThreadId);
        if (!turnId || !reviewThreadId)
          throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
        this.update(id, "running", { turnId, reviewThreadId });
        this.consumeCompletion(id, reviewThreadId, turnId);
      },
    );
  }

  async archiveTask(
    taskId: string,
    idempotencyKey: string,
  ): Promise<CodexOperation> {
    const fingerprint = actionFingerprint("archive_task", taskId);
    return this.runOperation(
      "archive_task",
      taskId,
      idempotencyKey,
      fingerprint,
      async (id) => {
        const response = record(
          await this.request("thread/read", {
            threadId: taskId,
            includeTurns: false,
          }),
        );
        const thread = record(response?.thread);
        if (
          safeId(thread?.id) !== taskId ||
          record(thread?.status)?.type !== "idle"
        ) {
          throw new CodexActionError("TASK_NOT_IDLE");
        }
        this.update(id, "sent");
        await this.request("thread/archive", { threadId: taskId });
        this.update(id, "completed");
      },
    );
  }

  async cancelOperation(
    operationId: string,
    taskId: string,
  ): Promise<CodexOperation> {
    const operation = this.operations.get(operationId);
    if (
      !operation ||
      operation.taskId !== taskId ||
      operation.kind === "archive_task" ||
      TERMINAL_OPERATION_STATES.has(operation.state) ||
      !operation.turnId
    ) {
      throw new CodexActionError("REQUEST_REJECTED");
    }
    if (operation.cancelRequestedAt) return { ...operation };
    const pending = this.cancellationRequests.get(operationId);
    if (pending) return await pending;
    const request = this.requestOperationCancellation(operationId, operation);
    this.cancellationRequests.set(operationId, request);
    try {
      return await request;
    } finally {
      if (this.cancellationRequests.get(operationId) === request)
        this.cancellationRequests.delete(operationId);
    }
  }

  async respondToPendingRequest(
    requestId: string,
    taskId: string,
    response: CodexPendingResponse,
  ): Promise<CodexOperation> {
    const pending = this.pendingServerRequests.get(requestId);
    const operation = pending
      ? this.operations.get(pending.request.operationId)
      : undefined;
    if (
      !pending ||
      !operation ||
      pending.request.taskId !== taskId ||
      operation.taskId !== taskId ||
      operation.state !== "waiting"
    ) {
      throw new CodexActionError("REQUEST_REJECTED");
    }

    let result: JsonRecord;
    if (
      pending.request.kind === "clarification" &&
      response.kind === "clarification"
    ) {
      const questionIds = pending.questionIds;
      if (!questionIds) throw new CodexActionError("REQUEST_REJECTED");
      const answerKeys = Object.keys(response.answers);
      if (
        answerKeys.length !== questionIds.size ||
        answerKeys.some((key) => !questionIds.has(key))
      ) {
        throw new CodexActionError("REQUEST_REJECTED");
      }
      const answers: Record<string, { answers: string[] }> = {};
      let total = 0;
      for (const [localId, originalId] of questionIds) {
        const values = response.answers[localId];
        if (
          !Array.isArray(values) ||
          values.length < 1 ||
          values.length > MAX_CALLBACK_OPTIONS
        ) {
          throw new CodexActionError("REQUEST_REJECTED");
        }
        const normalized = values.map((value) => {
          if (
            typeof value !== "string" ||
            value.length < 1 ||
            value.length > MAX_CALLBACK_FIELD_LENGTH
          ) {
            throw new CodexActionError("REQUEST_REJECTED");
          }
          total += value.length;
          return value;
        });
        if (total > MAX_CALLBACK_TOTAL_TEXT)
          throw new CodexActionError("REQUEST_REJECTED");
        answers[originalId] = { answers: normalized };
      }
      result = { answers };
    } else if (
      pending.request.kind !== "clarification" &&
      response.kind === "approval"
    ) {
      const { decision } = response;
      const allowed =
        (decision === "accept" &&
          pending.request.kind === "command_approval" &&
          pending.request.allowOnce) ||
        (decision === "decline" && pending.request.canDecline) ||
        (decision === "cancel" && pending.request.canCancel);
      if (!allowed) throw new CodexActionError("REQUEST_REJECTED");
      result = { decision };
    } else {
      throw new CodexActionError("REQUEST_REJECTED");
    }

    // Remove the only long-lived copy before the response crosses the process
    // boundary. Failed delivery is never retried automatically.
    this.pendingServerRequests.delete(requestId);
    try {
      const transport = this.transport;
      if (!transport) throw new CodexActionError("APP_SERVER_UNAVAILABLE");
      await transport.write(
        JSON.stringify({ id: pending.serverRequestId, result }),
      );
      this.resumeAfterUserResponse(operation.id);
    } catch {
      this.update(operation.id, "unknown", {
        errorCode: "APP_SERVER_UNAVAILABLE",
      });
    }
    return this.getOperation(operation.id)!;
  }

  private async requestOperationCancellation(
    operationId: string,
    operation: CodexOperation,
  ): Promise<CodexOperation> {
    const threadId = operation.reviewThreadId ?? operation.taskId;
    try {
      await this.request("turn/interrupt", {
        threadId,
        turnId: operation.turnId,
      });
      const current = this.operations.get(operationId);
      if (current && !TERMINAL_OPERATION_STATES.has(current.state)) {
        this.update(operationId, current.state, {
          cancelRequestedAt: this.now().toISOString(),
        });
      }
      return this.getOperation(operationId)!;
    } catch (error) {
      const safeError =
        error instanceof CodexActionError
          ? error
          : new CodexActionError("REQUEST_REJECTED");
      if (
        safeError.code === "APP_SERVER_EXITED" ||
        safeError.code === "APP_SERVER_TIMEOUT" ||
        safeError.code === "APP_SERVER_UNAVAILABLE" ||
        safeError.code === "APP_SERVER_PROTOCOL_ERROR"
      ) {
        this.update(operationId, "unknown", { errorCode: safeError.code });
        return this.getOperation(operationId)!;
      }
      throw safeError;
    }
  }

  private async runOperation(
    kind: CodexOperationKind,
    taskId: string,
    idempotencyKey: string,
    fingerprint: string,
    run: (id: string) => Promise<void>,
  ): Promise<CodexOperation> {
    const priorRecord = this.idempotency.get(idempotencyKey);
    if (priorRecord) {
      if (priorRecord.fingerprint !== fingerprint)
        throw new CodexActionError("REQUEST_REJECTED");
      return this.getOperation(priorRecord.operationId)!;
    }
    if (
      [...this.operations.values()].some(
        (operation) =>
          operation.taskId === taskId &&
          !TERMINAL_OPERATION_STATES.has(operation.state),
      )
    )
      throw new CodexActionError("APP_SERVER_BUSY");
    this.trimOperations(MAX_OPERATIONS - 1);
    if (this.operations.size >= MAX_OPERATIONS)
      throw new CodexActionError("APP_SERVER_BUSY");
    const timestamp = this.now().toISOString();
    const id = randomUUID();
    this.operations.set(id, {
      id,
      kind,
      taskId,
      state: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.idempotency.set(idempotencyKey, { operationId: id, fingerprint });
    try {
      this.update(id, "connecting");
      await this.connect();
      await run(id);
    } catch (error) {
      const safeError =
        error instanceof CodexActionError
          ? error
          : new CodexActionError("REQUEST_REJECTED");
      const current = this.operations.get(id);
      const uncertain =
        safeError.code === "APP_SERVER_EXITED" ||
        (current?.state === "sent" &&
          (safeError.code === "APP_SERVER_TIMEOUT" ||
            safeError.code === "APP_SERVER_UNAVAILABLE" ||
            safeError.code === "APP_SERVER_PROTOCOL_ERROR"));
      this.update(id, uncertain ? "unknown" : "failed", {
        errorCode: safeError.code,
      });
    }
    return this.getOperation(id)!;
  }

  private connect(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = (async () => {
      try {
        const transport = this.transportFactory();
        this.transport = transport;
        transport.onLine((line) => this.receive(line));
        transport.onExit(() => this.onExit());
        await this.request("initialize", {
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
        });
        await this.notify("initialized");
      } catch (error) {
        this.transport?.close?.();
        this.transport = undefined;
        this.initialized = undefined;
        throw error instanceof CodexActionError
          ? error
          : new CodexActionError("APP_SERVER_UNAVAILABLE");
      }
    })();
    return this.initialized;
  }

  private request(method: string, params: JsonRecord): Promise<unknown> {
    if (!ALLOWED_REQUEST_METHODS.has(method))
      return Promise.reject(new CodexActionError("REQUEST_REJECTED"));
    if (this.pending.size >= MAX_PENDING_REQUESTS)
      return Promise.reject(new CodexActionError("APP_SERVER_BUSY"));
    const transport = this.transport;
    if (!transport && method !== "initialize")
      return Promise.reject(new CodexActionError("APP_SERVER_UNAVAILABLE"));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexActionError("APP_SERVER_TIMEOUT"));
      }, REQUEST_TIMEOUT_MS);
      const pending: PendingRequest = { method, resolve, reject, timeout };
      this.pending.set(id, pending);
      try {
        const writer = transport ?? this.transport;
        if (!writer) throw new CodexActionError("APP_SERVER_UNAVAILABLE");
        void writer.write(JSON.stringify({ method, id, params })).catch(() => {
          const active = this.pending.get(id);
          if (active !== pending) return;
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(new CodexActionError("APP_SERVER_UNAVAILABLE"));
        });
      } catch {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new CodexActionError("APP_SERVER_UNAVAILABLE"));
      }
    });
  }

  private async notify(method: string): Promise<void> {
    if (!ALLOWED_NOTIFICATION_METHODS.has(method))
      throw new CodexActionError("REQUEST_REJECTED");
    const transport = this.transport;
    if (!transport) throw new CodexActionError("APP_SERVER_UNAVAILABLE");
    await transport.write(JSON.stringify({ method }));
  }

  private receive(line: string): void {
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) return this.onExit();
    let message: JsonRecord | undefined;
    try {
      message = record(JSON.parse(line));
    } catch {
      return;
    }
    if (!message) return;
    const method = typeof message.method === "string" ? message.method : "";
    if (message.id !== undefined && method) {
      if (ALLOWED_WAITING_REQUEST_METHODS.has(method)) {
        if (this.captureServerRequest(message.id, method, message.params))
          return;
      }
      this.rejectServerRequest(message.id);
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new CodexActionError("REQUEST_REJECTED"));
      } else {
        try {
          pending.resolve(projectResponse(pending.method, message.result));
        } catch {
          pending.reject(new CodexActionError("APP_SERVER_PROTOCOL_ERROR"));
        }
      }
      return;
    }
    if (!ALLOWED_NOTIFICATION_METHODS.has(method)) return;
    const params = record(message.params);
    const threadId = safeId(params?.threadId);
    const turn = record(params?.turn);
    const turnId =
      method === "error" ? safeId(params?.turnId) : safeId(turn?.id);
    let matchedOperation = false;
    for (const operation of this.operations.values()) {
      if (TERMINAL_OPERATION_STATES.has(operation.state)) continue;
      const lifecycleThreadId =
        operation.kind === "request_review"
          ? operation.reviewThreadId
          : operation.taskId;
      if (!lifecycleThreadId) continue;
      const matchesThread = lifecycleThreadId === threadId;
      const matchesTurn = !operation.turnId || operation.turnId === turnId;
      if (!matchesThread) continue;
      if (method !== "thread/status/changed" && !matchesTurn) continue;
      matchedOperation = true;
      if (method === "turn/started" && turnId)
        this.update(operation.id, "running", { turnId });
      if (method === "turn/completed") {
        const receipt = completionReceipt(turn?.status);
        this.update(operation.id, receipt.state, {
          ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
        });
      }
      if (method === "error")
        this.update(operation.id, "failed", { errorCode: "REQUEST_REJECTED" });
      if (method === "thread/status/changed") {
        const type = record(params?.status)?.type;
        if (type === "active") this.update(operation.id, "running");
        if (type === "systemError")
          this.update(operation.id, "failed", {
            errorCode: "REQUEST_REJECTED",
          });
      }
    }
    if (
      method === "turn/completed" &&
      threadId &&
      turnId &&
      !matchedOperation
    ) {
      this.cacheCompletion(threadId, turnId, completionReceipt(turn?.status));
    }
  }

  private onExit(): void {
    this.transport = undefined;
    this.initialized = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new CodexActionError("APP_SERVER_EXITED"));
    }
    this.pending.clear();
    this.pendingServerRequests.clear();
    this.unmatchedCompletions.clear();
    for (const operation of this.operations.values()) {
      if (
        ["connecting", "sent", "running", "waiting"].includes(operation.state)
      )
        this.update(operation.id, "unknown", {
          errorCode: "APP_SERVER_EXITED",
        });
    }
  }

  private update(
    id: string,
    state: CodexOperationState,
    fields: Partial<
      Pick<
        CodexOperation,
        "turnId" | "reviewThreadId" | "cancelRequestedAt" | "errorCode"
      >
    > = {},
  ): void {
    const current = this.operations.get(id);
    if (!current) return;
    if (TERMINAL_OPERATION_STATES.has(current.state)) return;
    if (OPERATION_STATE_RANK[state] < OPERATION_STATE_RANK[current.state])
      return;
    this.operations.set(id, {
      ...current,
      ...fields,
      state,
      updatedAt: this.now().toISOString(),
    });
    if (TERMINAL_OPERATION_STATES.has(state)) {
      this.clearPendingRequest(id);
      this.clearWatchdog(id);
      this.reconciliationFailures.delete(id);
      this.unsubscribeAll(id);
    } else if (state === "sent" || state === "running" || state === "waiting") {
      this.armWatchdog(id);
    }
  }

  private cacheCompletion(
    threadId: string,
    turnId: string,
    receipt: CompletionReceipt,
  ): void {
    const key = completionKey(threadId, turnId);
    this.unmatchedCompletions.delete(key);
    this.unmatchedCompletions.set(key, receipt);
    while (this.unmatchedCompletions.size > MAX_UNMATCHED_COMPLETIONS) {
      const oldest = this.unmatchedCompletions.keys().next().value;
      if (typeof oldest !== "string") break;
      this.unmatchedCompletions.delete(oldest);
    }
  }

  private consumeCompletion(
    operationId: string,
    threadId: string,
    turnId: string,
  ): void {
    const key = completionKey(threadId, turnId);
    const receipt = this.unmatchedCompletions.get(key);
    if (!receipt) return;
    this.unmatchedCompletions.delete(key);
    this.update(operationId, receipt.state, {
      ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
    });
  }

  private trimOperations(targetSize = MAX_OPERATIONS): void {
    while (this.operations.size > targetSize) {
      const oldest = [...this.operations.entries()].find(([, operation]) =>
        TERMINAL_OPERATION_STATES.has(operation.state),
      )?.[0];
      if (!oldest) return;
      this.unsubscribeAll(oldest);
      this.operations.delete(oldest);
      this.subscriptions.delete(oldest);
      this.unsubscribeStarted.delete(oldest);
      this.clearWatchdog(oldest);
      this.reconciliationFailures.delete(oldest);
      for (const [key, value] of this.idempotency) {
        if (value.operationId === oldest) this.idempotency.delete(key);
      }
    }
  }

  private addSubscription(operationId: string, threadId: string): void {
    const subscriptions = this.subscriptions.get(operationId) ?? new Set();
    subscriptions.add(threadId);
    this.subscriptions.set(operationId, subscriptions);
  }

  private unsubscribeAll(operationId: string): void {
    const subscriptions = this.subscriptions.get(operationId);
    if (!subscriptions) return;
    const started = this.unsubscribeStarted.get(operationId) ?? new Set();
    this.unsubscribeStarted.set(operationId, started);
    for (const threadId of subscriptions) {
      if (started.has(threadId)) continue;
      started.add(threadId);
      void this.request("thread/unsubscribe", { threadId }).catch(
        () => undefined,
      );
    }
  }

  private armWatchdog(operationId: string): void {
    this.clearWatchdog(operationId);
    this.watchdogs.set(
      operationId,
      setTimeout(() => {
        this.watchdogs.delete(operationId);
        void this.reconcileOperation(operationId);
      }, OPERATION_RECONCILE_INTERVAL_MS),
    );
  }

  private async reconcileOperation(operationId: string): Promise<void> {
    const operation = this.operations.get(operationId);
    if (!operation || TERMINAL_OPERATION_STATES.has(operation.state)) return;
    const threadId = operation.reviewThreadId ?? operation.taskId;
    try {
      const response = record(
        await this.request("thread/read", { threadId, includeTurns: false }),
      );
      const thread = record(response?.thread);
      const status = record(thread?.status)?.type;
      if (safeId(thread?.id) !== threadId) {
        throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
      }
      this.reconciliationFailures.delete(operationId);
      if (status === "active") {
        this.update(operationId, "running");
        return;
      }
      if (status === "idle" && operation.turnId) {
        this.update(operationId, "unknown", {
          errorCode: "APP_SERVER_PROTOCOL_ERROR",
        });
        return;
      }
      if (status === "systemError") {
        this.update(operationId, "failed", { errorCode: "REQUEST_REJECTED" });
        return;
      }
      this.update(operationId, "unknown", {
        errorCode: "APP_SERVER_PROTOCOL_ERROR",
      });
    } catch {
      const failures = (this.reconciliationFailures.get(operationId) ?? 0) + 1;
      if (failures >= MAX_RECONCILIATION_FAILURES) {
        this.reconciliationFailures.delete(operationId);
        this.update(operationId, "unknown", {
          errorCode: "APP_SERVER_TIMEOUT",
        });
      } else {
        this.reconciliationFailures.set(operationId, failures);
        this.armWatchdog(operationId);
      }
    }
  }

  private clearWatchdog(operationId: string): void {
    const watchdog = this.watchdogs.get(operationId);
    if (watchdog) clearTimeout(watchdog);
    this.watchdogs.delete(operationId);
  }

  private captureServerRequest(
    serverRequestId: unknown,
    method: string,
    value: unknown,
  ): boolean {
    if (
      typeof serverRequestId !== "string" &&
      typeof serverRequestId !== "number"
    )
      return false;
    const params = record(value);
    const threadId = safeId(params?.threadId);
    const turnId = safeId(params?.turnId);
    if (!params || !threadId || !turnId) return false;
    const matches = [...this.operations.values()].filter((operation) => {
      if (TERMINAL_OPERATION_STATES.has(operation.state)) return false;
      const lifecycleThreadId = operation.reviewThreadId ?? operation.taskId;
      return lifecycleThreadId === threadId && operation.turnId === turnId;
    });
    if (matches.length !== 1) return false;
    const operation = matches[0];
    if (method === "item/permissions/requestApproval") {
      this.update(operation.id, "failed", {
        errorCode: "USER_ACTION_REQUIRED",
      });
      return false;
    }
    if (
      [...this.pendingServerRequests.values()].some(
        (pending) => pending.request.operationId === operation.id,
      )
    )
      return false;

    const projected = projectPendingServerRequest(
      method,
      params,
      operation,
      this.now().toISOString(),
    );
    if (!projected) return false;
    this.pendingServerRequests.set(projected.request.id, {
      ...projected,
      serverRequestId,
    });
    this.update(operation.id, "waiting");
    return true;
  }

  private rejectServerRequest(id: unknown): void {
    if (typeof id !== "string" && typeof id !== "number") return;
    void this.transport
      ?.write(
        JSON.stringify({
          id,
          error: { code: -32001, message: "User action required" },
        }),
      )
      .catch(() => undefined);
  }

  private clearPendingRequest(operationId: string): void {
    for (const [requestId, pending] of this.pendingServerRequests) {
      if (pending.request.operationId !== operationId) continue;
      this.pendingServerRequests.delete(requestId);
      this.rejectServerRequest(pending.serverRequestId);
    }
  }

  private resumeAfterUserResponse(operationId: string): void {
    const operation = this.operations.get(operationId);
    if (!operation || TERMINAL_OPERATION_STATES.has(operation.state)) return;
    this.operations.set(operationId, {
      ...operation,
      state: "running",
      updatedAt: this.now().toISOString(),
    });
    this.armWatchdog(operationId);
  }
}

function actionFingerprint(
  kind: CodexOperationKind,
  taskId: string,
  text = "",
): string {
  return createHash("sha256")
    .update(kind)
    .update("\0")
    .update(taskId)
    .update("\0")
    .update(text)
    .digest("hex");
}

function projectResponse(method: string, value: unknown): unknown {
  const response = record(value);
  if (method === "initialize") return {};
  if (method === "thread/goal/get") {
    const goal = record(response?.goal);
    if (response?.goal === null) return { available: true, goal: null };
    const threadId = safeId(goal?.threadId);
    const status = goal?.status;
    const rawUpdatedAt = goal?.updatedAt;
    if (
      !threadId ||
      (status !== "active" &&
        status !== "paused" &&
        status !== "blocked" &&
        status !== "usageLimited" &&
        status !== "budgetLimited" &&
        status !== "complete") ||
      typeof rawUpdatedAt !== "number" ||
      !Number.isFinite(rawUpdatedAt) ||
      rawUpdatedAt < 0
    ) {
      throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
    }
    const milliseconds =
      rawUpdatedAt >= 1_000_000_000_000 ? rawUpdatedAt : rawUpdatedAt * 1_000;
    const updatedAt = new Date(milliseconds);
    if (!Number.isFinite(updatedAt.getTime()))
      throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
    return {
      available: true,
      goal: { threadId, status, updatedAt: updatedAt.toISOString() },
    };
  }
  if (method === "thread/resume" || method === "thread/read") {
    const thread = record(response?.thread);
    if (!thread) throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
    const turns = thread.turns;
    if (turns !== undefined && (!Array.isArray(turns) || turns.length > 0)) {
      throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
    }
    const status = record(thread?.status);
    return {
      thread: {
        id: safeId(thread?.id),
        status: {
          type:
            status?.type === "idle" ||
            status?.type === "active" ||
            status?.type === "notLoaded" ||
            status?.type === "systemError"
              ? status.type
              : undefined,
        },
      },
    };
  }
  if (method === "turn/start")
    return { turn: { id: safeId(record(response?.turn)?.id) } };
  if (method === "review/start")
    return {
      turn: { id: safeId(record(response?.turn)?.id) },
      reviewThreadId: safeId(response?.reviewThreadId),
    };
  if (method === "thread/unsubscribe") return {};
  if (method === "thread/archive") {
    if (!response) throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
    return {};
  }
  if (method === "turn/interrupt") {
    if (!response) throw new CodexActionError("APP_SERVER_PROTOCOL_ERROR");
    return {};
  }
  return undefined;
}

declare global {
  var __cofficeCodexAppServer: CodexAppServerManager | undefined;
}

export function getCodexAppServerManager(): CodexAppServerManager {
  return (globalThis.__cofficeCodexAppServer ??= new CodexAppServerManager());
}
