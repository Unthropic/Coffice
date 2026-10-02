import type { CofficeSnapshot, CofficeTask } from "./domain";
import {
  assertLocalRequest as assertLocalBoundaryRequest,
  LocalRequestError,
} from "./local-request-security";
import { getCodexSnapshot } from "./snapshot";

// The strict action schema bounds follow-up text to 8,000 UTF-16 code units
// plus two 128-unit structural keys. JSON can encode one code unit as a
// six-byte escape, so keep the transport ceiling above that exact worst case
// while retaining a small, fixed denial-of-service boundary.
export const MAX_ACTION_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 8_000;
const MAX_KEY_LENGTH = 128;
const MAX_RESPONSE_QUESTIONS = 8;
const MAX_RESPONSE_VALUES = 16;
const MAX_RESPONSE_VALUE_LENGTH = 4_096;
const MAX_RESPONSE_TEXT_LENGTH = 24_000;
export { LocalRequestError as ActionRequestError };

/** Preserves the action API's stricter, explicit Host-header boundary. */
export function assertLocalRequest(
  request: Request,
  requireOrigin = true,
): void {
  if (!request.headers.get("host")) {
    throw new LocalRequestError("LOOPBACK_REQUIRED", 403);
  }
  assertLocalBoundaryRequest(request, requireOrigin);
}

export async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== "application/json")
    throw new LocalRequestError("CONTENT_TYPE_REQUIRED", 415);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ACTION_BODY_BYTES)
    throw new LocalRequestError("BODY_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new LocalRequestError("INVALID_BODY", 400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_ACTION_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the bounded-size verdict if the producer rejects cleanup.
      }
      throw new LocalRequestError("BODY_TOO_LARGE", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new LocalRequestError("INVALID_JSON", 400);
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : undefined;
}

export type ParsedAction =
  | {
      action: "send_follow_up";
      taskId: string;
      text: string;
      idempotencyKey: string;
    }
  | { action: "request_review"; taskId: string; idempotencyKey: string }
  | { action: "archive_task"; taskId: string; idempotencyKey: string }
  | { action: "cancel_operation"; taskId: string; operationId: string }
  | {
      action: "respond_approval";
      taskId: string;
      requestId: string;
      decision: "accept" | "decline" | "cancel";
    }
  | {
      action: "respond_clarification";
      taskId: string;
      requestId: string;
      answers: Record<string, string[]>;
    };

