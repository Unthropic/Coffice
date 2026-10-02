import { NextRequest, NextResponse } from "next/server";

import {
  ActionRequestError,
  admitTask,
  assertLocalRequest,
  parseActionBody,
  readBoundedJson,
} from "../../../lib/codex-action-security";
import {
  CodexActionError,
  getCodexAppServerManager,
} from "../../../lib/codex-app-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  try {
    assertLocalRequest(request, false);
    return NextResponse.json(
      {
        operations: getCodexAppServerManager().listOperations(),
        pendingRequests: getCodexAppServerManager().listPendingRequests(),
      },
      { headers: noStore },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertLocalRequest(request);
    const action = parseActionBody(await readBoundedJson(request));
    const manager = getCodexAppServerManager();
    if (action.action === "respond_approval") {
      const operation = await manager.respondToPendingRequest(
        action.requestId,
        action.taskId,
        { kind: "approval", decision: action.decision },
      );
      return NextResponse.json(
        { operation, pendingRequests: manager.listPendingRequests() },
        { status: 202, headers: noStore },
      );
    }
    if (action.action === "respond_clarification") {
      const answers = action.answers;
      const operation = await manager.respondToPendingRequest(
        action.requestId,
        action.taskId,
        { kind: "clarification", answers },
      );
      for (const key of Object.keys(answers)) answers[key] = [];
      return NextResponse.json(
        { operation, pendingRequests: manager.listPendingRequests() },
        { status: 202, headers: noStore },
      );
    }
    if (action.action === "cancel_operation") {
      const operation = await manager.cancelOperation(
        action.operationId,
        action.taskId,
      );
      return NextResponse.json(
        { operation },
        { status: 202, headers: noStore },
      );
    }
    const prior = manager.lookupIdempotentOperation(
      action.action,
      action.taskId,
      action.idempotencyKey,
      action.action === "send_follow_up" ? action.text : "",
    );
    const operation = prior ?? (await dispatchAction(action, manager));
    return NextResponse.json({ operation }, { status: 202, headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  const known =
    error instanceof ActionRequestError
      ? error
      : error instanceof CodexActionError
        ? new ActionRequestError(error.code, 409)
        : new ActionRequestError("ACTION_UNAVAILABLE", 503);
  return NextResponse.json(
    { error: "Codex action was not accepted.", code: known.code },
    { status: known.status, headers: noStore },
  );
}

async function dispatchAction(
  action: Exclude<
    ReturnType<typeof parseActionBody>,
    | { action: "cancel_operation" }
    | { action: "respond_approval" }
    | { action: "respond_clarification" }
  >,
  manager: ReturnType<typeof getCodexAppServerManager>,
) {
  await admitTask(action.action, action.taskId);
  if (action.action === "request_review")
    return await manager.requestReview(action.taskId, action.idempotencyKey);
  if (action.action === "archive_task")
    return await manager.archiveTask(action.taskId, action.idempotencyKey);

  const request = manager.sendFollowUp(
    action.taskId,
    action.text,
    action.idempotencyKey,
  );
  // The manager has taken its transient string argument; do not keep a second
  // copy in the route's parsed request while the App Server responds.
  action.text = "";
  return await request;
}
