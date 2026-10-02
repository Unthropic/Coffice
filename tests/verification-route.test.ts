import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  run: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("../src/lib/verification-manager", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/verification-manager")>();
  return {
    ...actual,
    getVerificationManager: () => mocks,
  };
});

import { VerificationManagerError } from "../src/lib/verification-manager";
import { GET, POST } from "../src/app/api/verifications/route";

function runBody() {
  return {
    action: "run",
    profileId: "test",
    profileVersion: "1",
    projectId: "project-a",
    objectiveId: "objective-a",
    workItemId: "work-a",
    attemptId: "attempt-a",
    resultKey: { kind: "turn", id: "result-a" },
    idempotencyKey: "request-a",
    confirmed: true,
    confirmationToken: "CONFIRM_VERIFICATION",
  };
}

function postRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://127.0.0.1:3003/api/verifications", {
    method: "POST",
    headers: {
      Host: "127.0.0.1:3003",
      Origin: "http://127.0.0.1:3003",
      "Content-Type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("verification API", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("returns a local no-store structural snapshot without requiring Origin", async () => {
    mocks.snapshot.mockResolvedValue({
      profiles: [
        {
          id: "test",
          version: "1",
          label: "Tests",
          description: "Run tests.",
          eligible: true,
        },
      ],
      receipts: [],
      operations: [],
    });

    const response = await GET(
      new Request(
        "http://127.0.0.1:3003/api/verifications?projectId=project-a",
        { headers: { Host: "127.0.0.1:3003" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(mocks.snapshot).toHaveBeenCalledWith("project-a");
  });

  it("admits one exact confirmed run without accepting execution policy", async () => {
    mocks.run.mockResolvedValue({
      receipt: { id: "receipt-a", state: "queued" },
      operation: { receiptId: "receipt-a", state: "running" },
      replayed: false,
    });

    const response = await POST(postRequest(runBody()));

    expect(response.status).toBe(202);
    expect(mocks.run).toHaveBeenCalledWith({
      profileId: "test",
      profileVersion: "1",
      idempotencyKey: "request-a",
      target: {
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
        resultKey: { kind: "turn", id: "result-a" },
      },
    });
    expect(JSON.stringify(mocks.run.mock.calls[0][0])).not.toMatch(
      /root|path|command|argv|env|sandbox|policy|stdout|stderr/i,
    );
  });

  it("requires an exact confirmed cancellation", async () => {
    mocks.cancel.mockResolvedValue({
      receipt: { id: "receipt-a", state: "unknown" },
      replayed: false,
    });

    const response = await POST(
      postRequest({
        action: "cancel",
        receiptId: "receipt-a",
        confirmed: true,
        confirmationToken: "CONFIRM_CANCEL_VERIFICATION",
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.cancel).toHaveBeenCalledWith("receipt-a");
  });

  it("requires the confirmation to name an exact profile version", async () => {
    const { profileVersion: omitted, ...missingVersion } = runBody();
    expect(omitted).toBe("1");

    expect((await POST(postRequest(missingVersion))).status).toBe(400);
    mocks.run.mockRejectedValueOnce(
      new VerificationManagerError("INVALID_REQUEST"),
    );
    const mismatch = await POST(
      postRequest({ ...runBody(), profileVersion: "2" }),
    );

    expect(mismatch.status).toBe(400);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: "test", profileVersion: "2" }),
    );
  });

  it.each([
    [{ Host: "evil.test", Origin: "http://127.0.0.1:3003" }, "host"],
    [{ Origin: "http://evil.test" }, "origin"],
    [{ Origin: "" }, "missing origin"],
    [{ "Sec-Fetch-Site": "cross-site" }, "fetch metadata"],
  ])(
    "rejects a POST outside the local browser boundary: %s",
    async (headers, _label) => {
      expect(_label).not.toBe("");
      const response = await POST(postRequest(runBody(), headers));

      expect(response.status).toBe(403);
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );

  it("rejects nonlocal reads and unexpected or repeated query fields", async () => {
    expect(
      (
        await GET(
          new Request("http://evil.test/api/verifications", {
            headers: { Host: "evil.test" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await GET(
          new Request("http://127.0.0.1:3003/api/verifications", {
            headers: { Origin: "http://evil.test" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await GET(
          new Request(
            "http://127.0.0.1:3003/api/verifications?projectId=a&projectId=b",
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          new Request("http://127.0.0.1:3003/api/verifications?root=private"),
        )
      ).status,
    ).toBe(400);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...runBody(), root: "C:\\PRIVATE" }, "root"],
    [{ ...runBody(), command: ["private.exe"] }, "command"],
    [{ ...runBody(), env: { TOKEN: "secret" } }, "environment"],
    [{ ...runBody(), sandboxPolicy: { networkAccess: true } }, "policy"],
    [
      {
        ...runBody(),
        resultKey: { kind: "turn", id: "result-a", path: "private" },
      },
      "nested injection",
    ],
    [{ ...runBody(), confirmed: false }, "confirmation"],
    [{ ...runBody(), confirmationToken: "YES" }, "token"],
    [{ ...runBody(), profileId: "custom" }, "custom profile"],
  ])(
    "rejects injected or inexact execution input: %s",
    async (body, _label) => {
      expect(_label).not.toBe("");
      const response = await POST(postRequest(body));

      expect(response.status).toBe(400);
      expect(mocks.run).not.toHaveBeenCalled();
      expect(await response.text()).not.toMatch(
        /PRIVATE|private\.exe|TOKEN|secret/,
      );
    },
  );

  it("bounds declared and streamed bodies and rejects non-JSON media", async () => {
    expect(
      (
        await POST(
          postRequest(runBody(), { "Content-Length": String(16 * 1024 + 1) }),
        )
      ).status,
    ).toBe(413);
    expect(
      (await POST(postRequest(runBody(), { "Content-Type": "text/plain" })))
        .status,
    ).toBe(415);

    let cancelled = false;
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(chunks++ === 0 ? 16 * 1024 : 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await POST(
      new Request("http://127.0.0.1:3003/api/verifications", {
        method: "POST",
        headers: {
          Host: "127.0.0.1:3003",
          Origin: "http://127.0.0.1:3003",
          "Content-Type": "application/json",
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    );

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("maps manager conflicts to safe structural errors", async () => {
    mocks.run.mockRejectedValue(
      new VerificationManagerError("IDEMPOTENCY_CONFLICT"),
    );

    const response = await POST(postRequest(runBody()));
    const serialized = await response.text();

    expect(response.status).toBe(409);
    expect(serialized).toContain("IDEMPOTENCY_CONFLICT");
    expect(serialized).not.toMatch(/root|path|command|argv|env|stdout|stderr/i);
  });

  it("never reflects malformed JSON or private thrown errors", async () => {
    const malformed = await POST(postRequest("{PRIVATE_PATH_SENTINEL"));
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain("PRIVATE_PATH_SENTINEL");

    mocks.run.mockRejectedValue(
      new Error("C:\\PRIVATE_PATH_SENTINEL output SECRET_OUTPUT_SENTINEL"),
    );
    const failed = await POST(postRequest(runBody()));
    const text = await failed.text();
    expect(failed.status).toBe(503);
    expect(text).not.toContain("PRIVATE_PATH_SENTINEL");
    expect(text).not.toContain("SECRET_OUTPUT_SENTINEL");
  });
});
