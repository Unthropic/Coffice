"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  CodexActionErrorCode,
  CodexOperation,
  CodexOperationKind,
  CodexOperationState,
  CodexPendingRequest,
} from "../lib/codex-app-server";

const POLL_INTERVAL_MS = 1_000;
const RECOVERY_POLL_INTERVAL_MS = 10_000;
const MAX_CONSECUTIVE_POLL_FAILURES = 5;
const MAX_RECOVERY_POLL_ATTEMPTS = 12;
const ACTIVE_STATES = new Set<CodexOperationState>([
  "queued",
  "connecting",
  "sent",
  "running",
  "waiting",
]);
const OPERATION_STATES = new Set<CodexOperationState>([
  ...ACTIVE_STATES,
  "completed",
  "failed",
  "interrupted",
  "unknown",
]);
const OPERATION_KINDS = new Set<CodexOperationKind>([
  "send_follow_up",
  "request_review",
  "archive_task",
]);
const ERROR_CODES = new Set<CodexActionErrorCode>([
  "APP_SERVER_UNAVAILABLE",
  "APP_SERVER_EXITED",
  "APP_SERVER_PROTOCOL_ERROR",
  "APP_SERVER_TIMEOUT",
  "APP_SERVER_BUSY",
  "TASK_NOT_IDLE",
  "USER_ACTION_REQUIRED",
  "REQUEST_REJECTED",
]);

export type CodexOperationNotice =
  "user_action_required" | "confirmation_lost" | null;

export interface CodexActionsController {
  operations: CodexOperation[];
  pendingRequests?: CodexPendingRequest[];
  available: boolean | null;
  error: string | null;
  submitFollowUp: (taskId: string, text: string) => Promise<CodexOperation>;
  requestReview: (taskId: string) => Promise<CodexOperation>;
  archiveTask?: (taskId: string) => Promise<CodexOperation>;
  cancelOperation?: (
    operationId: string,
    taskId: string,
  ) => Promise<CodexOperation | undefined>;
  respondToApproval?: (
    requestId: string,
    taskId: string,
    decision: "accept" | "decline" | "cancel",
  ) => Promise<CodexOperation | undefined>;
  respondToClarification?: (
    requestId: string,
    taskId: string,
    answers: Record<string, string[]>,
  ) => Promise<CodexOperation | undefined>;
  latestOperationFor: (
    taskId: string,
    kind?: CodexOperationKind,
  ) => CodexOperation | undefined;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function safeString(value: unknown, max = 160): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : undefined;
}

