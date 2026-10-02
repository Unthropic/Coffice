const LOCAL_AUTHORITIES = new Set(["127.0.0.1:3003", "localhost:3003"]);

export class LocalRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

/**
 * Enforces Coffice's fixed local HTTP boundary. The Host header is authoritative
 * because Next may normalize request.url to a different loopback spelling.
 */
export function assertLocalRequest(
  request: Request,
  requireOrigin = true,
): void {
  const authority =
    request.headers.get("host")?.trim().toLowerCase() ??
    new URL(request.url).host.toLowerCase();
  if (!LOCAL_AUTHORITIES.has(authority)) {
    throw new LocalRequestError("LOOPBACK_REQUIRED", 403);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) {
    const token = fetchSite.trim().toLowerCase();
    if (token !== "same-origin" && token !== "none") {
      throw new LocalRequestError("SAME_ORIGIN_REQUIRED", 403);
    }
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    if (requireOrigin) throw new LocalRequestError("ORIGIN_REQUIRED", 403);
    return;
  }

  try {
    const originUrl = new URL(origin);
    if (
      originUrl.protocol !== "http:" ||
      originUrl.host.toLowerCase() !== authority ||
      originUrl.username !== "" ||
      originUrl.password !== "" ||
      originUrl.pathname !== "/" ||
      originUrl.search !== "" ||
      originUrl.hash !== ""
    ) {
      throw new LocalRequestError("SAME_ORIGIN_REQUIRED", 403);
    }
  } catch (error) {
    if (error instanceof LocalRequestError) throw error;
    throw new LocalRequestError("SAME_ORIGIN_REQUIRED", 403);
  }
}
