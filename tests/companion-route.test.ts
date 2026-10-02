import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock("../src/lib/companion-snapshot", () => ({
  getCompanionSnapshot: mocks.snapshot,
}));
import { GET } from "../src/app/api/companion/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("companion endpoint", () => {
  it("serves local activity with no-store caching", async () => {
    mocks.snapshot.mockResolvedValue({ projects: [], tasks: [] });
    const response = await GET(
      new Request("http://127.0.0.1:3003/api/companion"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects a foreign origin before reading any metadata", async () => {
    const response = await GET(
      new Request("http://127.0.0.1:3003/api/companion", {
        headers: { origin: "https://example.com" },
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("reports unavailable metadata without exposing errors", async () => {
    mocks.snapshot.mockRejectedValue(new Error("private local path"));
    const response = await GET(
      new Request("http://127.0.0.1:3003/api/companion"),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });
});
