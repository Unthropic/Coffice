import { NextResponse } from "next/server";

import { assertLocalRequest } from "../../../lib/local-request-security";
import { getCodexSnapshot } from "../../../lib/snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertLocalRequest(request, false);
  } catch {
    return NextResponse.json(
      { error: "Local request required.", code: "FORBIDDEN" },
      {
        status: 403,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }
  try {
    const snapshot = await getCodexSnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: "Codex metadata is unavailable.",
        code: "CODEX_SOURCE_UNAVAILABLE",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }
}
