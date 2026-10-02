import { describe, expect, it } from "vitest";

import {
  assertLocalRequest,
  LocalRequestError,
} from "../src/lib/local-request-security";

function request(
  url = "http://127.0.0.1:3003/api/snapshot",
  headers: Record<string, string> = {},
) {
  return new Request(url, { headers });
}

describe("local request boundary", () => {
  it.each([
    "http://127.0.0.1:3003/api/snapshot",
    "http://localhost:3003/api/snapshot",
  ])("accepts a direct local GET to %s", (url) => {
    expect(() => assertLocalRequest(request(url), false)).not.toThrow();
  });

  it("trusts the Host authority when Next normalizes request.url", () => {
    expect(() =>
      assertLocalRequest(
        request("http://localhost:3003/api/snapshot", {
          Host: "127.0.0.1:3003",
          Origin: "http://127.0.0.1:3003",
        }),
        false,
      ),
    ).not.toThrow();
    expect(() =>
      assertLocalRequest(
        request("http://127.0.0.1:3003/api/snapshot", {
          Host: "localhost:3003",
          Origin: "http://localhost:3003",
        }),
        false,
      ),
    ).not.toThrow();
  });

  it.each(["same-origin", "none", "  SAME-ORIGIN  "])(
    "accepts the safe Sec-Fetch-Site token %j",
    (token) => {
      expect(() =>
        assertLocalRequest(
          request(undefined, { "Sec-Fetch-Site": token }),
          false,
        ),
      ).not.toThrow();
    },
  );

  it.each(["cross-site", "same-site", "invalid", ""])(
    "rejects the unsafe Sec-Fetch-Site token %j",
    (token) => {
      expect(() =>
        assertLocalRequest(
          request(undefined, { "Sec-Fetch-Site": token }),
          false,
        ),
      ).toThrow(
        expect.objectContaining<Partial<LocalRequestError>>({
          code: "SAME_ORIGIN_REQUIRED",
          status: 403,
        }),
      );
    },
  );

  it.each([
    [{ Host: "example.test" }, "LOOPBACK_REQUIRED"],
    [{ Host: "127.0.0.1:3004" }, "LOOPBACK_REQUIRED"],
    [{ Host: "[::1]:3003" }, "LOOPBACK_REQUIRED"],
    [
      {
        Host: "127.0.0.1:3003",
        Origin: "http://localhost:3003",
      },
      "SAME_ORIGIN_REQUIRED",
    ],
  ])("rejects an unsafe local-boundary request", (headers, code) => {
    expect(() =>
      assertLocalRequest(request(undefined, headers), false),
    ).toThrow(
      expect.objectContaining<Partial<LocalRequestError>>({
        code,
        status: 403,
      }),
    );
  });

  it("preserves the action boundary's required Origin policy", () => {
    expect(() => assertLocalRequest(request())).toThrow(
      expect.objectContaining<Partial<LocalRequestError>>({
        code: "ORIGIN_REQUIRED",
        status: 403,
      }),
    );
  });
});
