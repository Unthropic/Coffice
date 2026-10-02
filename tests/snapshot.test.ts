import { describe, expect, it } from "vitest";

import {
  parseSavedProjectsJson,
  type CodexSourceSnapshot,
} from "../src/lib/codex-source";
import type { CofficeSnapshot } from "../src/lib/domain";
import {
  buildSnapshotFromSource,
  createCodexSnapshotStaging,
} from "../src/lib/snapshot";

function sourceFixture(): CodexSourceSnapshot {
  return {
    projects: [
      {
        id: "project-1",
        name: "Alpha",
        rootPath: "C:\\Work\\Alpha",
        rootPaths: ["C:\\Work\\Alpha"],
        order: 0,
      },
    ],
    threadRootHints: new Map([
      ["agent-old", "C:\\Work\\Alpha"],
      ["temp-old", "C:\\Work\\Alpha"],
      ["temp-recent", "C:\\Work\\Alpha"],
    ]),
    threadProjectAssignments: new Map(),
    invalidThreadProjectAssignments: new Set(),
    currentAssignmentsAvailable: false,
    sessions: [
      {
        id: "agent-old",
        title: "[AGENT] Ada",
        updatedAt: "2026-06-01T10:00:00Z",
      },
      {
        id: "temp-old",
        title: "Old temporary task",
        updatedAt: "2026-06-01T10:00:00Z",
      },
      {
        id: "temp-recent",
        title: "Recent temporary task",
        updatedAt: "2026-07-12T10:00:00Z",
      },
    ],
    sessionLocations: new Map([
      ["agent-old", "live"],
      ["temp-old", "archived"],
      ["temp-recent", "live"],
    ]),
    sessionMetadata: new Map([
      [
        "temp-recent",
        {
          lastEventAt: "2026-07-13T11:59:00Z",
          tokenUsage: {
            contextTokens: 64_000,
            contextWindow: 128_000,
            cumulativeTokens: 90_000,
            timestamp: "2026-07-13T11:59:00Z",
          },
          events: [
            { type: "agent_reasoning", timestamp: "2026-07-13T11:59:00Z" },
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

describe("buildSnapshotFromSource", () => {
  it("projects an exact authoritative blocked goal onto only its admitted live task", () => {
    const source = sourceFixture();
    const snapshot = buildSnapshotFromSource(
      source,
      new Date("2026-07-20T12:00:00Z"),
      {
        available: true,
        evidence: new Map([
          [
            "temp-recent",
            {
              threadId: "temp-recent",
              updatedAt: "2026-07-20T11:58:00.000Z",
            },
          ],
          [
            "not-admitted",
            {
              threadId: "not-admitted",
              updatedAt: "2026-07-20T11:59:00.000Z",
            },
          ],
        ]),
      },
    );

    expect(snapshot.tasks).toHaveLength(2);
    expect(
      snapshot.tasks.find((task) => task.id === "temp-recent")?.status,
    ).toEqual({
      value: "blocked",
      provenance: "observed",
      source: "codex-app-server:thread/goal/get",
      timestamp: "2026-07-20T11:58:00.000Z",
      stale: false,
      confidence: 1,
    });
    expect(snapshot.tasks.some((task) => task.id === "not-admitted")).toBe(
      false,
    );
    expect(JSON.stringify(snapshot)).not.toContain("objective");
  });

  it("resolves the blocked projection when the authoritative read no longer reports it", () => {
    const source = sourceFixture();
    const blocked = buildSnapshotFromSource(
      source,
      new Date("2026-07-20T12:00:00Z"),
      {
        available: true,
        evidence: new Map([
          [
            "temp-recent",
            {
              threadId: "temp-recent",
              updatedAt: "2026-07-20T11:58:00.000Z",
            },
          ],
        ]),
      },
    );
    const resolved = buildSnapshotFromSource(
      source,
      new Date("2026-07-20T12:00:03Z"),
      { available: true, evidence: new Map() },
    );

    expect(
      blocked.tasks.find((task) => task.id === "temp-recent")?.status.value,
    ).toBe("blocked");
    expect(
      resolved.tasks.find((task) => task.id === "temp-recent")?.status.value,
    ).toBe("thinking");
  });

  it("keeps the last exact blocked projection stale while goal reads are unavailable", () => {
    const snapshot = buildSnapshotFromSource(
      sourceFixture(),
      new Date("2026-07-20T12:00:03Z"),
      {
        available: false,
        evidence: new Map([
          [
            "temp-recent",
            {
              threadId: "temp-recent",
              updatedAt: "2026-07-20T11:58:00.000Z",
            },
          ],
        ]),
      },
    );

    expect(
      snapshot.tasks.find((task) => task.id === "temp-recent")?.status,
    ).toMatchObject({
      value: "blocked",
      source: "codex-app-server:thread/goal/get",
      timestamp: "2026-07-20T11:58:00.000Z",
      stale: true,
    });
  });

  it("does not report bounded repository collection as skipped source data", () => {
    const source = sourceFixture();
    source.projects = [
      {
        ...source.projects[0]!,
        rootPaths: Array.from(
          { length: 40 },
          (_, index) => `C:\\Private\\One-${index}`,
        ),
        repositoryCollectionBoundedOut: true,
      },
      {
        ...source.projects[0]!,
        id: "project-2",
        name: "Beta",
        rootPath: "D:\\Private\\Two-0",
        rootPaths: Array.from(
          { length: 25 },
          (_, index) => `D:\\Private\\Two-${index}`,
        ),
        repositoryCollectionBoundedOut: true,
      },
    ];
    source.diagnostics = [
      {
        code: "REPOSITORY_ENRICHMENT_BOUND_EXCEEDED",
        message:
          "Repository evidence is unavailable because the source-wide collection safety bound was exceeded.",
        severity: "warning",
        source: "adapter",
      },
    ];

    const snapshot = buildSnapshotFromSource(source);
    expect(snapshot.source.health).toBe("connected");
    expect(snapshot.diagnostics).toEqual([]);
    expect(
      snapshot.projects.map((project) => project.repositoryRootCount),
    ).toEqual([40, 25]);
    expect(
      snapshot.projects.every(
        (project) => project.repositoryRoots === undefined,
      ),
    ).toBe(true);
  });

  it("preserves genuine parser diagnostics beside bounded collection state", () => {
    const source = sourceFixture();
    source.projects[0] = {
      ...source.projects[0]!,
      repositoryCollectionBoundedOut: true,
    };
    source.diagnostics = [
      {
        code: "REPOSITORY_ENRICHMENT_BOUND_EXCEEDED",
        message: "Bounded out.",
        severity: "warning",
        source: "adapter",
      },
      {
        code: "SESSION_INDEX_RECORD_SKIPPED",
        message: "A malformed session-index record was skipped.",
        severity: "warning",
        source: "session_index",
      },
    ];

    const snapshot = buildSnapshotFromSource(source);
    expect(snapshot.source.health).toBe("degraded");
    expect(snapshot.diagnostics).toEqual([source.diagnostics[1]]);
  });

  it("keeps every live session and excludes archived sessions", () => {
    const snapshot = buildSnapshotFromSource(
      sourceFixture(),
      new Date("2026-07-13T12:00:00Z"),
    );

    expect(snapshot.tasks.map((task) => task.id)).toEqual([
      "agent-old",
      "temp-recent",
    ]);
    expect(
      snapshot.tasks.find((task) => task.id === "agent-old"),
    ).toMatchObject({
      title: "[AGENT] Ada",
      kind: "named_agent",
      agentName: "Ada",
    });
    expect(
      snapshot.tasks.find((task) => task.id === "temp-recent")?.title,
    ).toBe("Recent temporary task");
  });

  it("keeps an old completed temporary session while its file is live", () => {
    const source = sourceFixture();
    source.sessionLocations.set("temp-old", "live");
    source.sessionMetadata.set("temp-old", {
      lastEventAt: "2026-06-01T10:00:00Z",
      events: [{ type: "turn_complete", timestamp: "2026-06-01T10:00:00Z" }],
    });

    const snapshot = buildSnapshotFromSource(
      source,
      new Date("2026-07-13T12:00:00Z"),
    );

    expect(snapshot.tasks.find((task) => task.id === "temp-old")).toMatchObject(
      { status: { value: "completed" } },
    );
  });

  it("prefers the latest observed event timestamp over the index timestamp", () => {
    const snapshot = buildSnapshotFromSource(
      sourceFixture(),
      new Date("2026-07-13T12:00:00Z"),
    );
    expect(
      snapshot.tasks.find((task) => task.id === "temp-recent")?.updatedAt,
    ).toBe("2026-07-13T11:59:00.000Z");
  });

  it("exposes only bounded token metadata with freshness", () => {
    const snapshot = buildSnapshotFromSource(
      sourceFixture(),
      new Date("2026-07-13T12:00:00Z"),
    );
    expect(
      snapshot.tasks.find((task) => task.id === "temp-recent")?.tokenUsage,
    ).toMatchObject({
      contextTokens: 64_000,
      contextWindow: 128_000,
      cumulativeTokens: 90_000,
      stale: false,
      source: "session-jsonl:event_msg.token_count",
    });
  });

  it("assigns tasks to the longest matching saved project root", () => {
    const source = sourceFixture();
    source.projects.push({
      id: "project-nested",
      name: "Nested",
      rootPath: "C:\\Work\\Alpha\\packages\\Nested",
      rootPaths: ["C:\\Work\\Alpha\\packages\\Nested"],
      order: 1,
    });
    source.threadRootHints.set(
      "temp-recent",
      "C:\\Work\\Alpha\\packages\\Nested\\src",
    );

    const snapshot = buildSnapshotFromSource(
      source,
      new Date("2026-07-13T12:00:00Z"),
    );

    expect(
      snapshot.tasks.find((task) => task.id === "temp-recent"),
    ).toMatchObject({
      projectId: "project-nested",
      assignmentEvidence: "cwd_fallback",
    });
  });

  it("distinguishes explicit project, unassigned, unknown-project, and cwd fallback evidence", () => {
    const source = sourceFixture();
    source.sessions = [
      {
        id: "known",
        title: "Known assignment",
        updatedAt: "2026-07-12T10:00:00Z",
      },
      {
        id: "unassigned",
        title: "Unassigned",
        updatedAt: "2026-07-12T10:00:00Z",
      },
      {
        id: "unknown",
        title: "Unknown project",
        updatedAt: "2026-07-12T10:00:00Z",
      },
    ];
    source.sessionLocations = new Map(
      source.sessions.map((session) => [session.id, "live" as const]),
    );
    source.currentAssignmentsAvailable = true;
    source.threadProjectAssignments = new Map([
      ["known", "project-1"],
      ["unknown", "missing-project"],
    ]);
    source.threadRootHints.set("unassigned", "C:\\Work\\Alpha");

    const tasks = buildSnapshotFromSource(
      source,
      new Date("2026-07-13T12:00:00Z"),
    ).tasks;
    expect(tasks.find((task) => task.id === "known")).toMatchObject({
      projectId: "project-1",
      assignmentEvidence: "explicit_project",
    });
    expect(tasks.find((task) => task.id === "unassigned")).toMatchObject({
      projectId: null,
      assignmentEvidence: "explicit_unassigned",
    });
    expect(tasks.find((task) => task.id === "unknown")).toMatchObject({
      projectId: null,
      assignmentEvidence: "explicit_unknown_project",
    });
  });

  it("fails a malformed or contradictory per-thread assignment closed", () => {
    const source = sourceFixture();
    source.sessions = [
      {
        id: "malformed",
        title: "Malformed assignment",
        updatedAt: "2026-07-12T10:00:00Z",
      },
    ];
    source.sessionLocations = new Map([["malformed", "live"]]);
    source.currentAssignmentsAvailable = true;
    source.threadProjectAssignments = new Map([["malformed", "project-1"]]);
    source.invalidThreadProjectAssignments = new Set(["malformed"]);
    source.threadRootHints.set("malformed", "C:\\Work\\Alpha");

    expect(
      buildSnapshotFromSource(source, new Date("2026-07-13T12:00:00Z"))
        .tasks[0],
    ).toMatchObject({
      projectId: null,
      assignmentEvidence: "explicit_unknown_project",
    });
  });

  it("groups a session into a local-projects root resolved from a project-id assignment", () => {
    const inventory = parseSavedProjectsJson(
      JSON.stringify({
        "local-projects": {
          "proj-alpha": {
            id: "proj-alpha",
            name: "Alpha",
            rootPaths: ["C:\\Work\\Alpha"],
          },
          "proj-beta": {
            id: "proj-beta",
            name: "Beta",
            rootPaths: ["C:\\Work\\Beta"],
          },
        },
        "project-order": ["proj-alpha", "proj-beta"],
        "thread-project-assignments": {
          "temp-assigned": { projectKind: "local", projectId: "proj-alpha" },
        },
      }),
    );

    const snapshot = buildSnapshotFromSource(
      {
        projects: inventory.projects,
        threadRootHints: inventory.threadRootHints,
        threadProjectAssignments: inventory.threadProjectAssignments,
        invalidThreadProjectAssignments:
          inventory.invalidThreadProjectAssignments,
        currentAssignmentsAvailable: inventory.currentAssignmentsAvailable,
        sessions: [
          {
            id: "temp-assigned",
            title: "Assigned task",
            updatedAt: "2026-07-12T10:00:00Z",
          },
        ],
        sessionLocations: new Map([["temp-assigned", "live"]]),
        // The rollout cwd conflicts with the current project assignment. The
        // explicit Codex project remains authoritative.
        sessionMetadata: new Map([
          ["temp-assigned", { cwd: "C:\\Work\\Beta", events: [] }],
        ]),
        diagnostics: [],
        globalStateAvailable: true,
        sessionIndexAvailable: true,
        rosterAvailable: true,
      },
      new Date("2026-07-13T12:00:00Z"),
    );

    const expectedProjectId = inventory.projects.find(
      (project) => project.rootPath === "C:\\Work\\Alpha",
    )?.id;
    expect(expectedProjectId).toBeDefined();
    expect(
      snapshot.tasks.find((task) => task.id === "temp-assigned"),
    ).toMatchObject({
      projectId: expectedProjectId,
      assignmentEvidence: "explicit_project",
    });
    expect(
      snapshot.projects.find((project) => project.id === expectedProjectId)
        ?.name,
    ).toBe("Alpha");
  });
});

describe("createCodexSnapshotStaging", () => {
  const FIXED_NOW = new Date("2026-07-13T12:00:00Z");
  const DEFERRED_DIAGNOSTIC = expect.objectContaining({
    code: "SESSION_METADATA_DEFERRED",
    severity: "warning",
  });

  function gate<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((onResolve) => {
      resolve = onResolve;
    });
    return { promise, resolve };
  }

  function flush(): Promise<void> {
    return new Promise<void>((resolve) => setImmediate(resolve));
  }

  function deferredSourceFixture(): CodexSourceSnapshot {
    const source = sourceFixture();
    return {
      ...source,
      projects: source.projects.map((project) => ({
        ...project,
        rootPaths: [project.rootPaths[0]!, "D:\\Private\\Alpha-tools"],
      })),
      sessionMetadata: new Map(),
      diagnostics: [
        {
          code: "SESSION_METADATA_DEFERRED",
          message:
            "Session file metadata was deferred for this read; a background enrichment will refresh it.",
          severity: "warning",
          source: "adapter",
        },
      ],
    };
  }

  function boundedDeferredSourceFixture(): CodexSourceSnapshot {
    const source = deferredSourceFixture();
    return {
      ...source,
      projects: [
        {
          ...source.projects[0]!,
          id: "project-1",
          rootPath: "C:\\Private\\One-0",
          rootPaths: Array.from(
            { length: 40 },
            (_, index) => `C:\\Private\\One-${index}`,
          ),
          repositoryCollectionBoundedOut: true,
        },
        {
          ...source.projects[0]!,
          id: "project-2",
          name: "Beta",
          rootPath: "D:\\Private\\Two-0",
          rootPaths: Array.from(
            { length: 25 },
            (_, index) => `D:\\Private\\Two-${index}`,
          ),
          repositoryCollectionBoundedOut: true,
        },
      ],
      diagnostics: [
        ...source.diagnostics,
        {
          code: "REPOSITORY_ENRICHMENT_BOUND_EXCEEDED",
          message:
            "Repository evidence is unavailable because the source-wide collection safety bound was exceeded.",
          severity: "warning",
          source: "adapter",
        },
      ],
    };
  }

  it("seeds the first cold read quickly with the deferred snapshot", async () => {
    const clock = 1_000;
    let fullCalls = 0;
    const fullGate = gate<CofficeSnapshot>();
    const staging = createCodexSnapshotStaging(
      {
        buildFull: async () => {
          fullCalls += 1;
          return await fullGate.promise;
        },
        buildDeferred: async () =>
          buildSnapshotFromSource(deferredSourceFixture(), FIXED_NOW),
      },
      {
        freshForMs: 10_000,
        retryAfterMs: 5_000,
        coldWaitMs: 30_000,
        now: () => clock,
      },
    );

    // The seed resolves while the full enrichment is still pending.
    const seeded = await staging.getSnapshot();
    expect(seeded.projects.map((project) => project.name)).toEqual(["Alpha"]);
    expect(seeded.tasks.map((task) => task.id)).toEqual([
      "agent-old",
      "temp-recent",
    ]);
    // Project grouping survives the deferred read via thread root hints.
    expect(
      seeded.tasks.find((task) => task.id === "temp-recent")?.projectId,
    ).toBe("project-1");
    expect(seeded.diagnostics).toContainEqual(DEFERRED_DIAGNOSTIC);
    expect(seeded.source.refreshState).toBe("refreshing");
    expect(seeded.projects[0]?.repositoryRoots).toEqual([
      { role: "primary" },
      { role: "additional" },
    ]);
    expect(seeded.projects[0]?.repositoryRootCount).toBe(2);
    const serializedRoots = JSON.stringify(seeded.projects[0]?.repositoryRoots);
    expect(serializedRoots).not.toMatch(/Alpha-tools|rootPath|observedAt/iu);

    await flush();
    expect(fullCalls).toBe(1);
  });

  it("seeds an over-bound cold read with compact exact root counts", async () => {
    const fullGate = gate<CofficeSnapshot>();
    const staging = createCodexSnapshotStaging(
      {
        buildFull: async () => await fullGate.promise,
        buildDeferred: async () =>
          buildSnapshotFromSource(boundedDeferredSourceFixture(), FIXED_NOW),
      },
      {
        freshForMs: 10_000,
        retryAfterMs: 5_000,
        coldWaitMs: 30_000,
        now: () => 1_000,
      },
    );

    const seeded = await staging.getSnapshot();
    expect(seeded.source.refreshState).toBe("refreshing");
    expect(
      seeded.projects.map((project) => ({
        count: project.repositoryRootCount,
        state: project.repositoryCollectionState,
      })),
    ).toEqual([
      { count: 40, state: "bounded_out" },
      { count: 25, state: "bounded_out" },
    ]);
    for (const project of seeded.projects) {
      expect(project.repositoryRoots).toBeUndefined();
      expect(project.repository).toBeUndefined();
    }
    expect(JSON.stringify(seeded.projects)).not.toMatch(
      /Private|repositoryRoots|"repository":|"evidence":/u,
    );
  });

  it("shares one background enrichment across concurrent readers", async () => {
    const clock = 1_000;
    let fullCalls = 0;
    const fullGate = gate<CofficeSnapshot>();
    const staging = createCodexSnapshotStaging(
      {
        buildFull: async () => {
          fullCalls += 1;
          return await fullGate.promise;
        },
        buildDeferred: async () =>
          buildSnapshotFromSource(deferredSourceFixture(), FIXED_NOW),
      },
      {
        freshForMs: 10_000,
        retryAfterMs: 5_000,
        coldWaitMs: 30_000,
        now: () => clock,
      },
    );

    const snapshots = await Promise.all([
      staging.getSnapshot(),
      staging.getSnapshot(),
      staging.getSnapshot(),
    ]);
    for (const snapshot of snapshots) {
      expect(snapshot.diagnostics).toContainEqual(DEFERRED_DIAGNOSTIC);
    }

    await flush();
    expect(fullCalls).toBe(1);

    fullGate.resolve(buildSnapshotFromSource(sourceFixture(), FIXED_NOW));
    await flush();
    expect(fullCalls).toBe(1);

    const enriched = await staging.getSnapshot();
    expect(enriched.diagnostics).not.toContainEqual(DEFERRED_DIAGNOSTIC);
    expect(enriched.source.refreshState).toBe("fresh");
  });

  it("retains the seed after a failed enrichment and retries safely", async () => {
    let clock = 1_000;
    let fullCalls = 0;
    const fullSnapshot = buildSnapshotFromSource(sourceFixture(), FIXED_NOW);
    const staging = createCodexSnapshotStaging(
      {
        buildFull: async () => {
          fullCalls += 1;
          if (fullCalls === 1)
            throw new Error("synthetic cold enrichment failure");
          return fullSnapshot;
        },
        buildDeferred: async () =>
          buildSnapshotFromSource(deferredSourceFixture(), FIXED_NOW),
      },
      {
        freshForMs: 10,
        retryAfterMs: 1_000,
        coldWaitMs: 30_000,
        now: () => clock,
      },
    );

    const seeded = await staging.getSnapshot();
    expect(seeded.diagnostics).toContainEqual(DEFERRED_DIAGNOSTIC);
    await flush();
    expect(fullCalls).toBe(1);

    // The seed keeps serving while stale, and no retry starts inside backoff.
    clock += 11;
    const retained = await staging.getSnapshot();
    expect(retained.diagnostics).toContainEqual(DEFERRED_DIAGNOSTIC);
    expect(retained.source.freshness).toBe("stale");
    expect(retained.source.refreshState).toBe("failed");
    expect(fullCalls).toBe(1);

    // After the backoff window a retry succeeds and replaces the seed.
    clock += 1_000;
    const retryRead = await staging.getSnapshot();
    expect(retryRead.diagnostics).toContainEqual(DEFERRED_DIAGNOSTIC);
    await flush();
    expect(fullCalls).toBe(2);
    await flush();

    const enriched = await staging.getSnapshot();
    expect(enriched.diagnostics).not.toContainEqual(DEFERRED_DIAGNOSTIC);
    expect(
      enriched.tasks.find((task) => task.id === "temp-recent")?.tokenUsage,
    ).toMatchObject({ contextTokens: 64_000 });
  });

  it("replaces deferred metadata with the full enrichment", async () => {
    const clock = 1_000;
    const fullGate = gate<CofficeSnapshot>();
    const staging = createCodexSnapshotStaging(
      {
        buildFull: async () => await fullGate.promise,
        buildDeferred: async () =>
          buildSnapshotFromSource(deferredSourceFixture(), FIXED_NOW),
      },
      {
        freshForMs: 10_000,
        retryAfterMs: 5_000,
        coldWaitMs: 30_000,
        now: () => clock,
      },
    );

    const seeded = await staging.getSnapshot();
    const seededTask = seeded.tasks.find((task) => task.id === "temp-recent");
    expect(seededTask?.tokenUsage).toBeUndefined();

    fullGate.resolve(buildSnapshotFromSource(sourceFixture(), FIXED_NOW));
    await flush();

    const enriched = await staging.getSnapshot();
    const enrichedTask = enriched.tasks.find(
      (task) => task.id === "temp-recent",
    );
    expect(enrichedTask?.tokenUsage).toMatchObject({
      contextTokens: 64_000,
    });
    expect(enrichedTask?.updatedAt).toBe("2026-07-13T11:59:00.000Z");
    expect(enriched.diagnostics).not.toContainEqual(DEFERRED_DIAGNOSTIC);
  });
});
