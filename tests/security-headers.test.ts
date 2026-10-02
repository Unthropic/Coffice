import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "../next.config";

function contentSecurityPolicy(environment: string): string {
  return buildSecurityHeaders(environment).find(
    (header) => header.key === "Content-Security-Policy",
  )!.value;
}

describe("security headers", () => {
  it("removes development evaluation from the production policy", () => {
    const policy = contentSecurityPolicy("production");
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it("retains evaluation only for the local development compiler", () => {
    expect(contentSecurityPolicy("development")).toContain("'unsafe-eval'");
  });
});
