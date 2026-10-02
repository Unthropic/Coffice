import { assertLocalRequest } from "../../../lib/local-request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "text/plain; charset=utf-8",
};

/** Lets the desktop parent identify only the service it started itself. */
export function GET(request: Request) {
  try {
    assertLocalRequest(request, false);
  } catch {
    return new Response("Forbidden", { status: 403, headers });
  }
  const token = process.env.COFFICE_DESKTOP_READY_TOKEN;
  if (process.env.COFFICE_DESKTOP !== "1" || !token) {
    return new Response("Unavailable", { status: 503, headers });
  }
  return new Response(token, { headers });
}
