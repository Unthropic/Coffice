import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodexOperation } from "../src/lib/codex-app-server";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  sendFollowUp: vi.fn(),
  requestReview: vi.fn(),
  archiveTask: vi.fn(),
  cancelOperation: vi.fn(),
  listOperations: vi.fn(),
  listPendingRequests: vi.fn(),
  respondToPendingRequest: vi.fn(),
  admitTask: vi.fn(),
}));

vi.mock("../src/lib/codex-app-server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/codex-app-server")>();
  return {
    ...actual,
    getCodexAppServerManager: () => ({
      lookupIdempotentOperation: mocks.lookup,
      sendFollowUp: mocks.sendFollowUp,
      requestReview: mocks.requestReview,
      archiveTask: mocks.archiveTask,
      cancelOperation: mocks.cancelOperation,
      listOperations: mocks.listOperations,
      listPendingRequests: mocks.listPendingRequests,
      respondToPendingRequest: mocks.respondToPendingRequest,
    }),
  };
});

vi.mock("../src/lib/codex-action-security", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/codex-action-security")>();
  return { ...actual, admitTask: mocks.admitTask };
});

import { CodexActionError } from "../src/lib/codex-app-server";
import { GET, POST } from "../src/app/api/codex-actions/route";

const prior: CodexOperation = {
  id: "operation-one",
  kind: "send_follow_up",
  taskId: "thread-one",
  state: "completed",
  createdAt: "2026-08-11T12:00:00.000Z",
  updatedAt: "2026-08-11T12:01:00.000Z",
};

function request(body: unknown) {
  return new NextRequest("http://127.0.0.1:3003/api/codex-actions", {
    method: "POST",
    headers: {
      Host: "127.0.0.1:3003",
      Origin: "http://127.0.0.1:3003",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function followUp() {
  return {
    action: "send_follow_up",
    taskId: "thread-one",
    text: "continue",
    idempotencyKey: "same-request",
    confirmed: true,
    confirmationToken: "CONFIRM_SEND",
  };
}

describe("Codex actions route", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.listOperations.mockReturnValue([]);
    mocks.listPendingRequests.mockReturnValue([]);
  });

  it("returns structural operations and transient pending requests without caching", async () => {
    const pending = {
      id: "request-one",
      operationId: "operation-one",
      taskId: "thread-one",
      receivedAt: "2026-08-19T10:00:00.000Z",
      kind: "command_approval",
      command: "npm test",
      allowOnce: true,
      canDecline: true,
      canCancel: true,
      requiresCodexReview: false,
    };
    mocks.listOperations.mockReturnValue([prior]);
    mocks.listPendingRequests.mockReturnValue([pending]);

    const response = await GET(
      new NextRequest("http://127.0.0.1:3003/api/codex-actions", {
        headers: { Host: "127.0.0.1:3003" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      operations: [prior],
      pendingRequests: [pending],
    });
  });

  it("returns an exact idempotent receipt before mutable snapshot admission", async () => {
    mocks.lookup.mockReturnValue(prior);
    mocks.admitTask.mockRejectedValue(new Error("task is no longer idle"));

    const response = await POST(request(followUp()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ operation: prior });
    expect(mocks.lookup).toHaveBeenCalledWith(
      "send_follow_up",
      "thread-one",
      "same-request",
      "continue",
    );
    expect(mocks.admitTask).not.toHaveBeenCalled();
    expect(mocks.sendFollowUp).not.toHaveBeenCalled();
  });

  it("rejects mismatched idempotency reuse before admission", async () => {
    mocks.lookup.mockImplementation(() => {
      throw new CodexActionError("REQUEST_REJECTED");
    });

    const response = await POST(request(followUp()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_REJECTED",
    });
    expect(mocks.admitTask).not.toHaveBeenCalled();
    expect(mocks.sendFollowUp).not.toHaveBeenCalled();
  });

  it("admits and dispatches a new exact request once", async () => {
    mocks.lookup.mockReturnValue(undefined);
    mocks.admitTask.mockResolvedValue({ id: "thread-one" });
    mocks.sendFollowUp.mockResolvedValue({ ...prior, state: "running" });

    const response = await POST(request(followUp()));

    expect(response.status).toBe(202);
    expect(mocks.admitTask).toHaveBeenCalledWith(
      "send_follow_up",
      "thread-one",
    );
    expect(mocks.sendFollowUp).toHaveBeenCalledWith(
      "thread-one",
      "continue",
      "same-request",
    );
  });

  it("admits and dispatches one confirmed archive request", async () => {
    const archived: CodexOperation = {
      ...prior,
      id: "archive-operation",
      kind: "archive_task",
    };
    mocks.lookup.mockReturnValue(undefined);
    mocks.admitTask.mockResolvedValue({ id: "thread-one" });
    mocks.archiveTask.mockResolvedValue(archived);

    const response = await POST(
      request({
        action: "archive_task",
        taskId: "thread-one",
        idempotencyKey: "archive-request",
        confirmed: true,
        confirmationToken: "CONFIRM_ARCHIVE",
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.admitTask).toHaveBeenCalledWith("archive_task", "thread-one");
    expect(mocks.archiveTask).toHaveBeenCalledWith(
      "thread-one",
      "archive-request",
    );
  });

  it("cancels only the exact manager-owned operation without snapshot admission", async () => {
    const cancelling: CodexOperation = {
      ...prior,
      state: "running",
      cancelRequestedAt: "2026-08-11T12:00:30.000Z",
    };
    mocks.cancelOperation.mockResolvedValue(cancelling);

    const response = await POST(
      request({
        action: "cancel_operation",
        taskId: "thread-one",
        operationId: "operation-one",
        confirmed: true,
        confirmationToken: "CONFIRM_CANCEL_OPERATION",
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ operation: cancelling });
    expect(mocks.cancelOperation).toHaveBeenCalledWith(
      "operation-one",
      "thread-one",
    );
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.admitTask).not.toHaveBeenCalled();
  });

  it("routes an exact one-time approval response without snapshot admission", async () => {
    const running = { ...prior, state: "running" as const };
    mocks.respondToPendingRequest.mockResolvedValue(running);

    const response = await POST(
      request({
        action: "respond_approval",
        taskId: "thread-one",
        requestId: "request-one",
        decision: "accept",
        confirmed: true,
        confirmationToken: "CONFIRM_APPROVAL_RESPONSE",
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      operation: running,
      pendingRequests: [],
    });
    expect(mocks.respondToPendingRequest).toHaveBeenCalledWith(
      "request-one",
      "thread-one",
      { kind: "approval", decision: "accept" },
    );
    expect(mocks.admitTask).not.toHaveBeenCalled();
  });

  it("routes clarification answers through their local question tokens", async () => {
    const running = { ...prior, state: "running" as const };
    let receivedResponse: unknown;
    mocks.respondToPendingRequest.mockImplementation(
      async (_requestId, _taskId, response) => {
        receivedResponse = structuredClone(response);
        return running;
      },
    );

    const response = await POST(
      request({
        action: "respond_clarification",
        taskId: "thread-one",
        requestId: "request-two",
        answers: { "local-question": ["Staging"] },
        confirmed: true,
        confirmationToken: "CONFIRM_CLARIFICATION_RESPONSE",
      }),
    );

    expect(response.status).toBe(202);
    expect(receivedResponse).toEqual({
      kind: "clarification",
      answers: { "local-question": ["Staging"] },
    });
    expect(mocks.respondToPendingRequest).toHaveBeenCalledWith(
      "request-two",
      "thread-one",
      expect.any(Object),
    );
  });
});
