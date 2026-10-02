import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  ActionRequestError,
  MAX_ACTION_BODY_BYTES,
  assertLocalRequest,
  isTaskAdmittedForAction,
  parseActionBody,
  readBoundedJson,
} from "../src/lib/codex-action-security";
import type { CofficeTask } from "../src/lib/domain";

function request(
  body: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://127.0.0.1:3003/api/codex-actions", {
    method: "POST",
    body,
    headers: {
      host: "127.0.0.1:3003",
      origin: "http://127.0.0.1:3003",
      "content-type": "application/json",
      ...headers,
    },
  });
}

describe("Codex action request boundary", () => {
  it("accepts only a loopback same-origin request", () => {
    expect(() => assertLocalRequest(request("{}"))).not.toThrow();
    expect(() =>
      assertLocalRequest(
        new NextRequest("http://127.0.0.1:3003/api/codex-actions"),
        false,
      ),
    ).toThrowError(ActionRequestError);
    expect(() =>
      assertLocalRequest(request("{}", { origin: "http://localhost:3003" })),
    ).toThrowError(ActionRequestError);
    expect(() =>
      assertLocalRequest(request("{}", { host: "example.com" })),
    ).toThrowError(ActionRequestError);
    expect(() =>
      assertLocalRequest(request("{}", { "sec-fetch-site": "cross-site" })),
    ).toThrowError(ActionRequestError);
    expect(() =>
      assertLocalRequest(request("{}", { origin: "" }), false),
    ).not.toThrow();
  });

  it("requires exact actions and explicit confirmations", () => {
    expect(
      parseActionBody({
        action: "send_follow_up",
        taskId: "thread-one",
        text: "continue",
        idempotencyKey: "key-one",
        confirmed: true,
        confirmationToken: "CONFIRM_SEND",
      }),
    ).toEqual({
      action: "send_follow_up",
      taskId: "thread-one",
      text: "continue",
      idempotencyKey: "key-one",
    });
    expect(() =>
      parseActionBody({
        action: "turn/interrupt",
        taskId: "thread-one",
        idempotencyKey: "key-two",
        confirmed: true,
      }),
    ).toThrowError(ActionRequestError);
    expect(
      parseActionBody({
        action: "cancel_operation",
        taskId: "thread-one",
        operationId: "operation-one",
        confirmed: true,
        confirmationToken: "CONFIRM_CANCEL_OPERATION",
      }),
    ).toEqual({
      action: "cancel_operation",
      taskId: "thread-one",
      operationId: "operation-one",
    });
    expect(() =>
      parseActionBody({
        action: "cancel_operation",
        taskId: "thread-one",
        operationId: "operation-one",
        confirmed: true,
        confirmationToken: "CONFIRM_CANCEL_OPERATION",
        turnId: "not-browser-controlled",
      }),
    ).toThrowError(ActionRequestError);
    expect(
      parseActionBody({
        action: "archive_task",
        taskId: "thread-one",
        idempotencyKey: "key-archive",
        confirmed: true,
        confirmationToken: "CONFIRM_ARCHIVE",
      }),
    ).toEqual({
      action: "archive_task",
      taskId: "thread-one",
      idempotencyKey: "key-archive",
    });
    expect(() =>
      parseActionBody({
        action: "archive_task",
        taskId: "thread-one",
        idempotencyKey: "key-archive",
        confirmed: true,
        confirmationToken: "CONFIRM_REVIEW",
      }),
    ).toThrowError(ActionRequestError);
    expect(() =>
      parseActionBody({
        action: "request_review",
        taskId: "thread-one",
        idempotencyKey: "key-four",
        confirmed: true,
        confirmationToken: "CONFIRM_REVIEW",
        instructions: "not allowed",
      }),
    ).toThrowError(ActionRequestError);
    expect(() =>
      parseActionBody({
        action: "request_review",
        taskId: "thread-one",
        idempotencyKey: "key-three",
        confirmed: true,
        confirmationToken: "wrong",
      }),
    ).toThrowError(ActionRequestError);
  });

  it("accepts only bounded explicitly confirmed callback responses", () => {
    expect(
      parseActionBody({
        action: "respond_approval",
        taskId: "thread-one",
        requestId: "request-one",
        decision: "decline",
        confirmed: true,
        confirmationToken: "CONFIRM_APPROVAL_RESPONSE",
      }),
    ).toEqual({
      action: "respond_approval",
      taskId: "thread-one",
      requestId: "request-one",
      decision: "decline",
    });
    expect(
      parseActionBody({
        action: "respond_clarification",
        taskId: "thread-one",
        requestId: "request-two",
        answers: { "question-local": ["Staging"] },
        confirmed: true,
        confirmationToken: "CONFIRM_CLARIFICATION_RESPONSE",
      }),
    ).toEqual({
      action: "respond_clarification",
      taskId: "thread-one",
      requestId: "request-two",
      answers: { "question-local": ["Staging"] },
    });
    expect(() =>
      parseActionBody({
        action: "respond_approval",
        taskId: "thread-one",
        requestId: "request-one",
        decision: "acceptForSession",
        confirmed: true,
        confirmationToken: "CONFIRM_APPROVAL_RESPONSE",
      }),
    ).toThrowError(ActionRequestError);
    expect(() =>
      parseActionBody({
        action: "respond_clarification",
        taskId: "thread-one",
        requestId: "request-two",
        answers: { "question-local": ["x".repeat(4_097)] },
        confirmed: true,
        confirmationToken: "CONFIRM_CLARIFICATION_RESPONSE",
      }),
    ).toThrowError(ActionRequestError);
  });

  it("bounds content type and body bytes before parsing", async () => {
    await expect(readBoundedJson(request('{"ok":true}'))).resolves.toEqual({
      ok: true,
    });
    await expect(
      readBoundedJson(request("{}", { "content-type": "text/plain" })),
    ).rejects.toMatchObject({ code: "CONTENT_TYPE_REQUIRED", status: 415 });
    await expect(
      readBoundedJson(request(`{"text":"${"x".repeat(65 * 1024)}"}`)),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE", status: 413 });
  });

  it("admits the worst-case JSON encoding of every bounded follow-up field", async () => {
    const encoded = JSON.stringify({
      action: "send_follow_up",
      taskId: "\ud800".repeat(128),
      text: "\ud800".repeat(8_000),
      idempotencyKey: "\ud800".repeat(128),
      confirmed: true,
      confirmationToken: "CONFIRM_SEND",
    });

    await expect(readBoundedJson(request(encoded))).resolves.toMatchObject({
      action: "send_follow_up",
      text: "\ud800".repeat(8_000),
    });
    expect(() => parseActionBody(JSON.parse(encoded))).not.toThrow();
    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThanOrEqual(
      MAX_ACTION_BODY_BYTES,
    );
  });

  it("preserves BODY_TOO_LARGE when stream cancellation rejects", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(65 * 1024));
      },
      cancel() {
        return Promise.reject(new Error("producer refused cancellation"));
      },
    });
    const oversized = new Request("http://127.0.0.1:3003/api/codex-actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedJson(oversized)).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
      status: 413,
    });
  });

  it.each(["send_follow_up", "request_review"] as const)(
    "admits settled snapshot targets for %s but not active or waiting work",
    (action) => {
      const task = (value: CofficeTask["status"]["value"]): CofficeTask => ({
        id: "thread-one",
        title: "Task",
        projectId: "project-one",
        assignmentEvidence: "explicit_project",
        kind: "temporary_worker",
        updatedAt: "2026-08-11T12:00:00.000Z",
        status: {
          value,
          provenance: "observed",
          source: "test",
          timestamp: "2026-08-11T12:00:00.000Z",
          stale: false,
        },
      });
      const snapshot = {
        source: {
          kind: "codex-local" as const,
          health: "connected" as const,
          lastReadAt: "2026-08-11T12:00:00.000Z",
          pollIntervalMs: 3_000,
          freshness: "fresh" as const,
          refreshState: "fresh" as const,
          cacheAgeMs: 0,
          lastRefreshSuccessAt: "2026-08-11T12:00:00.000Z",
        },
      };

      expect(isTaskAdmittedForAction(action, snapshot, task("idle"))).toBe(
        true,
      );
      expect(isTaskAdmittedForAction(action, snapshot, task("completed"))).toBe(
        true,
      );
      expect(isTaskAdmittedForAction(action, snapshot, task("failed"))).toBe(
        true,
      );
      expect(
        isTaskAdmittedForAction(action, snapshot, task("waiting_for_user")),
      ).toBe(false);
      expect(isTaskAdmittedForAction(action, snapshot, task("active"))).toBe(
        false,
      );
    },
  );

  it("admits archiving only for fresh completed or failed tasks", () => {
    const task = (value: CofficeTask["status"]["value"]): CofficeTask => ({
      id: "thread-one",
      title: "Task",
      projectId: "project-one",
      assignmentEvidence: "explicit_project",
      kind: "temporary_worker",
      updatedAt: "2026-08-11T12:00:00.000Z",
      status: {
        value,
        provenance: "observed",
        source: "test",
        timestamp: "2026-08-11T12:00:00.000Z",
        stale: false,
      },
    });
    const snapshot = {
      source: {
        kind: "codex-local" as const,
        health: "connected" as const,
        lastReadAt: "2026-08-11T12:00:00.000Z",
        pollIntervalMs: 3_000,
        freshness: "fresh" as const,
        refreshState: "fresh" as const,
        cacheAgeMs: 0,
        lastRefreshSuccessAt: "2026-08-11T12:00:00.000Z",
      },
    };

    expect(
      isTaskAdmittedForAction("archive_task", snapshot, task("idle")),
    ).toBe(false);
    expect(
      isTaskAdmittedForAction("archive_task", snapshot, task("completed")),
    ).toBe(true);
    expect(
      isTaskAdmittedForAction("archive_task", snapshot, task("failed")),
    ).toBe(true);
    expect(
      isTaskAdmittedForAction("archive_task", snapshot, {
        ...task("completed"),
        status: { ...task("completed").status, provenance: "inferred" },
      }),
    ).toBe(false);
  });
});
