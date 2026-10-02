import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  discoverSessionFiles,
  MAX_GLOBAL_STATE_BYTES,
  MAX_REPOSITORY_ROOTS_PER_REFRESH,
  normalizeWindowsPath,
  parseSavedProjectsJson,
  parseSessionIndexJsonl,
  parseSessionJsonl,
  readCodexSource,
  readSessionMetadataFile,
  selectSessionSummaryJsonl,
} from "../src/lib/codex-source";
import { buildSnapshotFromSource } from "../src/lib/snapshot";

const temporaryRoots: string[] = [];

/**
 * Builds a deterministic UUIDv7 from a Unix timestamp in milliseconds. The
 * first 12 hex digits are the 48-bit timestamp; the version nibble is 7.
 */
function uuidV7FromMs(ms: number): string {
  const hex = ms.toString(16).padStart(12, "0").slice(0, 12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-8def-000000000001`;
}

function utcDayRelative(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}/${month}/${day}`;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("Codex source parsers", () => {
  it("parses and orders saved projects with stable labels", () => {
    const parsed = parseSavedProjectsJson(
      JSON.stringify({
        "electron-saved-workspace-roots": ["C:\\Work\\Beta", "C:\\Work\\Alpha"],
        "project-order": ["C:\\Work\\Alpha"],
        "electron-workspace-root-labels": { "C:\\Work\\Beta": "Beta Lab" },
        "thread-workspace-root-hints": { "thread-1": "C:\\Work\\Alpha" },
      }),
    );

    expect(parsed.projects.map(({ name, order }) => ({ name, order }))).toEqual(
      [
        { name: "Alpha", order: 0 },
        { name: "Beta Lab", order: 1 },
      ],
    );
    expect(parsed.threadRootHints.get("thread-1")).toBe("C:\\Work\\Alpha");
    expect(parsed.projects.map((project) => project.rootPaths)).toEqual([
      ["C:\\Work\\Alpha"],
      ["C:\\Work\\Beta"],
    ]);
    expect(parsed.threadProjectAssignments).toEqual(new Map());
    expect(parsed.currentAssignmentsAvailable).toBe(false);
    const sameLegacyRoot = parseSavedProjectsJson(
      JSON.stringify({
        "electron-saved-workspace-roots": ["c:\\work\\alpha\\"],
      }),
    );
    expect(sameLegacyRoot.projects[0]?.id).toBe(parsed.projects[0]?.id);
    expect(normalizeWindowsPath("\\\\?\\C:\\Work\\Alpha\\")).toBe(
      "c:\\work\\alpha",
    );
  });

  it("parses local-projects into one project per schema id", () => {
    const alphaId = "11111111-1111-4111-8111-111111111111";
    const betaId = "22222222-2222-4222-8222-222222222222";
    const parsed = parseSavedProjectsJson(
      JSON.stringify({
        "local-projects": {
          [alphaId]: {
            id: alphaId,
            name: "Alpha",
            rootPaths: ["C:\\Work\\Alpha"],
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_500_000,
          },
          [betaId]: {
            id: betaId,
            name: "Beta Lab",
            rootPaths: ["C:\\Work\\Beta", "C:\\Work\\Beta\\packages\\ui"],
            createdAt: 1_700_000_100_000,
            updatedAt: 1_700_000_600_000,
          },
        },
        "project-order": [betaId, alphaId],
        "thread-workspace-root-hints": { "thread-1": "C:\\Work\\Alpha" },
        "thread-project-assignments": {
          "thread-2": {
            projectKind: "local",
            projectId: betaId,
            cwd: "C:\\Work\\Beta\\packages\\ui",
            pendingCoreUpdate: false,
          },
          "thread-3": { projectKind: "local", projectId: alphaId },
        },
      }),
    );

    expect(
      parsed.projects.map(({ id, name, rootPath, rootPaths, order }) => ({
        id,
        name,
        rootPath,
        rootPaths,
        order,
      })),
    ).toEqual([
      {
        id: betaId,
        name: "Beta Lab",
        rootPath: "C:\\Work\\Beta",
        rootPaths: ["C:\\Work\\Beta", "C:\\Work\\Beta\\packages\\ui"],
        order: 0,
      },
      {
        id: alphaId,
        name: "Alpha",
        rootPath: "C:\\Work\\Alpha",
        rootPaths: ["C:\\Work\\Alpha"],
        order: 1,
      },
    ]);

    // Legacy projects retain their root-derived identity; the current schema
    // retains Codex's project UUID even when the root is identical.
    const legacy = parseSavedProjectsJson(
      JSON.stringify({
        "electron-saved-workspace-roots": ["C:\\Work\\Alpha"],
      }),
    );
    expect(legacy.projects[0]?.id).not.toBe(alphaId);
    expect(legacy.projects[0]?.rootPaths).toEqual(["C:\\Work\\Alpha"]);

    // Project identity is authoritative; cwd remains an independent root hint.
    expect(parsed.threadProjectAssignments).toEqual(
      new Map([
        ["thread-2", betaId],
        ["thread-3", alphaId],
      ]),
    );
    expect(parsed.currentAssignmentsAvailable).toBe(true);
    expect(parsed.threadRootHints.get("thread-2")).toBe(
      "C:\\Work\\Beta\\packages\\ui",
    );
    expect(parsed.threadRootHints.get("thread-3")).toBe("C:\\Work\\Alpha");
    expect(parsed.threadRootHints.get("thread-1")).toBe("C:\\Work\\Alpha");

    // Internal timestamps/assignment metadata must not leak into project entries.
    const serialized = JSON.stringify(parsed.projects);
    expect(serialized).not.toContain("createdAt");
    expect(serialized).not.toContain("updatedAt");
    expect(serialized).not.toContain("pendingCoreUpdate");
    expect(parsed.diagnostics).toEqual([]);
  });

  it("keeps every root inside one multi-root local project", () => {
    const parsed = parseSavedProjectsJson(
      JSON.stringify({
        "local-projects": {
          "proj-multi": {
            id: "proj-multi",
            name: "Multi",
            rootPaths: ["C:\\Work\\Multi", "C:\\Work\\Multi\\packages\\sub"],
          },
        },
        "project-order": ["proj-multi"],
      }),
    );

    expect(parsed.projects).toEqual([
      {
        id: "proj-multi",
        name: "Multi",
        rootPath: "C:\\Work\\Multi",
        rootPaths: ["C:\\Work\\Multi", "C:\\Work\\Multi\\packages\\sub"],
        order: 0,
      },
    ]);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("deduplicates normalized roots only within their owning project", () => {
    const parsed = parseSavedProjectsJson(
      JSON.stringify({
        "local-projects": {
          alpha: {
            name: "Alpha",
            rootPaths: [
              "C:\\Work\\Alpha",
              "c:\\work\\alpha\\",
              "C:\\Work\\Alpha\\packages\\ui",
            ],
          },
          beta: {
            name: "Beta",
            rootPaths: ["C:\\Work\\Alpha", "C:\\Work\\Alpha\\packages\\ui"],
          },
        },
      }),
    );

    expect(parsed.projects.map((project) => project.rootPaths)).toEqual([
      ["C:\\Work\\Alpha", "C:\\Work\\Alpha\\packages\\ui"],
      ["C:\\Work\\Alpha", "C:\\Work\\Alpha\\packages\\ui"],
    ]);
  });

  it("rejects relative or corrupt saved roots without exposing their values", () => {
    const current = parseSavedProjectsJson(
      JSON.stringify({
        "local-projects": {
          alpha: {
            rootPaths: ["relative\\root", 42, "C:\\Work\\Alpha"],
          },
        },
      }),
    );
    expect(current.projects[0]?.rootPaths).toEqual(["C:\\Work\\Alpha"]);
    expect(current.diagnostics).toContainEqual({
      code: "SAVED_PROJECT_ROOT_INVALID",
      message:
        "One or more saved Codex workspace roots were invalid and ignored.",
      severity: "warning",
      source: "global_state",
    });
    expect(JSON.stringify(current.diagnostics)).not.toContain("relative");

    const legacy = parseSavedProjectsJson(
      JSON.stringify({
        "electron-saved-workspace-roots": ["relative\\legacy"],
      }),
    );
    expect(legacy.projects).toEqual([]);
    expect(legacy.diagnostics.map((item) => item.code)).toEqual([
      "SAVED_PROJECT_ROOT_INVALID",
    ]);
  });

  it("keeps distinct schema projects that share the same root", () => {
    const parsed = parseSavedProjectsJson(
      JSON.stringify({
        "local-projects": {
          "project-one": {
            name: "One",
            rootPaths: ["C:\\Work\\Shared"],
          },
          "project-two": {
            name: "Two",
            rootPaths: ["C:\\Work\\Shared"],
          },
        },
        "thread-project-assignments": {
          "thread-one": {
            projectId: "project-one",
            cwd: "C:\\Work\\Shared\\package-one",
          },
          "thread-two": {
            projectId: "project-two",
            cwd: "C:\\Work\\Shared\\package-two",
          },
        },
      }),
    );

    expect(parsed.projects.map((project) => project.id)).toEqual([
      "project-one",
      "project-two",
    ]);
    expect(parsed.projects.map((project) => project.rootPath)).toEqual([
      "C:\\Work\\Shared",
      "C:\\Work\\Shared",
    ]);
    expect(parsed.threadProjectAssignments).toEqual(
      new Map([
        ["thread-one", "project-one"],
        ["thread-two", "project-two"],
      ]),
    );
    expect(parsed.threadRootHints).toEqual(
      new Map([
        ["thread-one", "C:\\Work\\Shared\\package-one"],
        ["thread-two", "C:\\Work\\Shared\\package-two"],
      ]),
    );
  });

  it("tracks malformed per-thread assignments without treating them as unassigned", () => {
    const parsed = parseSavedProjectsJson(
      JSON.stringify({
        "local-projects": {
          "project-one": {
            name: "One",
            rootPaths: ["C:\\Work\\One"],
          },
        },
        "thread-project-assignments": {
          valid: { projectKind: "local", projectId: "project-one" },
          "not-record": "project-one",
          missing: { projectKind: "local" },
          blank: { projectKind: "local", projectId: "   " },
          contradictory: { projectKind: "remote", projectId: "project-one" },
        },
      }),
    );

    expect(parsed.currentAssignmentsAvailable).toBe(true);
    expect(parsed.threadProjectAssignments).toEqual(
      new Map([["valid", "project-one"]]),
    );
    expect(parsed.invalidThreadProjectAssignments).toEqual(
      new Set(["not-record", "missing", "blank", "contradictory"]),
    );
    expect(parsed.diagnostics).toContainEqual({
      code: "THREAD_PROJECT_ASSIGNMENT_INVALID",
      message: "One or more Codex task project assignments were malformed.",
      severity: "warning",
      source: "global_state",
    });
    expect(JSON.stringify(parsed.diagnostics)).not.toContain("not-record");
  });

  it("skips malformed local-projects entries without a spurious global warning", () => {
    const parsed = parseSavedProjectsJson(
      JSON.stringify({
        "local-projects": {
          "proj-good": {
            id: "proj-good",
            name: "Good",
            rootPaths: ["C:\\Work\\Good"],
          },
          "proj-not-record": "just a string",
          "proj-no-roots": {
            id: "proj-no-roots",
            name: "Empty",
            rootPaths: [],
          },
          "proj-bad-root": {
            id: "proj-bad-root",
            name: "BadRoot",
            rootPaths: [42, ""],
          },
        },
      }),
    );

    expect(parsed.projects.map((project) => project.name)).toEqual(["Good"]);
    expect(parsed.projects[0]?.rootPath).toBe("C:\\Work\\Good");
    expect(parsed.diagnostics.map((item) => item.code)).toEqual([
      "SAVED_PROJECT_ROOT_INVALID",
    ]);
  });

  it("reports missing projects only when neither schema is present", () => {
    const absent = parseSavedProjectsJson(JSON.stringify({ unrelated: true }));
    expect(absent.projects).toEqual([]);
    expect(absent.diagnostics.map((item) => item.code)).toEqual([
      "SAVED_PROJECTS_MISSING",
    ]);

    const wrongShape = parseSavedProjectsJson(
      JSON.stringify({ "local-projects": ["not", "an", "object"] }),
    );
    expect(wrongShape.projects).toEqual([]);
    expect(wrongShape.diagnostics.map((item) => item.code)).toEqual([
      "SAVED_PROJECTS_MISSING",
    ]);

    const emptyCurrentAssignments = parseSavedProjectsJson(
      JSON.stringify({
        "local-projects": {},
        "thread-project-assignments": {},
      }),
    );
    expect(emptyCurrentAssignments.currentAssignmentsAvailable).toBe(true);
    expect(emptyCurrentAssignments.threadProjectAssignments).toEqual(new Map());
  });

  it("keeps global-state error diagnostics for unparseable or misshapen state", () => {
    expect(parseSavedProjectsJson("{not json").diagnostics[0]?.code).toBe(
      "GLOBAL_STATE_MALFORMED",
    );
    expect(parseSavedProjectsJson("[1,2,3]").diagnostics[0]?.code).toBe(
      "GLOBAL_STATE_UNEXPECTED_SHAPE",
    );
  });

  it("rejects over-bound global metadata before parsing or Git enrichment", async () => {
    const profileRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "coffice-bounded-global-state-"),
    );
    temporaryRoots.push(profileRoot);
    const codexRoot = path.join(profileRoot, ".codex");
    await fs.mkdir(codexRoot, { recursive: true });
    await fs.writeFile(
      path.join(codexRoot, ".codex-global-state.json"),
      "x".repeat(MAX_GLOBAL_STATE_BYTES + 1),
    );
    const repositoryReader = vi.fn(async () => {
      throw new Error("Git reader must not run");
    });
    const previousProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = profileRoot;
    try {
      const source = await readCodexSource({ repositoryReader });
      expect(source.globalStateAvailable).toBe(false);
      expect(source.projects).toEqual([]);
      expect(source.diagnostics).toContainEqual({
        code: "GLOBAL_STATE_UNAVAILABLE",
        message: "Codex global state is unavailable.",
        severity: "error",
        source: "global_state",
      });
      expect(repositoryReader).not.toHaveBeenCalled();
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
    }
  });

  it("fails an over-bound repository workload closed before every Git read", async () => {
    const profileRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "coffice-bounded-repository-work-"),
    );
    temporaryRoots.push(profileRoot);
    const codexRoot = path.join(profileRoot, ".codex");
    await fs.mkdir(codexRoot, { recursive: true });
    const firstProjectRootCount = 40;
    const projects = {
      "project-one": {
        rootPaths: Array.from(
          { length: firstProjectRootCount },
          (_, index) => `C:\\Private\\One-${index}`,
        ),
      },
      "project-two": {
        rootPaths: Array.from(
          {
            length:
              MAX_REPOSITORY_ROOTS_PER_REFRESH + 1 - firstProjectRootCount,
          },
          (_, index) => `D:\\Private\\Two-${index}`,
        ),
      },
    };
    await fs.writeFile(
      path.join(codexRoot, ".codex-global-state.json"),
      JSON.stringify({ "local-projects": projects }),
    );
    const repositoryReader = vi.fn(async () => {
      throw new Error("Git reader must not run");
    });
    const previousProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = profileRoot;
    try {
      const source = await readCodexSource({ repositoryReader });
      expect(source.projects).toHaveLength(2);
      expect(
        source.projects.map((project) => ({
          count: project.rootPaths.length,
          boundedOut: project.repositoryCollectionBoundedOut,
        })),
      ).toEqual([
        { count: firstProjectRootCount, boundedOut: true },
        {
          count: MAX_REPOSITORY_ROOTS_PER_REFRESH + 1 - firstProjectRootCount,
          boundedOut: true,
        },
      ]);
      expect(repositoryReader).not.toHaveBeenCalled();
      expect(source.diagnostics).toContainEqual({
        code: "REPOSITORY_ENRICHMENT_BOUND_EXCEEDED",
        message:
          "Repository evidence is unavailable because the source-wide collection safety bound was exceeded.",
        severity: "warning",
        source: "adapter",
      });
      expect(JSON.stringify(source.diagnostics)).not.toContain("Private");
      const publicProjects = buildSnapshotFromSource(source).projects;
      expect(
        publicProjects.map((project) => ({
          count: project.repositoryRootCount,
          state: project.repositoryCollectionState,
        })),
      ).toEqual([
        { count: firstProjectRootCount, state: "bounded_out" },
        {
          count: MAX_REPOSITORY_ROOTS_PER_REFRESH + 1 - firstProjectRootCount,
          state: "bounded_out",
        },
      ]);
      for (const project of publicProjects) {
        expect(project.repositoryRoots).toBeUndefined();
        expect(project.repository).toBeUndefined();
      }
      expect(JSON.stringify(publicProjects)).not.toMatch(
        /Private|repositoryRoots|"repository":|"evidence":/u,
      );

      repositoryReader.mockClear();
      const deferred = await readCodexSource({
        deferSessionMetadata: true,
        repositoryReader,
      });
      expect(repositoryReader).not.toHaveBeenCalled();
      expect(
        deferred.projects.map((project) => ({
          count: project.rootPaths.length,
          boundedOut: project.repositoryCollectionBoundedOut,
        })),
      ).toEqual([
        { count: firstProjectRootCount, boundedOut: true },
        {
          count: MAX_REPOSITORY_ROOTS_PER_REFRESH + 1 - firstProjectRootCount,
          boundedOut: true,
        },
      ]);
      expect(deferred.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "REPOSITORY_ENRICHMENT_BOUND_EXCEEDED",
        }),
      );
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
    }
  });

  it("does not inspect cwd for a rejected relative saved root", async () => {
    const profileRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "coffice-invalid-repository-root-"),
    );
    temporaryRoots.push(profileRoot);
    const codexRoot = path.join(profileRoot, ".codex");
    await fs.mkdir(codexRoot, { recursive: true });
    await fs.writeFile(
      path.join(codexRoot, ".codex-global-state.json"),
      JSON.stringify({
        "local-projects": { unsafe: { rootPaths: ["relative-root"] } },
      }),
    );
    const repositoryReader = vi.fn(async () => {
      throw new Error("Git reader must not run");
    });
    const previousProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = profileRoot;
    try {
      const source = await readCodexSource({ repositoryReader });
      expect(source.projects).toEqual([]);
      expect(repositoryReader).not.toHaveBeenCalled();
      expect(source.diagnostics).toContainEqual(
        expect.objectContaining({ code: "SAVED_PROJECT_ROOT_INVALID" }),
      );
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
    }
  });

  it("isolates malformed session-index records", () => {
    const parsed = parseSessionIndexJsonl(
      [
        JSON.stringify({
          id: "one",
          thread_name: "Safe title",
          updated_at: "2026-07-13T10:00:00Z",
        }),
        "{broken",
        JSON.stringify({
          id: "two",
          thread_name: "Newer",
          updated_at: "2026-07-13T11:00:00Z",
        }),
      ].join("\n"),
    );

    expect(parsed.records.map((record) => record.id)).toEqual(["two", "one"]);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]?.code).toBe("SESSION_INDEX_RECORD_SKIPPED");
  });

  it("extracts only metadata and conservative status events from sessions", () => {
    const parsed = parseSessionJsonl(
      [
        JSON.stringify({
          timestamp: "2026-07-13T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "thread-1",
            cwd: "C:\\Work\\Alpha",
            timestamp: "2026-07-13T10:00:00Z",
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-13T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: "private prompt must not escape",
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-13T10:00:02Z",
          type: "turn_context",
          payload: { model: "synthetic-model", cwd: "C:\\Work\\Alpha" },
        }),
        JSON.stringify({
          timestamp: "2026-07-13T10:00:03Z",
          type: "event_msg",
          payload: {
            type: "agent_reasoning",
            text: "private reasoning must not escape",
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-13T10:00:04Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: { total_tokens: 32_000 },
              total_token_usage: { total_tokens: 48_000 },
              model_context_window: 128_000,
            },
          },
        }),
      ].join("\n"),
      "thread-1",
    );

    expect(parsed.metadata).toMatchObject({
      id: "thread-1",
      cwd: "C:\\Work\\Alpha",
      model: "synthetic-model",
      startedAt: "2026-07-13T10:00:00.000Z",
      events: [
        { type: "agent_reasoning", timestamp: "2026-07-13T10:00:03.000Z" },
      ],
      tokenUsage: {
        contextTokens: 32_000,
        contextWindow: 128_000,
        cumulativeTokens: 48_000,
        timestamp: "2026-07-13T10:00:04.000Z",
      },
    });
    expect(JSON.stringify(parsed.metadata)).not.toContain("private");
  });

  it("extracts the expanded structural activity vocabulary without content", () => {
    const eventTypes = [
      "user_message",
      "turn_started",
      "plan_update",
      "web_search_begin",
      "web_search_end",
      "mcp_tool_call_begin",
      "mcp_tool_call_end",
      "exec_command_begin",
      "exec_command_end",
      "patch_apply_begin",
      "patch_apply_end",
      "entered_review_mode",
      "exited_review_mode",
      "request_user_input",
      "elicitation_request",
      "error",
      "turn_complete",
    ];
    const parsed = parseSessionJsonl(
      eventTypes
        .map((type, index) =>
          JSON.stringify({
            timestamp: new Date(
              Date.parse("2026-07-14T02:00:00Z") + index * 1_000,
            ).toISOString(),
            type: "event_msg",
            payload: { type, text: `private-${type}` },
          }),
        )
        .join("\n"),
      "expanded-events",
    );

    expect(parsed.metadata.events.map((event) => event.type)).toEqual(
      eventTypes,
    );
    expect(parsed.metadata.startedAt).toBe("2026-07-14T02:00:01.000Z");
    expect(JSON.stringify(parsed.metadata)).not.toContain("private-");
  });

  it("retains only structural terminal impact for completion and error events", () => {
    const records = [
      {
        type: "turn_complete",
        last_agent_message: "private-success",
        error: null,
      },
      {
        type: "turn_complete",
        error: { message: "private-terminal" },
      },
      { type: "error", message: "private-generic" },
      {
        type: "error",
        message: "private-rollback",
        codex_error_info: "thread_rollback_failed",
      },
      {
        type: "error",
        message: "private-steering",
        codex_error_info: {
          active_turn_not_steerable: { turn_kind: "review" },
        },
      },
    ];
    const parsed = parseSessionJsonl(
      records
        .map((payload, index) =>
          JSON.stringify({
            timestamp: new Date(
              Date.parse("2026-07-14T02:30:00Z") + index * 1_000,
            ).toISOString(),
            type: "event_msg",
            payload,
          }),
        )
        .join("\n"),
      "terminal-impact",
    );

    expect(parsed.metadata.events).toEqual([
      { type: "turn_complete", timestamp: "2026-07-14T02:30:00.000Z" },
      {
        type: "turn_complete",
        timestamp: "2026-07-14T02:30:01.000Z",
        affectsTurnStatus: true,
      },
      {
        type: "error",
        timestamp: "2026-07-14T02:30:02.000Z",
        affectsTurnStatus: true,
      },
      {
        type: "error",
        timestamp: "2026-07-14T02:30:03.000Z",
        affectsTurnStatus: false,
      },
      {
        type: "error",
        timestamp: "2026-07-14T02:30:04.000Z",
        affectsTurnStatus: false,
      },
    ]);
    expect(JSON.stringify(parsed.metadata)).not.toContain("private-");
  });

  it("prefilters large irrelevant records while tolerating reordered safe keys", () => {
    const largeIrrelevantRecord = `{ "type" : "response_item", "payload": "${"x".repeat(2_000_000)}`;
    const parsed = parseSessionJsonl(
      [
        largeIrrelevantRecord,
        JSON.stringify({
          payload: { cwd: "C:\\Synthetic\\Reordered", id: "reordered" },
          timestamp: "2026-07-14T02:00:00Z",
          type: "session_meta",
        }),
        `{ "payload" : { "model" : "safe-model" }, "type" : "turn_context", "timestamp" : "2026-07-14T02:00:01Z" }`,
        `{ "payload" : { "type" : "task_complete" }, "timestamp" : "2026-07-14T02:00:02Z", "type" : "event_msg" }`,
      ].join("\n"),
      "reordered",
    );

    expect(parsed.metadata).toMatchObject({
      id: "reordered",
      cwd: "C:\\Synthetic\\Reordered",
      model: "safe-model",
      lastEventAt: "2026-07-14T02:00:02.000Z",
      events: [
        { type: "task_complete", timestamp: "2026-07-14T02:00:02.000Z" },
      ],
    });
    expect(parsed.diagnostics).toEqual([]);
  });

  it("skips deep validation for irrelevant event payloads", () => {
    const parsed = parseSessionJsonl(
      JSON.stringify({
        timestamp: "2026-07-14T02:30:00Z",
        type: "event_msg",
        payload: {
          type: "item_completed",
          private_content: "x".repeat(2_000_000),
        },
      }),
      "irrelevant-event",
    );

    expect(parsed.metadata.events).toEqual([]);
    expect(parsed.metadata.lastEventAt).toBeUndefined();
    expect(parsed.diagnostics).toEqual([]);
  });

  it("skips deep validation for oversized content-bearing status events", () => {
    const parsed = parseSessionJsonl(
      JSON.stringify({
        timestamp: "2026-07-14T02:31:00Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          private_content: "x".repeat(2_000_000),
        },
      }),
      "large-agent-message",
    );

    expect(parsed.metadata.events).toEqual([]);
    expect(parsed.metadata.lastEventAt).toBeUndefined();
    expect(parsed.diagnostics).toEqual([]);
  });

  it("selects only bounded latest evidence for production enrichment", () => {
    const records = [
      JSON.stringify({
        timestamp: "2026-07-14T01:00:00Z",
        type: "session_meta",
        payload: { id: "summary", cwd: "C:\\Work\\Summary" },
      }),
      JSON.stringify({
        timestamp: "2026-07-14T01:01:00Z",
        type: "event_msg",
        payload: { type: "turn_started" },
      }),
      JSON.stringify({
        timestamp: "2026-07-14T01:02:00Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "x".repeat(50_000) },
      }),
      JSON.stringify({
        timestamp: "2026-07-14T01:03:00Z",
        type: "turn_context",
        payload: { model: "summary-model" },
      }),
      JSON.stringify({
        timestamp: "2026-07-14T01:04:00Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { total_tokens: 1_000 },
            model_context_window: 128_000,
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-14T01:05:00Z",
        type: "event_msg",
        payload: { type: "turn_complete" },
      }),
    ];
    const summary = selectSessionSummaryJsonl(records.join("\n"));
    const parsed = parseSessionJsonl(summary, "summary");

    expect(summary).not.toContain("x".repeat(100));
    expect(parsed.metadata).toMatchObject({
      cwd: "C:\\Work\\Summary",
      model: "summary-model",
      lastEventAt: "2026-07-14T01:05:00.000Z",
      events: [
        { type: "turn_complete", timestamp: "2026-07-14T01:05:00.000Z" },
      ],
      tokenUsage: { contextTokens: 1_000, contextWindow: 128_000 },
    });
  });

  it("shallow-reads large status events without following nested type decoys", () => {
    const privateText = `private-${"x".repeat(2_000_000)}`;
    const parsed = parseSessionJsonl(
      JSON.stringify({
        payload: {
          nested: { type: "task_complete" },
          text: privateText,
          type: "agent_reasoning",
        },
        timestamp: "2026-07-14T03:00:00Z",
        type: "event_msg",
      }),
      "large-event",
    );

    expect(parsed.metadata).toMatchObject({
      lastEventAt: "2026-07-14T03:00:00.000Z",
      events: [
        { type: "agent_reasoning", timestamp: "2026-07-14T03:00:00.000Z" },
      ],
    });
    expect(JSON.stringify(parsed.metadata)).not.toContain("private-");
    expect(parsed.diagnostics).toEqual([]);
  });

  it("falls back to the diagnostic parser when event metadata is ambiguous", () => {
    const parsed = parseSessionJsonl(
      `{ "type": "event_msg", "timestamp": "2026-07-14T03:00:00Z", "payload": { "type":`,
      "ambiguous-event",
    );

    expect(parsed.metadata.events).toEqual([]);
    expect(parsed.diagnostics[0]?.code).toBe("SESSION_RECORD_SKIPPED");
  });

  it("does not accept a truncated large status event as observed", () => {
    const complete = JSON.stringify({
      timestamp: "2026-07-14T03:00:00Z",
      type: "event_msg",
      payload: {
        type: "agent_reasoning",
        text: "x".repeat(500_000),
      },
    });
    const parsed = parseSessionJsonl(complete.slice(0, -1), "truncated-event");

    expect(parsed.metadata.events).toEqual([]);
    expect(parsed.metadata.lastEventAt).toBeUndefined();
    expect(parsed.diagnostics[0]?.code).toBe("SESSION_RECORD_SKIPPED");
  });

  it.each([
    [
      "missing comma",
      `{"timestamp":"2026-07-14T03:00:00Z","type":"event_msg","payload":{"type":"agent_reasoning" "text":"x"}}`,
    ],
    [
      "invalid token",
      `{"timestamp":"2026-07-14T03:00:00Z","type":"event_msg","payload":{"type":"agent_reasoning","value":wat}}`,
    ],
    [
      "invalid escape",
      `{"timestamp":"2026-07-14T03:00:00Z","type":"event_msg","payload":{"type":"agent_reasoning","text":"\\q"}}`,
    ],
    [
      "trailing junk",
      `{"timestamp":"2026-07-14T03:00:00Z","type":"event_msg","payload":{"type":"agent_reasoning"}} trailing`,
    ],
  ])("rejects %s before shallow status acceptance", (_name, line) => {
    const parsed = parseSessionJsonl(line, "invalid-status-event");

    expect(parsed.metadata.events).toEqual([]);
    expect(parsed.metadata.lastEventAt).toBeUndefined();
    expect(parsed.diagnostics[0]?.code).toBe("SESSION_RECORD_SKIPPED");
  });

  it("discovers only allowlisted session UUIDs without preferring archives", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coffice-source-"));
    temporaryRoots.push(root);
    const liveDirectory = path.join(root, "sessions", "2026", "07", "14");
    const archivedDirectory = path.join(root, "archived_sessions");
    await fs.mkdir(liveDirectory, { recursive: true });
    await fs.mkdir(archivedDirectory, { recursive: true });

    const liveId = "11111111-1111-4111-8111-111111111111";
    const archivedId = "22222222-2222-4222-8222-222222222222";
    const irrelevantId = "33333333-3333-4333-8333-333333333333";
    const fileName = (id: string) => `rollout-2026-07-14T00-00-00-${id}.jsonl`;

    await Promise.all([
      fs.writeFile(path.join(liveDirectory, fileName(liveId)), ""),
      fs.writeFile(path.join(liveDirectory, fileName(irrelevantId)), ""),
      fs.writeFile(path.join(archivedDirectory, fileName(liveId)), ""),
      fs.writeFile(path.join(archivedDirectory, fileName(archivedId)), ""),
    ]);

    const files = await discoverSessionFiles(
      root,
      new Set([liveId, archivedId]),
    );

    expect(files.map((file) => file.sessionId)).toEqual([liveId, archivedId]);
    expect(files.map((file) => file.location)).toEqual(["live", "archived"]);
    expect(files[0]?.filePath).toContain(`${path.sep}sessions${path.sep}`);
    expect(files.some((file) => file.filePath.includes(irrelevantId))).toBe(
      false,
    );
  });

  it("discovers a UUIDv7 session via the direct-date fast path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coffice-source-"));
    temporaryRoots.push(root);
    const ms = Date.UTC(2026, 6, 14, 0, 0, 0);
    const v7Id = uuidV7FromMs(ms);
    const dayDirectory = utcDayRelative(ms);
    const liveDirectory = path.join(root, "sessions", dayDirectory);
    await fs.mkdir(liveDirectory, { recursive: true });

    // A distractor in an unrelated day and a non-v7 id must not be resolved by
    // the fast path.
    const unrelatedDay = path.join(root, "sessions", "2025", "01", "02");
    await fs.mkdir(unrelatedDay, { recursive: true });
    const unrelatedV7 = uuidV7FromMs(Date.UTC(2025, 0, 2, 0, 0, 0));
    const nonV7Id = "44444444-4444-4444-8444-444444444444";
    await fs.writeFile(path.join(liveDirectory, `rollout-${v7Id}.jsonl`), "");
    await fs.writeFile(
      path.join(unrelatedDay, `rollout-${unrelatedV7}.jsonl`),
      "",
    );
    await fs.writeFile(
      path.join(liveDirectory, `rollout-${nonV7Id}.jsonl`),
      "",
    );

    const files = await discoverSessionFiles(root, new Set([v7Id]));

    expect(files.map((file) => file.sessionId)).toEqual([v7Id]);
    expect(files[0]?.location).toBe("live");
    expect(files[0]?.filePath).toContain(
      path.join("sessions", ...dayDirectory.split("/")),
    );
  });

  it("discovers a UUIDv7 session from the flat archived_sessions directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coffice-source-"));
    temporaryRoots.push(root);
    const ms = Date.UTC(2026, 6, 14, 0, 0, 0);
    const v7Id = uuidV7FromMs(ms);
    const archivedDirectory = path.join(root, "archived_sessions");
    await fs.mkdir(archivedDirectory, { recursive: true });
    await fs.writeFile(
      path.join(archivedDirectory, `rollout-${v7Id}.jsonl`),
      "",
    );

    const files = await discoverSessionFiles(root, new Set([v7Id]));

    expect(files.map((file) => file.sessionId)).toEqual([v7Id]);
    expect(files[0]?.location).toBe("archived");
    expect(files[0]?.filePath).toContain(path.join("archived_sessions"));
  });

  it("falls back to the recursive scan for non-v7 ids", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coffice-source-"));
    temporaryRoots.push(root);
    const nonV7Id = "55555555-5555-4555-8555-555555555555";
    const liveDirectory = path.join(root, "sessions", "2026", "07", "14");
    await fs.mkdir(liveDirectory, { recursive: true });
    await fs.writeFile(
      path.join(liveDirectory, `rollout-${nonV7Id}.jsonl`),
      "",
    );

    const files = await discoverSessionFiles(root, new Set([nonV7Id]));

    expect(files.map((file) => file.sessionId)).toEqual([nonV7Id]);
    expect(files[0]?.filePath).toContain(`${path.sep}sessions${path.sep}`);
  });

  it("does not duplicate a session found in both live and archived trees", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coffice-source-"));
    temporaryRoots.push(root);
    const ms = Date.UTC(2026, 6, 14, 0, 0, 0);
    const v7Id = uuidV7FromMs(ms);
    const dayDirectory = utcDayRelative(ms);
    const liveDirectory = path.join(root, "sessions", dayDirectory);
    const archivedDirectory = path.join(root, "archived_sessions");
    await fs.mkdir(liveDirectory, { recursive: true });
    await fs.mkdir(archivedDirectory, { recursive: true });
    await fs.writeFile(path.join(liveDirectory, `rollout-${v7Id}.jsonl`), "");
    await fs.writeFile(
      path.join(archivedDirectory, `rollout-${v7Id}.jsonl`),
      "",
    );

    const files = await discoverSessionFiles(root, new Set([v7Id]));

    expect(files.map((file) => file.sessionId)).toEqual([v7Id]);
    expect(files[0]?.location).toBe("live");
    expect(files[0]?.filePath).toContain(`${path.sep}sessions${path.sep}`);
  });

  it("tolerates missing candidate day directories and empty results", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coffice-source-"));
    temporaryRoots.push(root);
    const ms = Date.UTC(2026, 6, 14, 0, 0, 0);
    const v7Id = uuidV7FromMs(ms);
    const archivedDirectory = path.join(root, "archived_sessions");
    await fs.mkdir(archivedDirectory, { recursive: true });

    // No matching sessions/YYYY/MM/DD directory exists for this id; discovery
    // must not throw and must still return the archived copy.
    await fs.writeFile(
      path.join(archivedDirectory, `rollout-${v7Id}.jsonl`),
      "",
    );
    const files = await discoverSessionFiles(root, new Set([v7Id]));
    expect(files.map((file) => file.sessionId)).toEqual([v7Id]);

    // An id that appears nowhere at all resolves to an empty, non-throwing set.
    const missingV7 = uuidV7FromMs(Date.UTC(2021, 0, 1, 0, 0, 0));
    const empty = await discoverSessionFiles(root, new Set([missingV7]));
    expect(empty).toEqual([]);
  });

  it("uses current top-level thread state for titles, visibility, and project membership", async () => {
    const profileRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "coffice-current-thread-state-"),
    );
    temporaryRoots.push(profileRoot);
    const codexRoot = path.join(profileRoot, ".codex");
    const projectRoot = path.join(profileRoot, "work", "langflow");
    const sessionTimestamp = Date.UTC(2026, 7, 7, 7, 0, 0);
    const visibleId = uuidV7FromMs(sessionTimestamp);
    const projectlessId = uuidV7FromMs(sessionTimestamp + 1);
    const hiddenId = uuidV7FromMs(sessionTimestamp + 2);
    const subagentId = uuidV7FromMs(sessionTimestamp + 3);
    const archivedId = uuidV7FromMs(sessionTimestamp + 4);
    const sessionDirectory = path.join(
      codexRoot,
      "sessions",
      ...utcDayRelative(sessionTimestamp).split("/"),
    );
    await fs.mkdir(sessionDirectory, { recursive: true });
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(
      path.join(codexRoot, ".codex-global-state.json"),
      JSON.stringify({
        "local-projects": {
          "langflow-project": {
            id: "langflow-project",
            name: "Langflow",
            rootPaths: [projectRoot],
          },
        },
        "project-order": ["langflow-project"],
        "thread-project-assignments": {
          [visibleId]: {
            projectKind: "local",
            projectId: "langflow-project",
            cwd: projectRoot,
          },
          [hiddenId]: {
            projectKind: "local",
            projectId: "langflow-project",
            cwd: projectRoot,
          },
          [subagentId]: {
            projectKind: "local",
            projectId: "langflow-project",
            cwd: projectRoot,
          },
          [archivedId]: {
            projectKind: "local",
            projectId: "langflow-project",
            cwd: projectRoot,
          },
        },
      }),
    );
    await fs.writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      [
        {
          id: visibleId,
          thread_name: "Find LangFlow example workflows",
          updated_at: "2026-08-07T07:00:00Z",
        },
        {
          id: hiddenId,
          thread_name: "Hidden obsolete task",
          updated_at: "2026-08-07T07:00:01Z",
        },
        {
          id: subagentId,
          thread_name: "Internal helper",
          updated_at: "2026-08-07T07:00:02Z",
        },
        {
          id: archivedId,
          thread_name: "Archived task",
          updated_at: "2026-08-07T07:00:03Z",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );

    const stateDatabase = new DatabaseSync(
      path.join(codexRoot, "state_5.sqlite"),
    );
    stateDatabase.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        name TEXT,
        cwd TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        thread_source TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        preview TEXT,
        first_user_message TEXT
      )
    `);
    const insertThread = stateDatabase.prepare(`
      INSERT INTO threads (
        id, title, name, cwd, created_at, updated_at, thread_source,
        archived, preview, first_user_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updatedAtSeconds = Math.floor(sessionTimestamp / 1_000);
    insertThread.run(
      visibleId,
      "Older database title",
      null,
      projectRoot,
      updatedAtSeconds - 60,
      updatedAtSeconds,
      "user",
      0,
      "visible",
      "private content is never selected",
    );
    insertThread.run(
      projectlessId,
      "Projectless visible task",
      null,
      projectRoot,
      updatedAtSeconds - 50,
      updatedAtSeconds + 1,
      "user",
      0,
      "visible",
      "private content is never selected",
    );
    insertThread.run(
      hiddenId,
      "Hidden obsolete task",
      null,
      projectRoot,
      updatedAtSeconds - 40,
      updatedAtSeconds + 2,
      "user",
      0,
      "",
      "private content is never selected",
    );
    insertThread.run(
      subagentId,
      "Internal helper",
      null,
      projectRoot,
      updatedAtSeconds - 30,
      updatedAtSeconds + 3,
      "subagent",
      0,
      "visible",
      "private content is never selected",
    );
    insertThread.run(
      archivedId,
      "Archived task",
      null,
      projectRoot,
      updatedAtSeconds - 20,
      updatedAtSeconds + 4,
      "user",
      1,
      "visible",
      "private content is never selected",
    );
    stateDatabase.close();

    await Promise.all(
      [visibleId, projectlessId, hiddenId, subagentId, archivedId].map(
        async (sessionId) => {
          const lines = [
            JSON.stringify({
              timestamp: "2026-08-07T07:00:00Z",
              type: "session_meta",
              payload: {
                id: sessionId,
                cwd: projectRoot,
              },
            }),
            ...(sessionId === visibleId
              ? [
                  JSON.stringify({
                    timestamp: "2026-08-07T07:00:01Z",
                    type: "event_msg",
                    payload: { type: "turn_complete" },
                  }),
                ]
              : []),
          ];
          await fs.writeFile(
            path.join(sessionDirectory, `rollout-${sessionId}.jsonl`),
            lines.join("\n"),
          );
        },
      ),
    );

    const previousProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = profileRoot;
    try {
      const source = await readCodexSource();
      expect(source.rosterAvailable).toBe(true);
      expect(new Set(source.sessions.map((session) => session.id))).toEqual(
        new Set([visibleId, projectlessId]),
      );
      expect(
        source.sessions.find((session) => session.id === visibleId)?.title,
      ).toBe("Find LangFlow example workflows");
      expect(
        source.sessions.find((session) => session.id === projectlessId)?.title,
      ).toBe("Projectless visible task");
      expect(source.sessionMetadata.has(hiddenId)).toBe(false);
      expect(source.sessionMetadata.has(subagentId)).toBe(false);

      const snapshot = buildSnapshotFromSource(
        source,
        new Date("2026-08-09T00:00:00Z"),
      );
      expect(snapshot.tasks).toHaveLength(2);
      expect(
        snapshot.tasks.find((task) => task.id === visibleId),
      ).toMatchObject({
        title: "Find LangFlow example workflows",
        projectId: "langflow-project",
        status: { value: "completed" },
      });
      expect(
        snapshot.tasks.find((task) => task.id === projectlessId)?.projectId,
      ).toBeNull();
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
    }
  });

  it("discovers and groups an old live session beyond the 4000-record index tail", async () => {
    const profileRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "coffice-old-live-"),
    );
    temporaryRoots.push(profileRoot);
    const codexRoot = path.join(profileRoot, ".codex");
    const projectRoot = path.join(profileRoot, "work", "old-live-project");
    const sessionTimestamp = Date.UTC(2025, 0, 2, 3, 4, 5);
    const sessionId = uuidV7FromMs(sessionTimestamp);
    const sessionDirectory = path.join(
      codexRoot,
      "sessions",
      ...utcDayRelative(sessionTimestamp).split("/"),
    );
    await fs.mkdir(sessionDirectory, { recursive: true });
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(
      path.join(codexRoot, ".codex-global-state.json"),
      JSON.stringify({
        "electron-saved-workspace-roots": [projectRoot],
      }),
    );
    const oldIndexRecord = JSON.stringify({
      id: sessionId,
      thread_name: "Old completed temporary task",
      updated_at: "2025-01-02T03:04:06Z",
    });
    const newerIndexRecords = Array.from({ length: 4_001 }, (_, index) =>
      JSON.stringify({
        id: `index-only-${index}`,
        thread_name: `Index-only task ${index}`,
        updated_at: new Date(
          Date.UTC(2026, 0, 1) + index * 1_000,
        ).toISOString(),
      }),
    );
    await fs.writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      [oldIndexRecord, ...newerIndexRecords].join("\n"),
    );
    await fs.writeFile(
      path.join(sessionDirectory, `rollout-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2025-01-02T03:04:05Z",
          type: "session_meta",
          payload: { id: sessionId, cwd: projectRoot },
        }),
        JSON.stringify({
          timestamp: "2025-01-02T03:04:06Z",
          type: "event_msg",
          payload: { type: "turn_complete" },
        }),
      ].join("\n"),
    );

    const previousProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = profileRoot;
    try {
      const source = await readCodexSource();
      expect(source.sessions.map((session) => session.id)).toEqual([sessionId]);
      expect(source.sessions[0]?.title).toBe("");
      expect(source.sessionLocations.get(sessionId)).toBe("live");
      expect(source.sessionMetadata.get(sessionId)).toMatchObject({
        cwd: projectRoot,
        events: [
          { type: "turn_complete", timestamp: "2025-01-02T03:04:06.000Z" },
        ],
      });
      const snapshot = buildSnapshotFromSource(
        source,
        new Date("2026-08-09T00:00:00Z"),
      );
      expect(snapshot.tasks).toHaveLength(1);
      expect(snapshot.tasks[0]).toMatchObject({
        id: sessionId,
        projectId: source.projects[0]?.id,
        status: { value: "completed" },
      });
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
    }
  });

  it("publishes a large live roster without opening every session file", async () => {
    const profileRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "coffice-deferred-roster-"),
    );
    temporaryRoots.push(profileRoot);
    const codexRoot = path.join(profileRoot, ".codex");
    const sessionDirectory = path.join(
      codexRoot,
      "sessions",
      "2026",
      "01",
      "02",
    );
    await fs.mkdir(sessionDirectory, { recursive: true });
    await fs.writeFile(
      path.join(codexRoot, ".codex-global-state.json"),
      JSON.stringify({ "electron-saved-workspace-roots": [] }),
    );
    const sessionCount = 600;
    const records: string[] = [];
    await Promise.all(
      Array.from({ length: sessionCount }, async (_, index) => {
        const timestamp = Date.UTC(2026, 0, 2) + index;
        const id = uuidV7FromMs(timestamp);
        records.push(
          JSON.stringify({
            id,
            thread_name: `Deferred task ${index}`,
            updated_at: new Date(timestamp).toISOString(),
          }),
        );
        await fs.writeFile(
          path.join(sessionDirectory, `rollout-${id}.jsonl`),
          "",
        );
      }),
    );
    await fs.writeFile(
      path.join(codexRoot, "session_index.jsonl"),
      records.join("\n"),
    );

    const previousProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = profileRoot;
    const openSpy = vi.spyOn(fs, "open");
    try {
      const source = await readCodexSource({ deferSessionMetadata: true });
      expect(source.sessions).toHaveLength(sessionCount);
      expect(source.sessionMetadata.size).toBe(0);
      expect(
        openSpy.mock.calls.map(([file]) => path.basename(String(file))).sort(),
      ).toEqual([".codex-global-state.json", "session_index.jsonl"]);
      expect(source.diagnostics).toContainEqual(
        expect.objectContaining({ code: "SESSION_METADATA_DEFERRED" }),
      );
    } finally {
      openSpy.mockRestore();
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
    }
  });

  it("retains the last valid safe metadata when a session refresh breaks", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coffice-session-"));
    temporaryRoots.push(root);
    const sessionId = "44444444-4444-4444-8444-444444444444";
    const filePath = path.join(root, `rollout-${sessionId}.jsonl`);
    await fs.writeFile(
      filePath,
      JSON.stringify({
        timestamp: "2026-07-14T01:00:00Z",
        type: "session_meta",
        payload: { id: sessionId, cwd: "C:\\Synthetic\\Project" },
      }),
    );

    const sessionFile = { filePath, sessionId, location: "live" as const };
    const first = await readSessionMetadataFile(sessionFile);
    expect(first.metadata).toMatchObject({
      id: sessionId,
      cwd: "C:\\Synthetic\\Project",
    });

    const openSpy = vi
      .spyOn(fs, "open")
      .mockRejectedValue(new Error("unchanged cache must not open"));
    try {
      const unchanged = await readSessionMetadataFile(sessionFile);
      expect(unchanged.metadata).toMatchObject(first.metadata);
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }

    await fs.writeFile(
      filePath,
      [
        "{malformed-new-record",
        JSON.stringify({
          timestamp: "2026-07-14T01:01:00Z",
          type: "turn_context",
          payload: { model: "synthetic-new-model" },
        }),
        JSON.stringify({
          timestamp: "2026-07-14T01:01:01Z",
          type: "event_msg",
          payload: { type: "task_complete" },
        }),
      ].join("\n"),
    );
    const partial = await readSessionMetadataFile(sessionFile);
    expect(partial.metadata).toMatchObject({
      id: sessionId,
      cwd: "C:\\Synthetic\\Project",
      model: "synthetic-new-model",
      lastEventAt: "2026-07-14T01:01:01.000Z",
      events: [
        { type: "task_complete", timestamp: "2026-07-14T01:01:01.000Z" },
      ],
    });
    expect(partial.diagnostics[0]?.code).toBe("SESSION_RECORD_SKIPPED");

    await fs.writeFile(filePath, "{malformed-new-record");
    const malformed = await readSessionMetadataFile(sessionFile);
    expect(malformed.metadata).toMatchObject(partial.metadata);
    expect(malformed.diagnostics[0]?.code).toBe("SESSION_RECORD_SKIPPED");

    await fs.rm(filePath);
    const unavailable = await readSessionMetadataFile(sessionFile);
    expect(unavailable.metadata).toMatchObject(partial.metadata);
    expect(unavailable.diagnostics[0]?.code).toBe("SESSION_FILE_UNAVAILABLE");
  });
});
