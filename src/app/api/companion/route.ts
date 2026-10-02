import { getCompanionSnapshot } from "../../../lib/companion-snapshot";
import { assertLocalRequest } from "../../../lib/local-request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  try {
    assertLocalRequest(request, false);
  } catch {
    return Response.json(
      { error: "Local request required.", code: "FORBIDDEN" },
      { status: 403, headers },
    );
  }
  try {
    return Response.json(await getCompanionSnapshot(), { headers });
  } catch {
    return Response.json(
      {
        error: "Codex activity is unavailable.",
        code: "CODEX_SOURCE_UNAVAILABLE",
      },
      { status: 503, headers },
    );
  }
}
