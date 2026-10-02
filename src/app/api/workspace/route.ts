import {
  CofficeWorkspaceValidationError,
  MAX_COFFICE_WORKSPACE_MUTATION_BYTES,
  parseWorkspaceMutation,
} from "../../../lib/coffice-workspace";
import {
  CofficeWorkspaceConflictError,
  CofficeWorkspaceMutationIdError,
  CofficeWorkspaceStore,
  type LoadedCofficeWorkspace,
} from "../../../lib/coffice-workspace-store";
import { assertLocalRequest } from "../../../lib/local-request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A valid import or whole-object upsert may legitimately approach the durable
// workspace bound. Keep a small allowance for the revision/id envelope while
// letting the model parser enforce its more specific nested limits.
const MAX_REQUEST_BYTES = MAX_COFFICE_WORKSPACE_MUTATION_BYTES;
const store = new CofficeWorkspaceStore();
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function success(loaded: LoadedCofficeWorkspace) {
  return {
    ...loaded,
    persistence: { kind: "local", persistent: true as const },
  };
}

function unavailable() {
  return json(
    {
      error: "Coffice workspace is unavailable.",
      code: "COFFICE_WORKSPACE_UNAVAILABLE",
      persistence: { kind: "local", persistent: false },
    },
    503,
  );
}

class RequestBodyTooLargeError extends Error {}

function isLocalSameOrigin(request: Request, requireOrigin: boolean): boolean {
  try {
    assertLocalRequest(request, requireOrigin);
    return true;
  } catch {
    return false;
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError("Expected a request body.");

  const bytes = new Uint8Array(MAX_REQUEST_BYTES);
  let byteLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.byteLength > MAX_REQUEST_BYTES - byteLength) {
      try {
        await reader.cancel();
      } catch {
        // The size verdict is authoritative even if the producer cannot cancel.
      }
      throw new RequestBodyTooLargeError();
    }
    bytes.set(value, byteLength);
    byteLength += value.byteLength;
  }
  return bytes.subarray(0, byteLength);
}

async function cancelRequestBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // Rejection remains safe even when the producer cannot cancel cleanly.
  }
}

function parseEnvelope(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected a JSON object.");
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "expectedRevision" ||
    keys[1] !== "mutation" ||
    keys[2] !== "mutationId"
  ) {
    throw new TypeError(
      "Expected exactly expectedRevision, mutationId, and mutation.",
    );
  }
  if (
    !Number.isSafeInteger(source.expectedRevision) ||
    (source.expectedRevision as number) < 0
  ) {
    throw new TypeError("expectedRevision must be a non-negative integer.");
  }
  if (
    typeof source.mutationId !== "string" ||
    source.mutationId.length < 1 ||
    source.mutationId.length > 160
  ) {
    throw new TypeError("mutationId must contain 1-160 characters.");
  }
  return {
    expectedRevision: source.expectedRevision as number,
    mutationId: source.mutationId,
    mutation: parseWorkspaceMutation(source.mutation),
  };
}

export async function GET(request: Request) {
  if (!isLocalSameOrigin(request, false)) {
    return json(
      {
        error: "Workspace reads are local and same-origin only.",
        code: "FORBIDDEN",
      },
      403,
    );
  }
  try {
    return json(success(await store.load()));
  } catch {
    return unavailable();
  }
}

export async function PATCH(request: Request) {
  if (!isLocalSameOrigin(request, true)) {
    return json(
      {
        error: "Workspace writes are local and same-origin only.",
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
    return json(
      {
        error: "Content-Type must be application/json.",
        code: "UNSUPPORTED_MEDIA_TYPE",
      },
      415,
    );
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    await cancelRequestBody(request);
    return json(
      { error: "Workspace mutation is too large.", code: "PAYLOAD_TOO_LARGE" },
      413,
    );
  }

  let envelope: ReturnType<typeof parseEnvelope>;
  try {
    const bytes = await readBoundedBody(request);
    envelope = parseEnvelope(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json(
        {
          error: "Workspace mutation is too large.",
          code: "PAYLOAD_TOO_LARGE",
        },
        413,
      );
    }
    if (
      error instanceof SyntaxError ||
      error instanceof TypeError ||
      error instanceof CofficeWorkspaceValidationError
    ) {
      return json(
        { error: "Workspace mutation is invalid.", code: "INVALID_MUTATION" },
        400,
      );
    }
    return unavailable();
  }

  try {
    return json(
      success(
        await store.mutate(
          envelope.expectedRevision,
          envelope.mutationId,
          envelope.mutation,
        ),
      ),
    );
  } catch (error) {
    if (
      error instanceof CofficeWorkspaceConflictError ||
      error instanceof CofficeWorkspaceMutationIdError
    ) {
      try {
        const loaded = await store.load();
        return json(
          {
            error:
              error instanceof CofficeWorkspaceConflictError
                ? "The workspace changed elsewhere."
                : "This mutation id was already used for a different change.",
            code:
              error instanceof CofficeWorkspaceConflictError
                ? "WORKSPACE_REVISION_CONFLICT"
                : "MUTATION_ID_REUSE",
            ...success(loaded),
          },
          409,
        );
      } catch {
        return unavailable();
      }
    }
    if (
      error instanceof CofficeWorkspaceValidationError ||
      error instanceof TypeError
    ) {
      return json(
        { error: "Workspace mutation is invalid.", code: "INVALID_MUTATION" },
        400,
      );
    }
    return unavailable();
  }
}
