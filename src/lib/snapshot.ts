import {
  COFFICE_SCHEMA_VERSION,
  type CofficeProject,
  type CofficeSnapshot,
  type CofficeTask,
  type NormalizedStatusValue,
  type StatusEvidence,
} from "./domain";
import {
  normalizeWindowsPath,
  readCodexSource,
  type CodexSourceSnapshot,
} from "./codex-source";
import { recognizeNamedAgent } from "./named-agent";
import { SnapshotCache } from "./snapshot-cache";
import { authoritativeBlockedStatus, reduceSessionStatus } from "./status";
import {
  getCodexAppServerManager,
  type CodexBlockedGoalRead,
} from "./codex-app-server";

export const DEFAULT_POLL_INTERVAL_MS = 3_000;
export const SNAPSHOT_CACHE_FRESH_MS = 10_000;
export const SNAPSHOT_COLD_WAIT_MS = 30_000;
const SNAPSHOT_REFRESH_RETRY_MS = 10_000;
const TOKEN_USAGE_STALE_MS = 10 * 60 * 1_000;
const ACTIVE_STATUSES = new Set<NormalizedStatusValue>([
  "queued",
  "starting",
  "active",
  "planning",
  "thinking",
  "reading",
  "researching",
  "coding",
  "running",
  "reviewing",
]);
const NON_PARSER_DIAGNOSTIC_CODES = new Set([
  "REPOSITORY_ENRICHMENT_BOUND_EXCEEDED",
]);

function safeTaskTitle(
  sessionId: string,
  sessionTitle: string,
  namedAgent: ReturnType<typeof recognizeNamedAgent>,
): string {
  if (namedAgent.isNamedAgent && namedAgent.name) {
    return `[AGENT] ${namedAgent.name}`;
  }
  const title = sessionTitle.trim();
  if (title) return title;
  const compactId = sessionId.replaceAll("-", "").slice(0, 8).toUpperCase();
  return `Task ${compactId || "UNKNOWN"}`;
}

function containsRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeWindowsPath(candidate);
  const normalizedRoot = normalizeWindowsPath(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}\\`)
  );
}

function longestContainingRootLength(
  candidate: string,
  roots: readonly string[],
): number {
  return Math.max(
    -1,
    ...roots
      .filter((root) => containsRoot(candidate, root))
      .map((root) => normalizeWindowsPath(root).length),
  );
}

function aggregateProjectStatus(
  tasks: readonly CofficeTask[],
  timestamp: string,
): StatusEvidence {
  if (tasks.length === 0) {
    return {
      value: "idle",
      provenance: "inferred",
      source: "coffice:project-task-aggregate",
      timestamp,
      stale: false,
      confidence: 0.8,
    };
  }

  const selected =
    [...tasks]
      .filter(
        (task) => ACTIVE_STATUSES.has(task.status.value) && !task.status.stale,
      )
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )[0] ??
    [...tasks].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )[0];

  return {
    value: selected.status.value,
    provenance: "inferred",
    source: "coffice:project-task-aggregate",
    timestamp: selected.status.timestamp,
    stale: tasks.every((task) => task.status.stale),
    confidence: 0.7,
  };
}

export function buildSnapshotFromSource(
  source: CodexSourceSnapshot,
  now = new Date(),
  blockedGoalRead: CodexBlockedGoalRead = {
    available: true,
    evidence: new Map(),
  },
): CofficeSnapshot {
  const generatedAt = now.toISOString();
  const projectById = new Map(
    source.projects.map((project) => [project.id, project] as const),
  );
  const tasks: CofficeTask[] = source.sessions
    .filter((session) => source.sessionLocations.get(session.id) === "live")
    .map<CofficeTask>((session) => {
      const metadata = source.sessionMetadata.get(session.id);
      const hintedRoot = source.threadRootHints.get(session.id);
      const candidateRoot = metadata?.cwd ?? hintedRoot;
      const assignedProjectId = source.threadProjectAssignments.get(session.id);
      const invalidAssignment = source.invalidThreadProjectAssignments.has(
        session.id,
      );
      const assignmentEvidence = source.currentAssignmentsAvailable
        ? invalidAssignment
          ? "explicit_unknown_project"
          : assignedProjectId
            ? projectById.has(assignedProjectId)
              ? "explicit_project"
              : "explicit_unknown_project"
            : "explicit_unassigned"
        : "cwd_fallback";
      const project = source.currentAssignmentsAvailable
        ? invalidAssignment
          ? undefined
          : assignedProjectId
            ? projectById.get(assignedProjectId)
            : undefined
        : candidateRoot
          ? source.projects
              .filter(
                (item) =>
                  longestContainingRootLength(candidateRoot, item.rootPaths) >=
                  0,
              )
              .sort(
                (left, right) =>
                  longestContainingRootLength(candidateRoot, right.rootPaths) -
                  longestContainingRootLength(candidateRoot, left.rootPaths),
              )[0]
          : undefined;
      const namedAgent = recognizeNamedAgent(session.title);
      const blockedGoal = blockedGoalRead.evidence.get(session.id);
      return {
        id: session.id,
        title: safeTaskTitle(session.id, session.title, namedAgent),
        projectId: project?.id ?? null,
        assignmentEvidence,
        kind: namedAgent.isNamedAgent ? "named_agent" : "temporary_worker",
        ...(namedAgent.name ? { agentName: namedAgent.name } : {}),
        ...(metadata?.model ? { model: metadata.model } : {}),
        ...(metadata?.startedAt ? { startedAt: metadata.startedAt } : {}),
        updatedAt: new Date(
          metadata?.lastEventAt ?? session.updatedAt,
        ).toISOString(),
        status: blockedGoal
          ? authoritativeBlockedStatus(
              blockedGoal.updatedAt,
              !blockedGoalRead.available,
            )
          : reduceSessionStatus(metadata?.events ?? [], {
              now,
              fallbackTimestamp: metadata?.lastEventAt ?? session.updatedAt,
              sourceAvailable: source.rosterAvailable,
              persistentStaff: namedAgent.isNamedAgent,
            }),
        ...(metadata?.tokenUsage
          ? {
              tokenUsage: {
                ...metadata.tokenUsage,
                source: "session-jsonl:event_msg.token_count" as const,
                stale:
                  now.getTime() - Date.parse(metadata.tokenUsage.timestamp) >
                  TOKEN_USAGE_STALE_MS,
              },
            }
          : {}),
      };
    });

  const projects: CofficeProject[] = source.projects.map((project) => {
    const projectTasks = tasks.filter((task) => task.projectId === project.id);
    const repositoryRoots = project.repositoryCollectionBoundedOut
      ? undefined
      : project.rootPaths.map((_, index) => {
          const evidence =
            project.repositories?.[index] ??
            (index === 0 ? project.repository : undefined);
          return {
            role: index === 0 ? ("primary" as const) : ("additional" as const),
            ...(evidence ? { evidence } : {}),
          };
        });
    return {
      id: project.id,
      name: project.name,
      order: project.order,
      taskCount: projectTasks.length,
      activeTaskCount: projectTasks.filter(
        (task) => ACTIVE_STATUSES.has(task.status.value) && !task.status.stale,
      ).length,
      status: aggregateProjectStatus(projectTasks, generatedAt),
      repositoryRootCount: project.rootPaths.length,
      ...(project.repositoryCollectionBoundedOut
        ? { repositoryCollectionState: "bounded_out" as const }
        : {}),
      ...(repositoryRoots?.[0]?.evidence
        ? { repository: repositoryRoots[0].evidence }
        : {}),
      ...(repositoryRoots?.length ? { repositoryRoots } : {}),
    };
  });

  // Keep this assertion close to normalization so an adapter regression cannot
  // silently attach tasks to an unknown public project ID.
  for (const task of tasks) {
    if (task.projectId && !projectById.has(task.projectId))
      task.projectId = null;
  }

  // Collector admission is represented structurally on each project. It is
  // not a malformed or unread source record and must not inflate the global
  // parser/skipped-record notice consumed by the snapshot feed.
  const parserDiagnostics = source.diagnostics.filter(
    (item) => !NON_PARSER_DIAGNOSTIC_CODES.has(item.code),
  );
  const health = !source.globalStateAvailable
    ? "disconnected"
    : parserDiagnostics.some((item) => item.severity === "error") ||
        parserDiagnostics.length > 0
      ? "degraded"
      : "connected";

  return {
    schemaVersion: COFFICE_SCHEMA_VERSION,
    generatedAt,
    source: {
      kind: "codex-local",
      health,
      lastReadAt: generatedAt,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      freshness: "fresh",
      refreshState: "fresh",
      cacheAgeMs: 0,
      lastRefreshSuccessAt: generatedAt,
    },
    projects,
    tasks,
    diagnostics: parserDiagnostics,
  };
}

export async function buildCodexSnapshot(
  now = new Date(),
): Promise<CofficeSnapshot> {
  const source = await readCodexSource();
  // If current visibility cannot be established, retain the last valid roster
  // instead of publishing hidden/internal rollout files or an empty office.
  if (!source.rosterAvailable) {
    throw new Error("Codex visible-thread roster is unavailable");
  }
  const visibleLiveIds = source.sessions
    .filter((session) => source.sessionLocations.get(session.id) === "live")
    .map((session) => session.id);
  const blockedGoalRead =
    await getCodexAppServerManager().readBlockedGoalEvidence(visibleLiveIds);
  return buildSnapshotFromSource(source, now, blockedGoalRead);
}

/**
 * Builds a metadata-only snapshot from the authoritative top-level thread
 * roster. Session status and repository evidence enrich in the shared
 * background refresh.
 */
export async function buildDeferredCodexSnapshot(
  now = new Date(),
): Promise<CofficeSnapshot> {
  const source = await readCodexSource({ deferSessionMetadata: true });
  if (!source.rosterAvailable) {
    throw new Error("Codex visible-thread roster is unavailable");
  }
  return buildSnapshotFromSource(source, now);
}

export interface CodexSnapshotBuilders {
  buildFull: () => Promise<CofficeSnapshot>;
  buildDeferred: () => Promise<CofficeSnapshot>;
}

export interface CodexSnapshotStagingOptions {
  freshForMs: number;
  retryAfterMs: number;
  coldWaitMs: number;
  now?: () => number;
}

export interface CodexSnapshotStaging {
  cache: SnapshotCache<CofficeSnapshot>;
  getSnapshot: () => Promise<CofficeSnapshot>;
}

/**
 * Staged cold loading. On the first cold read the cache is seeded once with
 * the fast deferred snapshot so callers immediately see every recognizable
 * project and session, and one full background enrichment starts immediately.
 * While the slow full read runs, the seed remains available; a failed
 * enrichment retains the seed and retries under the normal backoff; every
 * successful refresh is a full read.
 */
export function createCodexSnapshotStaging(
  builders: CodexSnapshotBuilders,
  options: CodexSnapshotStagingOptions,
): CodexSnapshotStaging {
  const cache = new SnapshotCache(builders.buildFull, {
    freshForMs: options.freshForMs,
    retryAfterMs: options.retryAfterMs,
    ...(options.now ? { now: options.now } : {}),
  });

  let coldSeed: Promise<void> | undefined;

  function ensureColdSeed(): Promise<void> {
    if (!coldSeed) {
      coldSeed = (async () => {
        try {
          cache.seed(await builders.buildDeferred());
        } catch {
          // The deferred source is unavailable; the cache falls back to a
          // full cold read bounded by coldWaitMs below.
        }
        void cache.revalidateInBackground();
      })();
    }
    return coldSeed;
  }

  async function getSnapshot(): Promise<CofficeSnapshot> {
    await ensureColdSeed();
    const { value, metadata } = await cache.readWithMetadata(
      options.coldWaitMs,
    );
    return {
      ...value,
      source: {
        ...value.source,
        health:
          metadata.state === "failed" && value.source.health === "connected"
            ? "degraded"
            : value.source.health,
        freshness: metadata.state === "fresh" ? "fresh" : "stale",
        refreshState: metadata.state,
        cacheAgeMs: metadata.ageMs,
        lastRefreshSuccessAt: new Date(metadata.lastSuccessAt).toISOString(),
        ...(metadata.lastAttemptAt !== undefined
          ? {
              lastRefreshAttemptAt: new Date(
                metadata.lastAttemptAt,
              ).toISOString(),
            }
          : {}),
        ...(metadata.lastFailureAt !== undefined
          ? {
              lastRefreshFailureAt: new Date(
                metadata.lastFailureAt,
              ).toISOString(),
            }
          : {}),
      },
    };
  }

  return { cache, getSnapshot };
}

const codexSnapshotStaging = createCodexSnapshotStaging(
  {
    buildFull: () => buildCodexSnapshot(),
    buildDeferred: () => buildDeferredCodexSnapshot(),
  },
  {
    freshForMs: SNAPSHOT_CACHE_FRESH_MS,
    retryAfterMs: SNAPSHOT_REFRESH_RETRY_MS,
    coldWaitMs: SNAPSHOT_COLD_WAIT_MS,
  },
);

/**
 * Returns the latest safe Codex metadata snapshot. The first cold read seeds a
 * fast deferred snapshot and immediately starts one background enrichment;
 * after the first successful full read, stale snapshots are served immediately
 * while one background refresh is shared by every API and SSE caller.
 */
export function getCodexSnapshot(): Promise<CofficeSnapshot> {
  return codexSnapshotStaging.getSnapshot();
}
