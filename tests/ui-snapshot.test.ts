import { describe, expect, it } from "vitest";

import {
  decodeSnapshot,
  markProjectsStale,
} from "../src/components/coffice-app";

const observedAt = "2026-07-14T10:00:00.000Z";

function snapshotWithRefreshState(
  refreshState: "refreshing" | "stale" | "failed",
) {
  return {
    generatedAt: observedAt,
    source: {
      health: "connected",
      freshness: "stale",
      refreshState,
      cacheAgeMs: 12_000,
      lastRefreshSuccessAt: observedAt,
    },
    projects: [{ id: "project-1", name: "Project one", order: 0 }],
    tasks: [
      {
        id: "task-1",
        projectId: "project-1",
        title: "Synthetic task",
        status: {
          value: "active",
          provenance: "observed",
          source: "synthetic:event",
          timestamp: observedAt,
          stale: false,
        },
        tokenUsage: {
          contextTokens: 10,
          contextWindow: 100,
          source: "synthetic:token-count",
          timestamp: observedAt,
          stale: false,
        },
      },
    ],
    diagnostics: [],
  };
}

describe("UI snapshot freshness", () => {
  it.each([
    ["explicit_project", undefined],
    ["explicit_unassigned", "project-1"],
    ["explicit_unknown_project", "project-1"],
  ] as const)(
    "fails closed for contradictory %s assignment metadata",
    (assignmentEvidence, projectId) => {
      const input = snapshotWithRefreshState("refreshing");
      Object.assign(input.tasks[0], { assignmentEvidence, projectId });

      const decodedTask = decodeSnapshot(input)
        .projects.flatMap((project) => project.tasks)
        .find((task) => task.id === "task-1");
      expect(decodedTask?.assignmentEvidence).toBe("cwd_fallback");
    },
  );

  it("downgrades an explicit assignment to an unknown project", () => {
    const input = snapshotWithRefreshState("refreshing");
    Object.assign(input.tasks[0], {
      assignmentEvidence: "explicit_project",
      projectId: "missing-project",
    });

    const decoded = decodeSnapshot(input);
    const heldTask = decoded.projects
      .find((project) => project.holding)
      ?.tasks.find((task) => task.id === "task-1");
    expect(heldTask).toMatchObject({
      assignmentEvidence: "explicit_unknown_project",
    });
    expect(heldTask?.projectId).toBeUndefined();
  });

  it("preserves task evidence during ordinary background revalidation", () => {
    const snapshot = decodeSnapshot(snapshotWithRefreshState("refreshing"));

    expect(snapshot.sourceFreshness).toBe("stale");
    expect(snapshot.refreshState).toBe("refreshing");
    expect(snapshot.projects[0].tasks[0].status.stale).toBe(false);
    expect(snapshot.projects[0].tasks[0].assignmentSourceFresh).toBe(true);
    expect(snapshot.projects[0].tasks[0].tokenUsage?.stale).toBe(false);
  });

  it.each(["stale", "failed"] as const)(
    "marks retained task evidence stale when refresh state is %s",
    (refreshState) => {
      const snapshot = decodeSnapshot(snapshotWithRefreshState(refreshState));

      expect(snapshot.projects[0].tasks[0].status.stale).toBe(true);
      expect(snapshot.projects[0].tasks[0].assignmentSourceFresh).toBe(false);
      expect(snapshot.projects[0].tasks[0].tokenUsage?.stale).toBe(true);
    },
  );

  it.each([undefined, "future-status"])(
    "fails closed when task status is %s",
    (value) => {
      const input = snapshotWithRefreshState("refreshing");
      input.tasks[0].status = {
        value: value as string,
        provenance: undefined as unknown as string,
        source: "synthetic:event",
        timestamp: observedAt,
        stale: false,
      };

      const status = decodeSnapshot(input).projects[0].tasks[0].status;
      expect(status).toMatchObject({
        value: "unknown",
        evidence: "inferred",
        stale: true,
      });
    },
  );

  it("decodes bounded privacy-safe repository evidence", () => {
    const input = snapshotWithRefreshState("refreshing");
    input.projects[0] = {
      ...input.projects[0],
      repository: {
        availability: "available",
        branch: "main",
        headOid: "0123456789abcdef0123456789abcdef01234567",
        headState: "commit",
        changedFiles: 2,
        stagedFiles: 1,
        untrackedFiles: 1,
        conflictedFiles: 0,
        ahead: 1,
        behind: 0,
        clean: false,
        changeAreas: {
          totalFiles: 2,
          summarizedFiles: 2,
          omittedFiles: 0,
          areas: [
            { area: "Source", files: 1 },
            { area: "Tests", files: 1 },
          ],
        },
        diffStats: {
          trackedFiles: 1,
          additions: 8,
          deletions: 2,
          binaryFiles: 0,
          source: "git:diff-numstat",
        },
        source: "git:status-porcelain-v2",
        observedAt,
      },
    } as (typeof input.projects)[number];

    const decoded = decodeSnapshot(input).projects[0];
    expect(decoded.repositoryEvidenceState).toBe("refreshing");
    expect(decoded.repository).toMatchObject({
      availability: "available",
      branch: "main",
      headOid: "0123456789abcdef0123456789abcdef01234567",
      changeAreas: { totalFiles: 2, summarizedFiles: 2 },
      diffStats: { additions: 8, deletions: 2 },
    });
    expect(decoded.repositoryRoots).toEqual([
      expect.objectContaining({
        role: "primary",
        evidenceState: "refreshing",
        evidence: decoded.repository,
      }),
    ]);
  });

  it("decodes ordered path-free repository roots without merging their evidence", () => {
    const input = snapshotWithRefreshState("refreshing");
    const primary = {
      availability: "available" as const,
      branch: "main",
      headOid: "0123456789abcdef0123456789abcdef01234567",
      headState: "commit" as const,
      changedFiles: 2,
      stagedFiles: 1,
      untrackedFiles: 1,
      conflictedFiles: 0,
      ahead: 1,
      behind: 0,
      clean: false,
      changeAreas: {
        totalFiles: 2,
        summarizedFiles: 2,
        omittedFiles: 0,
        areas: [
          { area: "Source", files: 1 },
          { area: "Tests", files: 1 },
        ],
      },
      source: "git:status-porcelain-v2" as const,
      observedAt,
    };
    const additional = {
      availability: "available" as const,
      branch: "release",
      headOid: "fedcba9876543210fedcba9876543210fedcba98",
      headState: "commit" as const,
      changedFiles: 0,
      stagedFiles: 0,
      untrackedFiles: 0,
      conflictedFiles: 0,
      ahead: 0,
      behind: 2,
      clean: true,
      changeAreas: {
        totalFiles: 0,
        summarizedFiles: 0,
        omittedFiles: 0,
        areas: [],
      },
      source: "git:status-porcelain-v2" as const,
      observedAt,
    };
    input.projects[0] = {
      ...input.projects[0],
      repository: { ...primary, branch: "legacy-alias-canary" },
      repositoryRoots: [
        { role: "primary", evidence: primary },
        {
          role: "additional",
          evidence: { ...additional, path: "PRIVATE_ADDITIONAL_PATH_CANARY" },
        },
      ],
    } as (typeof input.projects)[number];

    const decoded = decodeSnapshot(input).projects[0];

    expect(decoded.repository).toMatchObject({
      branch: "main",
      changedFiles: 2,
    });
    expect(decoded.repositoryRoots).toEqual([
      expect.objectContaining({
        role: "primary",
        evidenceState: "refreshing",
        evidence: expect.objectContaining({ branch: "main", changedFiles: 2 }),
      }),
      expect.objectContaining({
        role: "additional",
        evidenceState: "refreshing",
        evidence: expect.objectContaining({
          branch: "release",
          changedFiles: 0,
        }),
      }),
    ]);
    expect(JSON.stringify(decoded)).not.toContain("legacy-alias-canary");
    expect(JSON.stringify(decoded)).not.toContain(
      "PRIVATE_ADDITIONAL_PATH_CANARY",
    );
  });

  it("preserves malformed and cold root slots without resurrecting the legacy alias", () => {
    const input = snapshotWithRefreshState("refreshing");
    const legacyPrimary = {
      availability: "available" as const,
      branch: "legacy-alias-canary",
      headOid: "0123456789abcdef0123456789abcdef01234567",
      headState: "commit" as const,
      changedFiles: 0,
      stagedFiles: 0,
      untrackedFiles: 0,
      conflictedFiles: 0,
      ahead: 0,
      behind: 0,
      clean: true,
      changeAreas: {
        totalFiles: 0,
        summarizedFiles: 0,
        omittedFiles: 0,
        areas: [],
      },
      source: "git:status-porcelain-v2" as const,
      observedAt,
    };
    input.projects[0] = {
      ...input.projects[0],
      repository: legacyPrimary,
      repositoryRoots: [
        {
          role: "primary",
          evidence: {
            ...legacyPrimary,
            headOid: "not-an-oid",
            path: "PRIVATE_ROOT_CANARY",
          },
        },
        { role: "additional" },
      ],
    } as (typeof input.projects)[number];

    const decoded = decodeSnapshot(input).projects[0];

    expect(decoded.repositoryRoots).toEqual([
      {
        role: "primary",
        evidenceState: "refreshing",
      },
      { role: "additional", evidenceState: "refreshing" },
    ]);
    expect(decoded.repositoryRoots).toHaveLength(2);
    expect(decoded.repository).toBeUndefined();
    expect(decoded.repositoryEvidenceState).toBe("refreshing");
    expect(JSON.stringify(decoded)).not.toContain("PRIVATE_ROOT_CANARY");
    expect(JSON.stringify(decoded)).not.toContain("legacy-alias-canary");
  });

  it("decodes bounded-out inventory without retaining contradictory evidence", () => {
    const input = snapshotWithRefreshState("refreshing");
    input.projects[0] = {
      ...input.projects[0],
      repositoryRootCount: 25,
      repositoryCollectionState: "bounded_out",
      repository: {
        availability: "unavailable",
        source: "git",
        observedAt,
        path: "PRIVATE_BOUNDED_ALIAS_CANARY",
      },
      repositoryRoots: [
        {
          role: "primary",
          evidence: {
            availability: "unavailable",
            source: "git",
            observedAt,
            path: "PRIVATE_BOUNDED_ROOT_CANARY",
          },
        },
      ],
    } as (typeof input.projects)[number];

    const decoded = decodeSnapshot(input).projects[0];

    expect(decoded).toMatchObject({
      repositoryRootCount: 25,
      repositoryCollectionState: "bounded_out",
      repository: undefined,
      repositoryRoots: undefined,
      repositoryEvidenceState: "unavailable",
    });
    expect(JSON.stringify(decoded)).not.toContain("PRIVATE_BOUNDED");
  });

  it("uses the authoritative array length and rejects a zero bounded count", () => {
    const input = snapshotWithRefreshState("refreshing");
    input.projects[0] = {
      ...input.projects[0],
      repositoryRootCount: 99,
      repositoryRoots: [{ role: "primary" }, { role: "additional" }],
    } as (typeof input.projects)[number];
    const admitted = decodeSnapshot(input).projects[0];
    expect(admitted.repositoryRootCount).toBe(2);

    input.projects[0] = {
      ...input.projects[0],
      repositoryRootCount: 0,
      repositoryCollectionState: "bounded_out",
      repository: {
        availability: "unavailable",
        source: "git",
        observedAt,
        path: "PRIVATE_INVALID_BOUNDED_ALIAS",
      },
      repositoryRoots: [
        {
          role: "primary",
          evidence: {
            availability: "unavailable",
            source: "git",
            observedAt,
            path: "PRIVATE_INVALID_BOUNDED_ROOT",
          },
        },
      ],
    } as (typeof input.projects)[number];
    const malformedBounded = decodeSnapshot(input).projects[0];
    expect(malformedBounded.repositoryRootCount).toBeUndefined();
    expect(malformedBounded.repositoryCollectionState).toBeUndefined();
    expect(malformedBounded.repository).toBeUndefined();
    expect(malformedBounded.repositoryRoots).toBeUndefined();
    expect(JSON.stringify(malformedBounded)).not.toContain("PRIVATE_INVALID");
  });

  it("compacts an oversized raw root array before decoding any slot", () => {
    const input = snapshotWithRefreshState("refreshing");
    input.projects[0] = {
      ...input.projects[0],
      repository: {
        availability: "unavailable",
        source: "git",
        observedAt,
        path: "PRIVATE_OVERSIZED_ALIAS_CANARY",
      },
      repositoryRoots: Array.from({ length: 65 }, (_, index) => ({
        role: index === 0 ? "primary" : "additional",
        evidence: {
          availability: "unavailable",
          source: "git",
          observedAt,
          path: `PRIVATE_OVERSIZED_ROOT_CANARY_${index}`,
        },
      })),
    } as (typeof input.projects)[number];

    const decoded = decodeSnapshot(input).projects[0];

    expect(decoded).toMatchObject({
      repositoryRootCount: 65,
      repositoryCollectionState: "bounded_out",
      repository: undefined,
      repositoryRoots: undefined,
    });
    expect(JSON.stringify(decoded)).not.toContain("PRIVATE_OVERSIZED");
  });

  it("fails malformed repository evidence closed instead of inventing counters", () => {
    const input = snapshotWithRefreshState("refreshing");
    input.projects[0] = {
      ...input.projects[0],
      repository: {
        availability: "available",
        branch: "main",
        headOid: "not-an-oid",
        headState: "commit",
        changedFiles: "2",
        source: "git:status-porcelain-v2",
        observedAt,
      },
    } as (typeof input.projects)[number];

    const decoded = decodeSnapshot(input).projects[0];
    expect(decoded.repository).toBeUndefined();
    expect(decoded.repositoryEvidenceState).toBe("unavailable");
  });

  it("fails repository freshness closed when the source envelope is malformed", () => {
    const input = snapshotWithRefreshState("refreshing");
    input.source = {} as typeof input.source;
    input.projects[0] = {
      ...input.projects[0],
      repository: {
        availability: "available",
        branch: "main",
        headOid: "0123456789abcdef0123456789abcdef01234567",
        headState: "commit",
        changedFiles: 0,
        stagedFiles: 0,
        untrackedFiles: 0,
        conflictedFiles: 0,
        ahead: 0,
        behind: 0,
        clean: true,
        changeAreas: {
          totalFiles: 0,
          summarizedFiles: 0,
          omittedFiles: 0,
          areas: [],
        },
        source: "git:status-porcelain-v2",
        observedAt,
      },
    } as (typeof input.projects)[number];

    const decoded = decodeSnapshot(input);

    expect(decoded).toMatchObject({
      sourceHealth: "disconnected",
      sourceFreshness: "stale",
      refreshState: "failed",
    });
    expect(decoded.projects[0].repositoryEvidenceState).toBe("stale");
  });

  it("marks retained repository evidence stale after a feed failure", () => {
    const input = snapshotWithRefreshState("refreshing");
    input.projects[0] = {
      ...input.projects[0],
      repository: {
        availability: "available",
        branch: "main",
        headOid: "0123456789abcdef0123456789abcdef01234567",
        headState: "commit",
        changedFiles: 0,
        stagedFiles: 0,
        untrackedFiles: 0,
        conflictedFiles: 0,
        ahead: 0,
        behind: 0,
        clean: true,
        changeAreas: {
          totalFiles: 0,
          summarizedFiles: 0,
          omittedFiles: 0,
          areas: [],
        },
        source: "git:status-porcelain-v2",
        observedAt,
      },
    } as (typeof input.projects)[number];
    const project = decodeSnapshot(input).projects[0];

    expect(markProjectsStale([project])[0]).toMatchObject({
      repositoryEvidenceState: "stale",
      tasks: [
        {
          status: { stale: true },
          tokenUsage: { stale: true },
        },
      ],
    });
  });

  it("rejects internally inconsistent repository aggregates", () => {
    const input = snapshotWithRefreshState("refreshing");
    input.projects[0] = {
      ...input.projects[0],
      repository: {
        availability: "available",
        branch: "main",
        headOid: "0123456789abcdef0123456789abcdef01234567",
        headState: "commit",
        changedFiles: 1,
        stagedFiles: 0,
        untrackedFiles: 0,
        conflictedFiles: 0,
        ahead: 0,
        behind: 0,
        clean: false,
        changeAreas: {
          totalFiles: 1,
          summarizedFiles: 1,
          omittedFiles: 0,
          areas: [{ area: "Source", files: 1 }],
        },
        diffStats: {
          trackedFiles: 1,
          additions: 1,
          deletions: 0,
          binaryFiles: 2,
          source: "git:diff-numstat",
        },
        source: "git:status-porcelain-v2",
        observedAt,
      },
    } as (typeof input.projects)[number];

    expect(decodeSnapshot(input).projects[0]).toMatchObject({
      repository: undefined,
      repositoryEvidenceState: "unavailable",
    });
  });
});
