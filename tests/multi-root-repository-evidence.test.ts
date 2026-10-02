import { describe, expect, it, vi } from "vitest";

import {
  enrichProjectRepositories,
  type CodexSourceSnapshot,
  type SourceProject,
} from "../src/lib/codex-source";
import type { RepositoryEvidence } from "../src/lib/domain";
import { buildSnapshotFromSource } from "../src/lib/snapshot";

const NOW = "2026-08-13T08:00:00.000Z";

function project(
  id: string,
  rootPaths: string[],
  repository?: RepositoryEvidence,
): SourceProject {
  return {
    id,
    name: `Project ${id}`,
    rootPath: rootPaths[0]!,
    rootPaths,
    order: 0,
    ...(repository ? { repository } : {}),
  };
}

function available(branch: string): RepositoryEvidence {
  return {
    availability: "available",
    branch,
    headOid: "a".repeat(40),
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
    source: "git:status-porcelain-v2",
    observedAt: NOW,
  };
}

function snapshot(projects: SourceProject[]): CodexSourceSnapshot {
  return {
    projects,
    threadRootHints: new Map(),
    threadProjectAssignments: new Map(),
    invalidThreadProjectAssignments: new Set(),
    currentAssignmentsAvailable: true,
    sessions: [],
    sessionLocations: new Map(),
    sessionMetadata: new Map(),
    diagnostics: [],
    globalStateAvailable: true,
    sessionIndexAvailable: true,
    rosterAvailable: true,
  };
}

describe("multi-root repository evidence", () => {
  it("collects every root in authoritative order under one global concurrency bound", async () => {
    const projects = [
      project("a", ["C:\\private\\a", "C:\\private\\a-two"]),
      project("b", [
        "C:\\private\\b",
        "C:\\private\\b-two",
        "C:\\private\\b-three",
      ]),
    ];
    let active = 0;
    let maximumActive = 0;
    const gates = new Map<string, () => void>();
    const reader = vi.fn(
      async (rootPath: string): Promise<RepositoryEvidence> => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => gates.set(rootPath, resolve));
        active -= 1;
        return available(`branch-${rootPath.at(-1)}`);
      },
    );
    const pending = enrichProjectRepositories(projects, reader);
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(4));
    expect(maximumActive).toBe(4);
    gates.get("C:\\private\\a")!();
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(5));
    for (const release of gates.values()) release();
    const enriched = await pending;

    expect(reader.mock.calls.map(([rootPath]) => rootPath)).toEqual([
      "C:\\private\\a",
      "C:\\private\\a-two",
      "C:\\private\\b",
      "C:\\private\\b-two",
      "C:\\private\\b-three",
    ]);
    expect(enriched[0]?.repositories?.map((item) => item.availability)).toEqual(
      ["available", "available"],
    );
    expect(enriched[1]?.repositories).toHaveLength(3);
    expect(enriched[0]?.repository).toBe(enriched[0]?.repositories?.[0]);
  });

  it("retains an unavailable slot when one root reader fails", async () => {
    const enriched = await enrichProjectRepositories(
      [project("a", ["private-one", "private-two", "private-three"])],
      async (rootPath) => {
        if (rootPath === "private-two") throw new Error("private failure");
        return available(rootPath);
      },
    );
    expect(enriched[0]?.repositories?.map((item) => item.availability)).toEqual(
      ["available", "unavailable", "available"],
    );
    expect(JSON.stringify(enriched[0]?.repositories)).not.toContain(
      "private failure",
    );
  });

  it("preserves project and root ordinals when readers finish out of order", async () => {
    const releases = new Map<string, (evidence: RepositoryEvidence) => void>();
    const pending = enrichProjectRepositories(
      [project("a", ["shared", "nested"]), project("b", ["shared", "nested"])],
      async (rootPath) =>
        await new Promise<RepositoryEvidence>((resolve) => {
          const key = `${rootPath}-${releases.size}`;
          releases.set(key, resolve);
        }),
    );
    await vi.waitFor(() => expect(releases.size).toBe(4));
    releases.get("nested-3")!(available("b-nested"));
    releases.get("shared-2")!(available("b-shared"));
    releases.get("nested-1")!(available("a-nested"));
    releases.get("shared-0")!(available("a-shared"));

    const enriched = await pending;
    expect(
      enriched.map((item) =>
        item.repositories?.map((evidence) =>
          evidence.availability === "available"
            ? evidence.branch
            : evidence.availability,
        ),
      ),
    ).toEqual([
      ["a-shared", "a-nested"],
      ["b-shared", "b-nested"],
    ]);
  });

  it("publishes ordered role and evidence only, with no root path, name, or id", () => {
    const sourceProject = project("private-project-id", [
      "C:\\secret\\primary-name",
      "D:\\secret\\additional-name",
    ]);
    sourceProject.repositories = [available("main"), available("secondary")];
    sourceProject.repository = sourceProject.repositories[0];
    const publicProject = buildSnapshotFromSource(
      snapshot([sourceProject]),
      new Date(NOW),
    ).projects[0]!;

    expect(publicProject.repositoryRoots).toEqual([
      { role: "primary", evidence: available("main") },
      { role: "additional", evidence: available("secondary") },
    ]);
    expect(publicProject.repositoryRootCount).toBe(2);
    expect(publicProject.repository).toEqual(available("main"));
    const roots = JSON.stringify(publicProject.repositoryRoots);
    expect(roots).not.toMatch(
      /secret|primary-name|additional-name|private-project-id|rootPath/iu,
    );
  });

  it("projects legacy single-root evidence as one primary slot", () => {
    const legacy = project(
      "single",
      ["C:\\private\\single"],
      available("main"),
    );
    const publicProject = buildSnapshotFromSource(
      snapshot([legacy]),
      new Date(NOW),
    ).projects[0]!;
    expect(publicProject.repository).toEqual(available("main"));
    expect(publicProject.repositoryRoots).toEqual([
      { role: "primary", evidence: available("main") },
    ]);
    expect(publicProject.repositoryRootCount).toBe(1);
  });

  it("derives the singular alias from projected primary evidence", () => {
    const mismatched = project(
      "mismatch",
      ["C:\\private\\primary"],
      available("stale-alias"),
    );
    mismatched.repositories = [available("projected-primary")];
    const publicProject = buildSnapshotFromSource(
      snapshot([mismatched]),
      new Date(NOW),
    ).projects[0]!;

    expect(publicProject.repository).toEqual(available("projected-primary"));
    expect(publicProject.repository).toEqual(
      publicProject.repositoryRoots?.[0]?.evidence,
    );
  });
});