export function parseActionBody(value: unknown): ParsedAction {
  const body = object(value);
  const action = body?.action;
  const taskId = boundedString(body?.taskId, MAX_KEY_LENGTH);
  if (!body || !taskId || body.confirmed !== true)
    throw new LocalRequestError("INVALID_ACTION", 400);
  if (action === "respond_approval") {
    assertExactKeys(body, [
      "action",
      "taskId",
      "requestId",
      "decision",
      "confirmed",
      "confirmationToken",
    ]);
    const requestId = boundedString(body.requestId, MAX_KEY_LENGTH);
    const decision = body.decision;
    if (
      !requestId ||
      !["accept", "decline", "cancel"].includes(String(decision)) ||
      body.confirmationToken !== "CONFIRM_APPROVAL_RESPONSE"
    )
      throw new LocalRequestError("CONFIRMATION_REQUIRED", 400);
    return {
      action,
      taskId,
      requestId,
      decision: decision as "accept" | "decline" | "cancel",
    };
  }
  if (action === "respond_clarification") {
    assertExactKeys(body, [
      "action",
      "taskId",
      "requestId",
      "answers",
      "confirmed",
      "confirmationToken",
    ]);
    const requestId = boundedString(body.requestId, MAX_KEY_LENGTH);
    const rawAnswers = object(body.answers);
    if (
      !requestId ||
      !rawAnswers ||
      body.confirmationToken !== "CONFIRM_CLARIFICATION_RESPONSE" ||
      Object.keys(rawAnswers).length < 1 ||
      Object.keys(rawAnswers).length > MAX_RESPONSE_QUESTIONS
    )
      throw new LocalRequestError("CONFIRMATION_REQUIRED", 400);
    const answers: Record<string, string[]> = {};
    let total = 0;
    for (const [questionId, rawValues] of Object.entries(rawAnswers)) {
      if (
        !boundedString(questionId, MAX_KEY_LENGTH) ||
        !Array.isArray(rawValues) ||
        rawValues.length < 1 ||
        rawValues.length > MAX_RESPONSE_VALUES
      )
        throw new LocalRequestError("INVALID_ACTION", 400);
      const values = rawValues.map((rawValue) => {
        const value = boundedString(rawValue, MAX_RESPONSE_VALUE_LENGTH);
        if (!value) throw new LocalRequestError("INVALID_ACTION", 400);
        total += value.length;
        return value;
      });
      if (total > MAX_RESPONSE_TEXT_LENGTH)
        throw new LocalRequestError("BODY_TOO_LARGE", 413);
      answers[questionId] = values;
    }
    return { action, taskId, requestId, answers };
  }
  if (action === "cancel_operation") {
    assertExactKeys(body, [
      "action",
      "taskId",
      "operationId",
      "confirmed",
      "confirmationToken",
    ]);
    const operationId = boundedString(body.operationId, MAX_KEY_LENGTH);
    if (!operationId || body.confirmationToken !== "CONFIRM_CANCEL_OPERATION")
      throw new LocalRequestError("CONFIRMATION_REQUIRED", 400);
    return { action, taskId, operationId };
  }
  const idempotencyKey = boundedString(body.idempotencyKey, MAX_KEY_LENGTH);
  if (!idempotencyKey) throw new LocalRequestError("INVALID_ACTION", 400);
  if (action === "send_follow_up") {
    assertExactKeys(body, [
      "action",
      "taskId",
      "text",
      "idempotencyKey",
      "confirmed",
      "confirmationToken",
    ]);
    const text = boundedString(body.text, MAX_TEXT_LENGTH);
    if (!text || body.confirmationToken !== "CONFIRM_SEND")
      throw new LocalRequestError("CONFIRMATION_REQUIRED", 400);
    return { action, taskId, text, idempotencyKey };
  }
  if (action === "request_review") {
    assertExactKeys(body, [
      "action",
      "taskId",
      "idempotencyKey",
      "confirmed",
      "confirmationToken",
    ]);
    if (body.confirmationToken !== "CONFIRM_REVIEW")
      throw new LocalRequestError("CONFIRMATION_REQUIRED", 400);
    return { action, taskId, idempotencyKey };
  }
  if (action === "archive_task") {
    assertExactKeys(body, [
      "action",
      "taskId",
      "idempotencyKey",
      "confirmed",
      "confirmationToken",
    ]);
    if (body.confirmationToken !== "CONFIRM_ARCHIVE")
      throw new LocalRequestError("CONFIRMATION_REQUIRED", 400);
    return { action, taskId, idempotencyKey };
  }
  throw new LocalRequestError("ACTION_NOT_ALLOWED", 400);
}

function assertExactKeys(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(body).some((key) => !allowedSet.has(key)))
    throw new LocalRequestError("UNKNOWN_FIELD", 400);
}

export async function admitTask(
  action: ParsedAction["action"],
  taskId: string,
): Promise<CofficeTask> {
  const snapshot = await getCodexSnapshot();
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new LocalRequestError("TASK_NOT_ADMITTED", 404);
  if (!isTaskAdmittedForAction(action, snapshot, task)) {
    throw new LocalRequestError("TASK_NOT_IDLE", 409);
  }
  return task;
}

export function isTaskAdmittedForAction(
  action: ParsedAction["action"],
  snapshot: Pick<CofficeSnapshot, "source">,
  task: CofficeTask,
): boolean {
  const settled =
    snapshot.source.freshness === "fresh" &&
    !task.status.stale &&
    (task.status.value === "idle" ||
      task.status.value === "completed" ||
      task.status.value === "failed");
  if (!settled) return false;
  return (
    action !== "archive_task" ||
    (task.status.provenance === "observed" && task.status.value !== "idle")
  );
}
