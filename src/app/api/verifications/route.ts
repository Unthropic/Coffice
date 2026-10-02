import {
  getVerificationManager,
  VerificationManagerError,
  type VerificationManagerErrorCode,
  type VerificationRunRequest,
} from "../../../lib/verification-manager";
import {
  VERIFICATION_PROFILE_IDS,
  type VerificationProfileId,
} from "../../../lib/verification-execution";
import { assertLocalRequest } from "../../../lib/local-request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 16 * 1024;
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

class RequestBodyTooLargeError extends Error {}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function local(request: Request, requireOrigin: boolean): boolean {
  try {
    assertLocalRequest(request, requireOrigin);
    return true;
  } catch {
    return false;
  }
}

function exactKeys(
  source: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(source).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new TypeError("Unexpected request fields.");
  }
}

function structuralString(value: unknown, maximum = 320): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)
  ) {
    throw new TypeError("Invalid structural identifier.");
  }
  return value;
}

function safeId(value: unknown, maximum = 160): string {
  const result = structuralString(value, maximum);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)) {
    throw new TypeError("Invalid safe identifier.");
  }
  return result;
}

function profileId(value: unknown): VerificationProfileId {
  if (
    typeof value !== "string" ||
    !VERIFICATION_PROFILE_IDS.includes(value as VerificationProfileId)
  ) {
    throw new TypeError("Unknown verification profile.");
  }
  return value as VerificationProfileId;
}

function parseRun(source: Record<string, unknown>): VerificationRunRequest {
  exactKeys(source, [
    "action",
    "profileId",
    "profileVersion",
    "projectId",
    "objectiveId",
    "workItemId",
    "attemptId",
    "resultKey",
    "idempotencyKey",
    "confirmed",
    "confirmationToken",
  ]);
  if (
    source.confirmed !== true ||
    source.confirmationToken !== "CONFIRM_VERIFICATION"
  ) {
    throw new TypeError("Verification confirmation is required.");
  }
  if (
    !source.resultKey ||
    typeof source.resultKey !== "object" ||
    Array.isArray(source.resultKey)
  ) {
    throw new TypeError("Invalid result key.");
  }
  const resultKey = source.resultKey as Record<string, unknown>;
  exactKeys(resultKey, ["kind", "id"]);
  if (
    resultKey.kind !== "turn" &&
    resultKey.kind !== "operation" &&
    resultKey.kind !== "revision"
  ) {
    throw new TypeError("Invalid result key kind.");
  }
  return {
    profileId: profileId(source.profileId),
    profileVersion: safeId(source.profileVersion, 80),
    idempotencyKey: safeId(source.idempotencyKey),
    target: {
      projectId: structuralString(source.projectId, 160),
      objectiveId: structuralString(source.objectiveId, 160),
      workItemId: structuralString(source.workItemId, 160),
      attemptId: structuralString(source.attemptId, 160),
      resultKey: {
        kind: resultKey.kind,
        id: safeId(resultKey.id, 320),
      },
    },
  };
}

function parsePost(
  value: unknown,
):
  | { action: "run"; request: VerificationRunRequest }
  | { action: "cancel"; receiptId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected an object.");
  }
  const source = value as Record<string, unknown>;
  if (source.action === "run") {
    return { action: "run", request: parseRun(source) };
  }
  if (source.action === "cancel") {
    exactKeys(source, [
      "action",
      "receiptId",
      "confirmed",
      "confirmationToken",
    ]);
    if (
      source.confirmed !== true ||
      source.confirmationToken !== "CONFIRM_CANCEL_VERIFICATION"
    ) {
      throw new TypeError("Cancellation confirmation is required.");
    }
    return { action: "cancel", receiptId: safeId(source.receiptId) };
  }
  throw new TypeError("Unknown action.");
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError("Expected a request body.");
  const bytes = new Uint8Array(MAX_REQUEST_BYTES);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.byteLength > MAX_REQUEST_BYTES - length) {
      try {
        await reader.cancel();
      } catch {}
      throw new RequestBodyTooLargeError();
    }
    bytes.set(value, length);
    length += value.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
}

