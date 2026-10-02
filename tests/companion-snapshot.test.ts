import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexSourceSnapshot } from "../src/lib/codex-source";

const mocks = vi.hoisted(() => ({ read: vi.fn(), appServer: vi.fn() }));
vi.mock("../src/lib/codex-source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/codex-source")>()),
  readCodexSource: mocks.read,
}));
vi.mock("../src/lib/codex-app-server", () => ({
  getCodexAppServerManager: mocks.appServer,
}));

import {
  buildCompanionSnapshot,
  createCompanionSnapshotReader,
} from "../src/lib/companion-snapshot";
import {
  parseSessionJsonl,
  selectSessionSummaryJsonl,
} from "../src/lib/codex-source";
import { reduceSessionStatus } from "../src/lib/status";

function fixture(): CodexSourceSnapshot {
  return {
    projects: [
      {
        id: "garden",
        name: "Garden",
        rootPath: "C:\\Private",
        rootPaths: ["C:\\Private"],
        order: 0,
      },
    ],
    threadRootHints: new Map(),
    threadProjectAssignments: new Map([["visible", "garden"]]),
    invalidThreadProjectAssignments: new Set(),
    currentAssignmentsAvailable: true,
    sessions: [
      {
        id: "visible",
        title: "Make something",
        updatedAt: "2026-10-02T16:00:00.000Z",
      },
    ],
    sessionLocations: new Map([["visible", "live"]]),
    sessionMetadata: new Map([
      [
        "visible",
        {
          events: [
            { type: "item_completed", timestamp: "2026-10-02T16:00:00.000Z" },
          ],
        },
      ],
    ]),
    diagnostics: [],
    globalStateAvailable: true,
    sessionIndexAvailable: true,
    rosterAvailable: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(fixture());
});

describe("companion activity", () => {
  it("reads status without Git enrichment, App Server, or private paths", async () => {
    const snapshot = await buildCompanionSnapshot();
    expect(mocks.read).toHaveBeenCalledWith({
      includeRepositoryEvidence: false,
    });
    expect(mocks.appServer).not.toHaveBeenCalled();
    expect(snapshot.tasks[0]).toMatchObject({
      projectId: "garden",
      status: { value: "active" },
    });
    expect(JSON.stringify(snapshot)).not.toContain("C:\\Private");
  });

  it("fails closed when visibility or project assignments cannot be read", async () => {
    mocks.read.mockResolvedValueOnce({ ...fixture(), rosterAvailable: false });
    await expect(buildCompanionSnapshot()).rejects.toThrow("unavailable");
    mocks.read.mockResolvedValueOnce({
      ...fixture(),
      globalStateAvailable: false,
    });
    await expect(buildCompanionSnapshot()).rejects.toThrow("unavailable");
  });

  it("retains the last office with explicit stale state after a refresh failure", async () => {
    let now = 1_000;
    const snapshot = await buildCompanionSnapshot();
    const loader = vi
      .fn()
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValue(new Error("unavailable"));
    const read = createCompanionSnapshotReader(loader, () => now);
    expect((await read()).source.freshness).toBe("fresh");
    now += 2_000;
    await read();
    await new Promise((resolve) => setImmediate(resolve));
    const stale = await read();
    expect(stale.tasks).toEqual(snapshot.tasks);
    expect(stale.source).toMatchObject({
      freshness: "stale",
      refreshState: "failed",
      health: "degraded",
    });
  });

  it("shares one cold activity read across concurrent callers", async () => {
    const snapshot = await buildCompanionSnapshot();
    const loader = vi.fn(async () => snapshot);
    const read = createCompanionSnapshotReader(loader);
    await Promise.all([read(), read(), read()]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("can recover if the first quick roster read is unavailable", async () => {
    const snapshot = await buildCompanionSnapshot();
    const seed = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(snapshot);
    const read = createCompanionSnapshotReader(
      async () => snapshot,
      Date.now,
      seed,
    );
    await expect(read()).rejects.toThrow("unavailable");
    expect((await read()).tasks).toEqual(snapshot.tasks);
  });

  it("recognizes current item lifecycle metadata without retaining item content", () => {
    const timestamp = "2026-10-02T16:00:00.000Z";
    const line = JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: {
        type: "item_completed",
        item: {
          type: "CommandExecution",
          command: "private command",
          output: "private output",
        },
      },
    });
    const parsed = parseSessionJsonl(selectSessionSummaryJsonl(line));
    expect(parsed.metadata.events).toEqual([
      { timestamp, type: "item_completed" },
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(/private|command|output/);
    expect(
      reduceSessionStatus(parsed.metadata.events, { now: new Date(timestamp) }),
    ).toMatchObject({ value: "active", stale: false });
  });

  it("never mistakes an item completion for a completed turn", () => {
    const timestamp = "2026-10-02T16:00:00.000Z";
    expect(
      reduceSessionStatus([{ type: "item_completed", timestamp }], {
        now: new Date(timestamp),
      }).value,
    ).toBe("active");
    expect(
      reduceSessionStatus(
        [
          { type: "item_completed", timestamp },
          { type: "turn_complete", timestamp },
        ],
        { now: new Date(timestamp) },
      ).value,
    ).toBe("completed");
  });
});
