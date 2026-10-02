import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/desktop-ready/route";

afterEach(() => vi.unstubAllEnvs());

describe("desktop readiness handshake", () => {
  it("is unavailable in an ordinary web server", async () => {
    vi.stubEnv("COFFICE_DESKTOP", "");
    const response = GET(
      new Request("http://127.0.0.1:3003/api/desktop-ready"),
    );
    expect(response.status).toBe(503);
  });

  it("returns only the ephemeral child identity without caching", async () => {
    const identity = "abcd".repeat(16);
    vi.stubEnv("COFFICE_DESKTOP", "1");
    vi.stubEnv("COFFICE_DESKTOP_READY_TOKEN", identity);
    const response = GET(
      new Request("http://127.0.0.1:3003/api/desktop-ready"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe(identity);
  });

  it("rejects cross-origin reads", () => {
    vi.stubEnv("COFFICE_DESKTOP", "1");
    vi.stubEnv("COFFICE_DESKTOP_READY_TOKEN", "abcd".repeat(16));
    const response = GET(
      new Request("http://127.0.0.1:3003/api/desktop-ready", {
        headers: { origin: "https://example.com" },
      }),
    );
    expect(response.status).toBe(403);
  });
});