function decodeOperation(value: unknown): CodexOperation | undefined {
  const item = record(value);
  const id = safeString(item?.id);
  const taskId = safeString(item?.taskId);
  const kind = item?.kind;
  const state = item?.state;
  const createdAt = safeString(item?.createdAt, 40);
  const updatedAt = safeString(item?.updatedAt, 40);
  if (
    !id ||
    !taskId ||
    !createdAt ||
    !updatedAt ||
    !OPERATION_KINDS.has(kind as CodexOperationKind) ||
    !OPERATION_STATES.has(state as CodexOperationState)
  )
    return undefined;
  const turnId = safeString(item?.turnId);
  const reviewThreadId = safeString(item?.reviewThreadId);
  const cancelRequestedAt = safeString(item?.cancelRequestedAt, 40);
  const errorCode = ERROR_CODES.has(item?.errorCode as CodexActionErrorCode)
    ? (item?.errorCode as CodexActionErrorCode)
    : undefined;
  return {
    id,
    taskId,
    kind: kind as CodexOperationKind,
    state: state as CodexOperationState,
    createdAt,
    updatedAt,
    ...(turnId ? { turnId } : {}),
    ...(reviewThreadId ? { reviewThreadId } : {}),
    ...(cancelRequestedAt ? { cancelRequestedAt } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

function decodeOperations(value: unknown): CodexOperation[] | undefined {
  const values = record(value)?.operations;
  if (!Array.isArray(values) || values.length > 128) return undefined;
  const operations = values.map(decodeOperation);
  return operations.every(Boolean)
    ? (operations as CodexOperation[])
    : undefined;
}

function decodePendingRequest(value: unknown): CodexPendingRequest | undefined {
  const item = record(value);
  const id = safeString(item?.id);
  const operationId = safeString(item?.operationId);
  const taskId = safeString(item?.taskId);
  const receivedAt = safeString(item?.receivedAt, 40);
  if (!item || !id || !operationId || !taskId || !receivedAt) return undefined;
  const optionalText = (value: unknown, max = 16_000) =>
    value === undefined ? undefined : safeString(value, max);
  if (item.kind === "command_approval") {
    const command = optionalText(item.command);
    const cwd = optionalText(item.cwd, 4_096);
    const reason = optionalText(item.reason, 4_096);
    const environmentId = optionalText(item.environmentId, 160);
    if (
      (item.command !== undefined && !command) ||
      (item.cwd !== undefined && !cwd) ||
      (item.reason !== undefined && !reason) ||
      (item.environmentId !== undefined && !environmentId) ||
      typeof item.allowOnce !== "boolean" ||
      typeof item.canDecline !== "boolean" ||
      typeof item.canCancel !== "boolean" ||
      typeof item.requiresCodexReview !== "boolean"
    )
      return undefined;
    const networkRecord = record(item.network);
    const host = optionalText(networkRecord?.host, 253);
    const protocol = optionalText(networkRecord?.protocol, 32);
    if (item.network !== undefined && (!networkRecord || !host || !protocol))
      return undefined;
    return {
      id,
      operationId,
      taskId,
      receivedAt,
      kind: "command_approval",
      ...(command ? { command } : {}),
      ...(cwd ? { cwd } : {}),
      ...(reason ? { reason } : {}),
      ...(environmentId ? { environmentId } : {}),
      ...(host && protocol ? { network: { host, protocol } } : {}),
      allowOnce: item.allowOnce,
      canDecline: item.canDecline,
      canCancel: item.canCancel,
      requiresCodexReview: item.requiresCodexReview,
    };
  }
  if (item.kind === "file_change_approval") {
    const grantRoot = optionalText(item.grantRoot, 4_096);
    const reason = optionalText(item.reason, 4_096);
    if (
      (item.grantRoot !== undefined && !grantRoot) ||
      (item.reason !== undefined && !reason) ||
      typeof item.canDecline !== "boolean" ||
      typeof item.canCancel !== "boolean"
    )
      return undefined;
    return {
      id,
      operationId,
      taskId,
      receivedAt,
      kind: "file_change_approval",
      ...(grantRoot ? { grantRoot } : {}),
      ...(reason ? { reason } : {}),
      canDecline: item.canDecline,
      canCancel: item.canCancel,
    };
  }
  if (
    item.kind !== "clarification" ||
    !Array.isArray(item.questions) ||
    item.questions.length < 1 ||
    item.questions.length > 8
  )
    return undefined;
  const questions = item.questions.map((rawQuestion) => {
    const question = record(rawQuestion);
    const questionId = safeString(question?.id);
    const header = safeString(question?.header, 160);
    const prompt = safeString(question?.question, 4_096);
    if (
      !question ||
      !questionId ||
      !header ||
      !prompt ||
      typeof question.isSecret !== "boolean" ||
      typeof question.allowOther !== "boolean" ||
      !Array.isArray(question.options) ||
      question.options.length > 16
    )
      return undefined;
    const options = question.options.map((rawOption) => {
      const option = record(rawOption);
      const label = safeString(option?.label, 500);
      const description = safeString(option?.description, 2_000);
      return option && label && description
        ? { label, description }
        : undefined;
    });
    return options.every(Boolean)
      ? {
          id: questionId,
          header,
          question: prompt,
          isSecret: question.isSecret,
          allowOther: question.allowOther,
          options: options as Array<{ label: string; description: string }>,
        }
      : undefined;
  });
  const autoResolutionMs = item.autoResolutionMs;
  if (
    !questions.every(Boolean) ||
    (autoResolutionMs !== undefined &&
      (typeof autoResolutionMs !== "number" ||
        !Number.isSafeInteger(autoResolutionMs) ||
        autoResolutionMs <= 0))
  )
    return undefined;
  return {
    id,
    operationId,
    taskId,
    receivedAt,
    kind: "clarification",
    ...(typeof autoResolutionMs === "number" ? { autoResolutionMs } : {}),
    questions: questions as Extract<
      CodexPendingRequest,
      { kind: "clarification" }
    >["questions"],
  };
}

function decodePendingRequests(
  value: unknown,
): CodexPendingRequest[] | undefined {
  const values = record(value)?.pendingRequests;
  // Older local route responses did not include this collection. Treat the
  // absent field as the empty state while still rejecting malformed values.
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 16) return undefined;
  const requests = values.map(decodePendingRequest);
  return requests.every(Boolean)
    ? (requests as CodexPendingRequest[])
    : undefined;
}

function operationKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function mergeOperation(
  operations: readonly CodexOperation[],
  operation: CodexOperation,
): CodexOperation[] {
  const next = operations.filter((item) => item.id !== operation.id);
  next.push(operation);
  return next.slice(-128);
}

function reconcileOperationLists(
  current: readonly CodexOperation[],
  remote: readonly CodexOperation[],
): CodexOperation[] {
  const remoteIds = new Set(remote.map((operation) => operation.id));
  let next = [...remote];
  for (const operation of current) {
    if (remoteIds.has(operation.id)) continue;
    const matchingRemote = remote.some(
      (candidate) =>
        candidate.taskId === operation.taskId &&
        candidate.kind === operation.kind,
    );
    if (operation.id.startsWith("client-") && matchingRemote) continue;
    next = mergeOperation(
      next,
      ACTIVE_STATES.has(operation.state)
        ? {
            ...operation,
            state: "unknown",
            updatedAt: timestamp(),
            errorCode: "APP_SERVER_EXITED",
          }
        : operation,
    );
  }
  return next;
}

export function codexOperationNotice(
  operation: CodexOperation | undefined,
): CodexOperationNotice {
  if (operation?.state === "waiting") return "user_action_required";
  if (
    operation?.state === "failed" &&
    operation.errorCode === "USER_ACTION_REQUIRED"
  )
    return "user_action_required";
  if (operation?.state === "unknown") return "confirmation_lost";
  return null;
}

export function useCodexActions(): CodexActionsController {
  const [operations, setOperations] = useState<CodexOperation[]>([]);
  const [pendingRequests, setPendingRequests] = useState<CodexPendingRequest[]>(
    [],
  );
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryPolling, setRecoveryPolling] = useState(false);
  const mounted = useRef(true);
  const operationsRef = useRef<CodexOperation[]>([]);
  const localSubmissionVersion = useRef(0);
  const consecutivePollFailures = useRef(0);
  const recoveryPollAttempts = useRef(0);

  const updateOperations = useCallback(
    (update: (current: CodexOperation[]) => CodexOperation[]) => {
      setOperations((current) => {
        const next = update(current);
        operationsRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<
    "active" | "recovering" | "settled"
  > => {
    const submissionVersion = localSubmissionVersion.current;
    const markUnavailable = () => {
      if (!mounted.current) return "settled" as const;
      consecutivePollFailures.current += 1;
      const exhausted =
        consecutivePollFailures.current >= MAX_CONSECUTIVE_POLL_FAILURES;
      const hadActive = operationsRef.current.some((operation) =>
        ACTIVE_STATES.has(operation.state),
      );
      if (exhausted && hadActive) {
        updateOperations((current) =>
          current.map((operation) =>
            ACTIVE_STATES.has(operation.state)
              ? {
                  ...operation,
                  state: "unknown",
                  updatedAt: timestamp(),
                  errorCode: "APP_SERVER_UNAVAILABLE",
                }
              : operation,
          ),
        );
      }
      const recovering = !hadActive || exhausted;
      if (recovering) {
        recoveryPollAttempts.current += 1;
        setRecoveryPolling(
          recoveryPollAttempts.current < MAX_RECOVERY_POLL_ATTEMPTS,
        );
      }
      setAvailable(false);
      setError(
        exhausted
          ? "Action status confirmation was lost. Check the task before retrying."
          : "Codex actions are unavailable.",
      );
      if (!recovering) return "active" as const;
      return recoveryPollAttempts.current < MAX_RECOVERY_POLL_ATTEMPTS
        ? ("recovering" as const)
        : ("settled" as const);
    };
    try {
      const response = await fetch("/api/codex-actions", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload: unknown = await response.json().catch(() => null);
      const decoded = response.ok ? decodeOperations(payload) : undefined;
      const decodedPending = response.ok
        ? decodePendingRequests(payload)
        : undefined;
      if (!mounted.current) return "settled";
      if (!decoded || !decodedPending) {
        return markUnavailable();
      }
      consecutivePollFailures.current = 0;
      recoveryPollAttempts.current = 0;
      setRecoveryPolling(false);
      // A GET started before a local POST may not include that new operation.
      // Keep the newer local state; the active-operation poll will fetch the
      // authoritative list again without ever replaying the POST.
      if (submissionVersion === localSubmissionVersion.current) {
        updateOperations((current) =>
          reconcileOperationLists(current, decoded),
        );
        setPendingRequests(decodedPending);
      }
      setAvailable(true);
      setError(null);
      return submissionVersion !== localSubmissionVersion.current ||
        decoded.some((operation) => ACTIVE_STATES.has(operation.state))
        ? "active"
        : "settled";
    } catch {
      return markUnavailable();
    }
  }, [updateOperations]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  const shouldPoll = operations.some((operation) =>
    ACTIVE_STATES.has(operation.state),
  );

  useEffect(() => {
    if (!shouldPoll && !recoveryPolling) return;
    let cancelled = false;
    let timeout: number | undefined;
    const poll = async () => {
      const mode = await refresh();
      if (!cancelled && mode !== "settled") {
        const delay =
          mode === "recovering" ? RECOVERY_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
        timeout = window.setTimeout(poll, delay);
      }
    };
    timeout = window.setTimeout(
      poll,
      recoveryPolling ? RECOVERY_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [recoveryPolling, refresh, shouldPoll]);

  const submit = useCallback(
    async (
      kind: CodexOperationKind,
      taskId: string,
      instruction?: string,
    ): Promise<CodexOperation> => {
      const idempotencyKey = operationKey();
      const now = timestamp();
      const pending: CodexOperation = {
        id: `client-${idempotencyKey}`,
        kind,
        taskId,
        state: "queued",
        createdAt: now,
        updatedAt: now,
      };
      localSubmissionVersion.current += 1;
      updateOperations((current) => mergeOperation(current, pending));
      setError(null);

      let body = JSON.stringify(
        kind === "send_follow_up"
          ? {
              action: kind,
              taskId,
              text: instruction,
              idempotencyKey,
              confirmed: true,
              confirmationToken: "CONFIRM_SEND",
            }
          : kind === "request_review"
            ? {
                action: kind,
                taskId,
                idempotencyKey,
                confirmed: true,
                confirmationToken: "CONFIRM_REVIEW",
              }
            : {
                action: kind,
                taskId,
                idempotencyKey,
                confirmed: true,
                confirmationToken: "CONFIRM_ARCHIVE",
              },
      );

      try {
        const request = fetch("/api/codex-actions", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body,
        });
        body = "";
        instruction = undefined;
        const response = await request;
        const payload: unknown = await response.json().catch(() => null);
        const operation = decodeOperation(record(payload)?.operation);
        if (response.status !== 202 || !operation) {
          const failed: CodexOperation = {
            ...pending,
            state: "failed",
            updatedAt: timestamp(),
            errorCode: "REQUEST_REJECTED",
          };
          if (mounted.current) {
            updateOperations((current) => mergeOperation(current, failed));
            setAvailable(response.status !== 503);
            setError("Codex did not accept this action.");
          }
          return failed;
        }
        if (mounted.current) {
          updateOperations((current) =>
            mergeOperation(
              current.filter((item) => item.id !== pending.id),
              operation,
            ),
          );
          setAvailable(true);
          setError(null);
        }
        return operation;
      } catch {
        body = "";
        instruction = undefined;
        const unknown: CodexOperation = {
          ...pending,
          state: "unknown",
          updatedAt: timestamp(),
          errorCode: "APP_SERVER_UNAVAILABLE",
        };
        if (mounted.current) {
          updateOperations((current) => mergeOperation(current, unknown));
          recoveryPollAttempts.current = 0;
          setRecoveryPolling(true);
          setAvailable(false);
          setError(
            "Action confirmation was lost. Check the task before retrying.",
          );
        }
        return unknown;
      }
    },
    [updateOperations],
  );

  const submitFollowUp = useCallback(
    (taskId: string, text: string) => submit("send_follow_up", taskId, text),
    [submit],
  );
  const requestReview = useCallback(
    (taskId: string) => submit("request_review", taskId),
    [submit],
  );
  const archiveTask = useCallback(
    (taskId: string) => submit("archive_task", taskId),
    [submit],
  );
  const cancelOperation = useCallback(
    async (
      operationId: string,
      taskId: string,
    ): Promise<CodexOperation | undefined> => {
      const current = operationsRef.current.find(
        (operation) =>
          operation.id === operationId && operation.taskId === taskId,
      );
      if (!current || !ACTIVE_STATES.has(current.state) || !current.turnId)
        return undefined;
      if (current.cancelRequestedAt) return current;
      localSubmissionVersion.current += 1;
      setError(null);
      let body = JSON.stringify({
        action: "cancel_operation",
        taskId,
        operationId,
        confirmed: true,
        confirmationToken: "CONFIRM_CANCEL_OPERATION",
      });
      try {
        const response = await fetch("/api/codex-actions", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body,
        });
        body = "";
        const payload: unknown = await response.json().catch(() => null);
        const operation = decodeOperation(record(payload)?.operation);
        if (response.status !== 202) {
          if (mounted.current) {
            setAvailable(response.status !== 503);
            setError("Codex did not accept the stop request.");
          }
          return undefined;
        }
        if (
          !operation ||
          operation.id !== operationId ||
          operation.taskId !== taskId
        )
          throw new Error("Mismatched stop receipt");
        if (mounted.current) {
          updateOperations((operations) =>
            mergeOperation(operations, operation),
          );
          setAvailable(true);
          setError(null);
        }
        return operation;
      } catch {
        body = "";
        const unknown: CodexOperation = {
          ...current,
          state: "unknown",
          updatedAt: timestamp(),
          errorCode: "APP_SERVER_UNAVAILABLE",
        };
        if (mounted.current) {
          updateOperations((operations) => mergeOperation(operations, unknown));
          recoveryPollAttempts.current = 0;
          setRecoveryPolling(true);
          setAvailable(false);
          setError(
            "Stop confirmation was lost. Check the task before taking another action.",
          );
        }
        return unknown;
      }
    },
    [updateOperations],
  );
  const respondToPending = useCallback(
    async (
      requestId: string,
      taskId: string,
      response:
        | { kind: "approval"; decision: "accept" | "decline" | "cancel" }
        | { kind: "clarification"; answers: Record<string, string[]> },
    ): Promise<CodexOperation | undefined> => {
      const pending = pendingRequests.find(
        (request) => request.id === requestId && request.taskId === taskId,
      );
      if (!pending) return undefined;
      localSubmissionVersion.current += 1;
      let body = JSON.stringify(
        response.kind === "approval"
          ? {
              action: "respond_approval",
              taskId,
              requestId,
              decision: response.decision,
              confirmed: true,
              confirmationToken: "CONFIRM_APPROVAL_RESPONSE",
            }
          : {
              action: "respond_clarification",
              taskId,
              requestId,
              answers: response.answers,
              confirmed: true,
              confirmationToken: "CONFIRM_CLARIFICATION_RESPONSE",
            },
      );
      if (response.kind === "clarification") {
        for (const key of Object.keys(response.answers))
          response.answers[key] = [];
      }
      try {
        const request = fetch("/api/codex-actions", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body,
        });
        body = "";
        const networkResponse = await request;
        const payload: unknown = await networkResponse.json().catch(() => null);
        const operation = decodeOperation(record(payload)?.operation);
        const nextPending = decodePendingRequests(payload);
        if (
          networkResponse.status !== 202 ||
          !operation ||
          operation.taskId !== taskId ||
          !nextPending
        )
          throw new Error("Unconfirmed callback response");
        if (mounted.current) {
          updateOperations((current) => mergeOperation(current, operation));
          setPendingRequests(nextPending);
          setAvailable(true);
          setError(null);
        }
        return operation;
      } catch {
        body = "";
        const current = operationsRef.current.find(
          (operation) => operation.id === pending.operationId,
        );
        if (current && mounted.current) {
          const unknown: CodexOperation = {
            ...current,
            state: "unknown",
            updatedAt: timestamp(),
            errorCode: "APP_SERVER_UNAVAILABLE",
          };
          updateOperations((operations) => mergeOperation(operations, unknown));
          setPendingRequests((requests) =>
            requests.filter((request) => request.id !== requestId),
          );
          setAvailable(false);
          setError(
            "Response confirmation was lost. Check the task before responding again.",
          );
          return unknown;
        }
        return undefined;
      }
    },
    [pendingRequests, updateOperations],
  );
  const respondToApproval = useCallback(
    (
      requestId: string,
      taskId: string,
      decision: "accept" | "decline" | "cancel",
    ) => respondToPending(requestId, taskId, { kind: "approval", decision }),
    [respondToPending],
  );
  const respondToClarification = useCallback(
    (requestId: string, taskId: string, answers: Record<string, string[]>) =>
      respondToPending(requestId, taskId, { kind: "clarification", answers }),
    [respondToPending],
  );
  const latestOperationFor = useCallback(
    (taskId: string, kind?: CodexOperationKind) =>
      [...operations]
        .reverse()
        .find(
          (operation) =>
            operation.taskId === taskId && (!kind || operation.kind === kind),
        ),
    [operations],
  );

  return useMemo(
    () => ({
      operations,
      pendingRequests,
      available,
      error,
      submitFollowUp,
      requestReview,
      archiveTask,
      cancelOperation,
      respondToApproval,
      respondToClarification,
      latestOperationFor,
    }),
    [
      available,
      error,
      latestOperationFor,
      operations,
      pendingRequests,
      requestReview,
      archiveTask,
      cancelOperation,
      respondToApproval,
      respondToClarification,
      submitFollowUp,
    ],
  );
}