async function cancelBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {}
}

const ERROR_STATUS: Readonly<Record<VerificationManagerErrorCode, number>> = {
  INVALID_REQUEST: 400,
  IDEMPOTENCY_CONFLICT: 409,
  TARGET_NOT_FOUND: 409,
  TARGET_STALE: 409,
  PROJECT_UNAVAILABLE: 409,
  ROOT_BUSY: 409,
  RECEIPT_NOT_ACTIVE: 409,
  CAPACITY: 503,
  UNAVAILABLE: 503,
};

function managerError(error: VerificationManagerError): Response {
  const messages: Readonly<Record<VerificationManagerErrorCode, string>> = {
    INVALID_REQUEST: "The verification request is invalid.",
    IDEMPOTENCY_CONFLICT:
      "This request key was already used for a different verification.",
    TARGET_NOT_FOUND: "The selected result is no longer available.",
    TARGET_STALE: "A newer result is now available.",
    PROJECT_UNAVAILABLE: "The project is not available for verification.",
    ROOT_BUSY: "Another verification is already running for this project.",
    RECEIPT_NOT_ACTIVE: "This verification is no longer running.",
    CAPACITY: "Verification capacity is temporarily unavailable.",
    UNAVAILABLE: "Verification is temporarily unavailable.",
  };
  return json(
    { error: messages[error.code], code: error.code },
    ERROR_STATUS[error.code],
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!local(request, false)) {
    return json(
      {
        error: "Verification reads are local and same-origin only.",
        code: "FORBIDDEN",
      },
      403,
    );
  }
  const url = new URL(request.url);
  const unknown = [...url.searchParams.keys()].filter(
    (key) => key !== "projectId",
  );
  if (unknown.length > 0 || url.searchParams.getAll("projectId").length > 1) {
    return json(
      { error: "The verification query is invalid.", code: "INVALID_REQUEST" },
      400,
    );
  }
  let projectId: string | undefined;
  try {
    const raw = url.searchParams.get("projectId");
    projectId = raw === null ? undefined : structuralString(raw, 160);
  } catch {
    return json(
      { error: "The verification query is invalid.", code: "INVALID_REQUEST" },
      400,
    );
  }
  try {
    return json(await getVerificationManager().snapshot(projectId));
  } catch {
    return json(
      {
        error: "Verification is temporarily unavailable.",
        code: "UNAVAILABLE",
      },
      503,
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!local(request, true)) {
    await cancelBody(request);
    return json(
      {
        error: "Verification actions are local and same-origin only.",
        code: "FORBIDDEN",
      },
      403,
    );
  }
  if (
    request.headers
      .get("Content-Type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    await cancelBody(request);
    return json(
      {
        error: "Content-Type must be application/json.",
        code: "UNSUPPORTED_MEDIA_TYPE",
      },
      415,
    );
  }
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    await cancelBody(request);
    return json(
      {
        error: "Verification request is too large.",
        code: "PAYLOAD_TOO_LARGE",
      },
      413,
    );
  }

  let admitted: ReturnType<typeof parsePost>;
  try {
    admitted = parsePost(await readBoundedJson(request));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json(
        {
          error: "Verification request is too large.",
          code: "PAYLOAD_TOO_LARGE",
        },
        413,
      );
    }
    return json(
      {
        error: "The verification request is invalid.",
        code: "INVALID_REQUEST",
      },
      400,
    );
  }

  try {
    const manager = getVerificationManager();
    const result =
      admitted.action === "run"
        ? await manager.run(admitted.request)
        : await manager.cancel(admitted.receiptId);
    return json(result, 202);
  } catch (error) {
    if (error instanceof VerificationManagerError) return managerError(error);
    return json(
      {
        error: "Verification is temporarily unavailable.",
        code: "UNAVAILABLE",
      },
      503,
    );
  }
}
