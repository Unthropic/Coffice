export const COFFICE_SCHEMA_VERSION = "1.0" as const;
export const MAX_REPOSITORY_ROOTS_PER_REFRESH = 64;

export const NORMALIZED_STATUS_VALUES = [
  "unknown",
  "offline",
  "idle",
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
  "waiting_for_user",
  "blocked",
  "completed",
  "failed",
] as const;

export type NormalizedStatusValue = (typeof NORMALIZED_STATUS_VALUES)[number];

export type EvidenceProvenance = "observed" | "inferred";

export interface StatusEvidence {
  value: NormalizedStatusValue;
  provenance: EvidenceProvenance;
  source: string;
  timestamp: string;
  stale: boolean;
  confidence?: number;
}

export interface CofficeProject {
  id: string;
  name: string;
  order: number;
  taskCount: number;
  activeTaskCount: number;
  status: StatusEvidence;
  repositoryRootCount?: number;
  repositoryCollectionState?: "bounded_out";
  repository?: RepositoryEvidence;
  repositoryRoots?: RepositoryRootEvidence[];
}

export interface RepositoryRootEvidence {
  role: "primary" | "additional";
  evidence?: RepositoryEvidence;
}

export type RepositoryChangeArea =
  "Source" | "Tests" | "Docs" | "Config" | "Assets" | "Other";

export interface RepositoryChangeAreaSummary {
  area: RepositoryChangeArea;
  files: number;
}

export interface RepositoryDiffStats {
  trackedFiles: number;
  additions: number;
  deletions: number;
  binaryFiles: number;
  source: "git:diff-numstat";
}

export interface AvailableRepositoryEvidence {
  availability: "available";
  branch: string;
  headOid: string | null;
  headState: "commit" | "unborn";
  changedFiles: number;
  stagedFiles: number;
  untrackedFiles: number;
  conflictedFiles: number;
  ahead: number;
  behind: number;
  clean: boolean;
  changeAreas: {
    totalFiles: number;
    summarizedFiles: number;
    omittedFiles: number;
    areas: RepositoryChangeAreaSummary[];
  };
  diffStats?: RepositoryDiffStats;
  source: "git:status-porcelain-v2";
  observedAt: string;
}

export interface UnavailableRepositoryEvidence {
  availability: "unavailable";
  source: "git";
  observedAt: string;
}

export type RepositoryEvidence =
  AvailableRepositoryEvidence | UnavailableRepositoryEvidence;

export interface TokenUsageEvidence {
  contextTokens: number;
  contextWindow: number;
  cumulativeTokens?: number;
  source: "session-jsonl:event_msg.token_count";
  timestamp: string;
  stale: boolean;
}

export type TaskAssignmentEvidence =
  | "explicit_project"
  | "explicit_unassigned"
  | "explicit_unknown_project"
  | "cwd_fallback";

export interface CofficeTask {
  id: string;
  title: string;
  projectId: string | null;
  assignmentEvidence: TaskAssignmentEvidence;
  kind: "named_agent" | "temporary_worker";
  agentName?: string;
  model?: string;
  startedAt?: string;
  updatedAt: string;
  status: StatusEvidence;
  tokenUsage?: TokenUsageEvidence;
}

export type SourceHealth = "connected" | "degraded" | "disconnected";

export interface SourceSummary {
  kind: "codex-local";
  health: SourceHealth;
  lastReadAt: string;
  pollIntervalMs: number;
  freshness: "fresh" | "stale";
  refreshState: "fresh" | "refreshing" | "stale" | "failed";
  cacheAgeMs: number;
  lastRefreshSuccessAt: string;
  lastRefreshAttemptAt?: string;
  lastRefreshFailureAt?: string;
}

export interface CofficeDiagnostic {
  code: string;
  message: string;
  severity: "warning" | "error";
  source:
    | "global_state"
    | "thread_state"
    | "session_index"
    | "session_file"
    | "adapter";
  recordId?: string;
}

export interface CofficeSnapshot {
  schemaVersion: typeof COFFICE_SCHEMA_VERSION;
  generatedAt: string;
  source: SourceSummary;
  projects: CofficeProject[];
  tasks: CofficeTask[];
  diagnostics: CofficeDiagnostic[];
}
