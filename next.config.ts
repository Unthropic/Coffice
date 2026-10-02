import type { NextConfig } from "next";

export function buildSecurityHeaders(
  environment: string | undefined = process.env.NODE_ENV,
) {
  const scriptSources = ["'self'", "'unsafe-inline'"];
  if (environment === "development") scriptSources.push("'unsafe-eval'");

  return [
    {
      key: "Content-Security-Policy",
      value: [
        "default-src 'self'",
        `script-src ${scriptSources.join(" ")}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
    },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ];
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "*": [
      "./tmp/**/*",
      "./.git/**/*",
      "./.desktop-build/**/*",
      "./desktop-release/**/*",
    ],
  },
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: buildSecurityHeaders() }];
  },
};

export default nextConfig;
