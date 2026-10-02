import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import {
  MAX_REPOSITORY_ROOTS_PER_REFRESH,
  type CofficeDiagnostic,
} from "./domain";
import type { RepositoryEvidence } from "./domain";
import {
  readCodexThreadState,
  type CodexVisibleThread,
} from "./codex-thread-state";
import { readRepositoryEvidence } from "./repository-source";
import type { SessionStatusEvent } from "./status";

const GLOBAL_STATE_FILE = ".codex-global-state.json";
const SESSION_INDEX_FILE = "session_index.jsonl";
const THREAD_STATE_FILE = "state_5.sqlite";
const SESSION_DIRECTORIES = ["sessions", "archived_sessions"] as const;
// Global state is metadata, not a content transport. Bound bytes before
// allocation/parsing; repository collection has a separate workload ceiling
// that fails closed without truncating the authoritative saved-root inventory.
export const MAX_GLOBAL_STATE_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_RECORDS = 4_000;
const SESSION_SUMMARY_HEAD_BYTES = 16 * 1024;
const SESSION_SUMMARY_INITIAL_TAIL_BYTES = 64 * 1024;
const MAX_SESSION_TAIL_BYTES = 256 * 1024;
const MIN_SESSION_PARSE_CACHE_ENTRIES = 512;
// Each reader holds at most 320 KiB; six workers bound session buffers below
// 2 MiB. Higher concurrency did not improve the measured filesystem latency.
const SESSION_READ_CONCURRENCY = 6;
const SESSION_ENRICHMENT_CONCURRENCY = 4;
const REPOSITORY_ENRICHMENT_CONCURRENCY = 4;
// One root can require several isolated Git commands. This source-wide safety
// ceiling bounds a refresh's subprocess workload; it is not a display tier and
// never truncates the authoritative root inventory.
export { MAX_REPOSITORY_ROOTS_PER_REFRESH } from "./domain";
const MAX_DEEP_CONTENT_STATUS_EVENT_BYTES = 16 * 1024;

interface UnknownRecord {
  [key: string]: unknown;
}

export interface SourceProject {
  id: string;
  name: string;
  rootPath: string;
  rootPaths: string[];
  order: number;
  repository?: RepositoryEvidence;
  repositories?: RepositoryEvidence[];
  repositoryCollectionBoundedOut?: true;
}

export interface SourceProjectInventory {
  projects: SourceProject[];
  threadRootHints: Map<string, string>;
  threadProjectAssignments: Map<string, string>;
  invalidThreadProjectAssignments: Set<string>;
  currentAssignmentsAvailable: boolean;
  diagnostics: CofficeDiagnostic[];
}

export interface SessionIndexRecord {
  id: string;
  title: string;
  updatedAt: string;
}

export interface SessionIndexParseResult {
  records: SessionIndexRecord[];
  diagnostics: CofficeDiagnostic[];
}

export interface SessionMetadata {
  id?: string;
  cwd?: string;
  model?: string;
  startedAt?: string;
  lastEventAt?: string;
  events: SessionStatusEvent[];
  tokenUsage?: {
    contextTokens: number;
    contextWindow: number;
    cumulativeTokens?: number;
    timestamp: string;
  };
}

export interface SessionParseResult {
  metadata: SessionMetadata;
  diagnostics: CofficeDiagnostic[];
}

export interface CodexSourceSnapshot {
  projects: SourceProject[];
  threadRootHints: Map<string, string>;
  threadProjectAssignments: Map<string, string>;
  invalidThreadProjectAssignments: Set<string>;
  currentAssignmentsAvailable: boolean;
  sessions: SessionIndexRecord[];
  sessionLocations: Map<string, SessionLocation>;
  sessionMetadata: Map<string, SessionMetadata>;
  diagnostics: CofficeDiagnostic[];
  globalStateAvailable: boolean;
  sessionIndexAvailable: boolean;
  rosterAvailable: boolean;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return undefined;
  return new Date(value).toISOString();
}

function threadStateTimestamp(
  value: CodexVisibleThread["updatedAt"],
): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value >= 1_000_000_000_000 ? value : value * 1_000;
    return new Date(milliseconds).toISOString();
  }
  return safeIsoTimestamp(value);
}

function safeCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

export function normalizeWindowsPath(value: string): string {
  const withoutDevicePrefix = value.replace(/^\\\\\?\\/, "");
  return path.win32
    .normalize(withoutDevicePrefix)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function projectId(rootPath: string): string {
  return createHash("sha256")
    .update(normalizeWindowsPath(rootPath))
    .digest("hex")
    .slice(0, 16);
}

function projectName(rootPath: string): string {
  return path.win32.basename(rootPath.replace(/[\\/]+$/, "")) || rootPath;
}

export function parseSavedProjectsJson(input: string): SourceProjectInventory {
  const diagnostics: CofficeDiagnostic[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    return {
      projects: [],
      threadRootHints: new Map(),
      threadProjectAssignments: new Map(),
      invalidThreadProjectAssignments: new Set(),
      currentAssignmentsAvailable: false,
      diagnostics: [
        {
          code: "GLOBAL_STATE_MALFORMED",
          message: "Codex global state could not be parsed.",
          severity: "error",
          source: "global_state",
        },
      ],
    };
  }

  if (!isRecord(parsed)) {
    return {
      projects: [],
      threadRootHints: new Map(),
      threadProjectAssignments: new Map(),
      invalidThreadProjectAssignments: new Set(),
      currentAssignmentsAvailable: false,
      diagnostics: [
        {
          code: "GLOBAL_STATE_UNEXPECTED_SHAPE",
          message: "Codex global state has an unsupported shape.",
          severity: "error",
          source: "global_state",
        },
      ],
    };
  }

  const localProjects = isRecord(parsed["local-projects"])
    ? parsed["local-projects"]
    : undefined;
  const hasProjectSource =
    localProjects !== undefined ||
    Array.isArray(parsed["electron-saved-workspace-roots"]);

  const orderedEntries = stringArray(parsed["project-order"]);
  const labels = isRecord(parsed["electron-workspace-root-labels"])
    ? parsed["electron-workspace-root-labels"]
    : {};
  const labelByRoot = new Map(
    Object.entries(labels)
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      )
      .map(
        ([root, label]) => [normalizeWindowsPath(root), label.trim()] as const,
      ),
  );

  // project-order entries are stable project ids in the local-projects schema
  // and workspace root paths in the legacy schema. Index both interpretations
  // so ordering stays deterministic under either layout.
  const orderIndexBySchemaProjectId = new Map<string, number>();
  const orderIndexByNormalizedRoot = new Map<string, number>();
  orderedEntries.forEach((entry, index) => {
    if (localProjects && Object.hasOwn(localProjects, entry)) {
      if (!orderIndexBySchemaProjectId.has(entry))
        orderIndexBySchemaProjectId.set(entry, index);
      return;
    }
    const normalized = normalizeWindowsPath(entry);
    if (normalized && !orderIndexByNormalizedRoot.has(normalized))
      orderIndexByNormalizedRoot.set(normalized, index);
  });

  let invalidSavedRoot = false;
  const distinctRoots = (value: unknown): string[] => {
    const roots = new Map<string, string>();
    if (!Array.isArray(value)) return [];
    for (const rawRoot of value) {
      if (typeof rawRoot !== "string") {
        invalidSavedRoot = true;
        continue;
      }
      const root = rawRoot.trim();
      if (!root || !path.win32.isAbsolute(root)) {
        invalidSavedRoot = true;
        continue;
      }
      const normalized = normalizeWindowsPath(root);
      if (normalized && !roots.has(normalized)) roots.set(normalized, root);
    }
    return [...roots.values()];
  };

  // The current schema identifies projects by project UUID, not by workspace
  // root. A project can own multiple roots, and multiple projects can
  // intentionally share a root, so never collapse these entries by cwd.
  const primaryRootBySchemaProjectId = new Map<string, string>();
  const projects: SourceProject[] = [];
  if (localProjects) {
    let fallbackOrder = 0;
    for (const [schemaProjectId, value] of Object.entries(localProjects)) {
      if (!isRecord(value)) continue;
      const rootPaths = distinctRoots(value.rootPaths);
      const rootPath = rootPaths[0];
      if (!rootPath) continue;
      const rawName = typeof value.name === "string" ? value.name.trim() : "";
      primaryRootBySchemaProjectId.set(schemaProjectId, rootPath);
      projects.push({
        id: schemaProjectId,
        name: rawName || projectName(rootPath),
        rootPath,
        rootPaths,
        order:
          orderIndexBySchemaProjectId.get(schemaProjectId) ??
          orderedEntries.length + fallbackOrder,
      });
      fallbackOrder += 1;
    }
  } else {
    const roots = distinctRoots(parsed["electron-saved-workspace-roots"]);
    for (const [fallbackOrder, rootPath] of roots.entries()) {
      const normalized = normalizeWindowsPath(rootPath);
      projects.push({
        id: projectId(rootPath),
        name: labelByRoot.get(normalized) || projectName(rootPath),
        rootPath,
        rootPaths: [rootPath],
        order:
          orderIndexByNormalizedRoot.get(normalized) ??
          orderedEntries.length + fallbackOrder,
      });
    }
  }

  if (invalidSavedRoot) {
    diagnostics.push({
      code: "SAVED_PROJECT_ROOT_INVALID",
      message:
        "One or more saved Codex workspace roots were invalid and ignored.",
      severity: "warning",
      source: "global_state",
    });
  }

  if (!hasProjectSource) {
    diagnostics.push({
      code: "SAVED_PROJECTS_MISSING",
      message: "Saved Codex workspace roots are unavailable.",
      severity: "warning",
      source: "global_state",
    });
  }

  projects.sort(
    (left, right) =>
      left.order - right.order || left.name.localeCompare(right.name),
  );

  const threadRootHints = new Map<string, string>();
  if (isRecord(parsed["thread-workspace-root-hints"])) {
    for (const [threadId, root] of Object.entries(
      parsed["thread-workspace-root-hints"],
    )) {
      if (typeof root === "string") threadRootHints.set(threadId, root);
    }
  }

  const currentAssignments = isRecord(parsed["thread-project-assignments"])
    ? parsed["thread-project-assignments"]
    : undefined;
  const currentAssignmentsAvailable = currentAssignments !== undefined;
  const threadProjectAssignments = new Map<string, string>();
  const invalidThreadProjectAssignments = new Set<string>();
  if (currentAssignments) {
    for (const [threadId, assignment] of Object.entries(currentAssignments)) {
      if (!isRecord(assignment)) {
        invalidThreadProjectAssignments.add(threadId);
        continue;
      }
      const assignedProjectId =
        typeof assignment.projectId === "string"
          ? assignment.projectId.trim()
          : undefined;
      const validProjectKind =
        assignment.projectKind === undefined ||
        assignment.projectKind === "local";
      if (!assignedProjectId || !validProjectKind) {
        invalidThreadProjectAssignments.add(threadId);
        continue;
      }
      threadProjectAssignments.set(threadId, assignedProjectId);
      const root =
        typeof assignment.cwd === "string"
          ? assignment.cwd
          : typeof assignment.path === "string"
            ? assignment.path
            : typeof assignment.rootPath === "string"
              ? assignment.rootPath
              : assignedProjectId
                ? primaryRootBySchemaProjectId.get(assignedProjectId)
                : undefined;
      if (root) threadRootHints.set(threadId, root);
    }
  }
  if (invalidThreadProjectAssignments.size > 0) {
    diagnostics.push({
      code: "THREAD_PROJECT_ASSIGNMENT_INVALID",
      message: "One or more Codex task project assignments were malformed.",
      severity: "warning",
      source: "global_state",
    });
  }

  return {
    projects,
    threadRootHints,
    threadProjectAssignments,
    invalidThreadProjectAssignments,
    currentAssignmentsAvailable,
    diagnostics,
  };
}

export function parseSessionIndexJsonl(
  input: string,
  maxRecords = MAX_INDEX_RECORDS,
): SessionIndexParseResult {
  const diagnostics: CofficeDiagnostic[] = [];
  const records = new Map<string, SessionIndexRecord>();
  const lines = input.split(/\r?\n/).filter(Boolean).slice(-maxRecords);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) throw new Error("shape");
      const id = typeof parsed.id === "string" ? parsed.id : undefined;
      const title =
        typeof parsed.thread_name === "string"
          ? parsed.thread_name.trim()
          : undefined;
      const updatedAt = safeIsoTimestamp(parsed.updated_at);
      if (!id || !title || !updatedAt) throw new Error("fields");
      records.set(id, { id, title, updatedAt });
    } catch {
      diagnostics.push({
        code: "SESSION_INDEX_RECORD_SKIPPED",
        message: "A malformed session-index record was skipped.",
        severity: "warning",
        source: "session_index",
      });
    }
  }

  return {
    records: [...records.values()].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    ),
    diagnostics,
  };
}

const SAFE_STATUS_EVENT_TYPES = new Set([
  "user_message",
  "task_started",
  "turn_started",
  "item_started",
  "item_completed",
  "plan_update",
  "agent_reasoning",
  "web_search_begin",
  "web_search_end",
  "image_generation_begin",
  "image_generation_end",
  "mcp_tool_call_begin",
  "mcp_tool_call_end",
  "exec_command_begin",
  "exec_command_end",
  "patch_apply_begin",
  "patch_apply_end",
  "entered_review_mode",
  "exited_review_mode",
  "exec_approval_request",
  "apply_patch_approval_request",
  "request_permissions",
  "request_user_input",
  "elicitation_request",
  "agent_message",
  "task_complete",
  "turn_complete",
  "error",
  "turn_aborted",
]);

const CONTENT_BEARING_STATUS_EVENT_TYPES = new Set([
  "user_message",
  "agent_message",
  "item_started",
  "item_completed",
]);

function isTurnStartedEvent(type: string): boolean {
  return type === "task_started" || type === "turn_started";
}

const SESSION_METADATA_RECORD_TYPES = new Set([
  "session_meta",
  "turn_context",
  "event_msg",
]);

function jsonStringEnd(input: string, start: number): number | undefined {
  if (input[start] !== '"') return undefined;
  let escaped = false;
  for (let index = start + 1; index < input.length; index += 1) {
    const character = input[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      return index;
    }
  }
  return undefined;
}

function parsedJsonString(
  input: string,
  start: number,
  end: number,
): string | undefined {
  if (end - start > 1_024) return undefined;
  try {
    const value = JSON.parse(input.slice(start, end + 1)) as unknown;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function topLevelFieldValueStart(
  input: string,
  field: string,
  objectStart = 0,
): number | undefined {
  let depth = 0;

  for (let index = objectStart; index < input.length; index += 1) {
    const character = input[index];
    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) return undefined;
      continue;
    }
    if (character !== '"') continue;

    const stringStart = index;
    const stringEnd = jsonStringEnd(input, stringStart);
    if (stringEnd === undefined) return undefined;
    index = stringEnd;
    if (depth !== 1) continue;

    let separator = index + 1;
    while (/\s/.test(input[separator] ?? "")) separator += 1;
    if (input[separator] !== ":") continue;

    const key = parsedJsonString(input, stringStart, stringEnd);
    if (key !== field) continue;

    let valueStart = separator + 1;
    while (/\s/.test(input[valueStart] ?? "")) valueStart += 1;
    return valueStart < input.length ? valueStart : undefined;
  }

  return undefined;
}

function topLevelStringField(
  input: string,
  field: string,
  objectStart = 0,
): string | undefined {
  const valueStart = topLevelFieldValueStart(input, field, objectStart);
  if (valueStart === undefined) return undefined;
  const valueEnd = jsonStringEnd(input, valueStart);
  return valueEnd === undefined
    ? undefined
    : parsedJsonString(input, valueStart, valueEnd);
}

/**
 * Reads only the top-level `type` discriminator without materializing payloads.
 * Undefined means the shape was indeterminate and the caller must fall back to
 * JSON.parse so a relevant record can never be skipped by this optimization.
 */
function topLevelRecordType(input: string): string | undefined {
  return topLevelStringField(input, "type");
}

interface ShallowEventMetadata {
  timestamp: string;
  type: string;
  affectsTurnStatus?: boolean;
}

function shallowCodexErrorAffectsTurnStatus(
  input: string,
  payloadStart: number,
): boolean {
  const infoStart = topLevelFieldValueStart(
    input,
    "codex_error_info",
    payloadStart,
  );
  if (infoStart === undefined || input.startsWith("null", infoStart)) {
    return true;
  }
  const infoEnd = jsonStringEnd(input, infoStart);
  const unitVariant =
    infoEnd === undefined
      ? undefined
      : parsedJsonString(input, infoStart, infoEnd);
  if (unitVariant === "thread_rollback_failed") return false;
  if (
    input[infoStart] === "{" &&
    topLevelFieldValueStart(input, "active_turn_not_steerable", infoStart) !==
      undefined
  ) {
    return false;
  }
  return true;
}

function shallowEventMetadata(input: string): ShallowEventMetadata | undefined {
  const timestamp = safeIsoTimestamp(topLevelStringField(input, "timestamp"));
  const payloadStart = topLevelFieldValueStart(input, "payload");
  if (!timestamp || payloadStart === undefined || input[payloadStart] !== "{") {
    return undefined;
  }
  const type = topLevelStringField(input, "type", payloadStart);
  if (!type) return undefined;
  if (type === "error") {
    return {
      timestamp,
      type,
      affectsTurnStatus: shallowCodexErrorAffectsTurnStatus(
        input,
        payloadStart,
      ),
    };
  }
  if (type === "turn_complete") {
    const errorStart = topLevelFieldValueStart(input, "error", payloadStart);
    return {
      timestamp,
      type,
      ...(errorStart !== undefined && !input.startsWith("null", errorStart)
        ? { affectsTurnStatus: true }
        : {}),
    };
  }
  return { timestamp, type };
}

function parsedEventAffectsTurnStatus(
  type: string,
  payload: Record<string, unknown>,
): boolean | undefined {
  if (type === "turn_complete") {
    return payload.error !== undefined && payload.error !== null
      ? true
      : undefined;
  }
  if (type !== "error") return undefined;
  const info = payload.codex_error_info;
  if (info === "thread_rollback_failed") return false;
  if (isRecord(info) && "active_turn_not_steerable" in info) return false;
  return true;
}

function hasValidJsonSyntax(input: string): boolean {
  const MAX_JSON_DEPTH = 128;
  let index = 0;

  const whitespace = (code: number) =>
    code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  const skipWhitespace = () => {
    while (index < input.length && whitespace(input.charCodeAt(index)))
      index += 1;
  };
  const digit = (code: number) => code >= 0x30 && code <= 0x39;

  const parseString = (): boolean => {
    if (input[index] !== '"') return false;
    index += 1;
    while (index < input.length) {
      const code = input.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        return true;
      }
      if (code <= 0x1f) return false;
      if (code !== 0x5c) {
        index += 1;
        continue;
      }
      index += 1;
      if (index >= input.length) return false;
      const escaped = input[index];
      if ('"\\/bfnrt'.includes(escaped)) {
        index += 1;
        continue;
      }
      if (escaped !== "u" || index + 4 >= input.length) return false;
      for (let offset = 1; offset <= 4; offset += 1) {
        if (!/[0-9a-f]/i.test(input[index + offset])) return false;
      }
      index += 5;
    }
    return false;
  };

  const parseNumber = (): boolean => {
    if (input[index] === "-") index += 1;
    if (input[index] === "0") {
      index += 1;
    } else {
      const first = input.charCodeAt(index);
      if (first < 0x31 || first > 0x39) return false;
      index += 1;
      while (digit(input.charCodeAt(index))) index += 1;
    }
    if (input[index] === ".") {
      index += 1;
      if (!digit(input.charCodeAt(index))) return false;
      while (digit(input.charCodeAt(index))) index += 1;
    }
    if (input[index] === "e" || input[index] === "E") {
      index += 1;
      if (input[index] === "+" || input[index] === "-") index += 1;
      if (!digit(input.charCodeAt(index))) return false;
      while (digit(input.charCodeAt(index))) index += 1;
    }
    return true;
  };

  const parseValue = (depth: number): boolean => {
    if (depth > MAX_JSON_DEPTH) return false;
    skipWhitespace();
    const character = input[index];
    if (character === '"') return parseString();
    if (character === "-") return parseNumber();
    if (digit(input.charCodeAt(index))) return parseNumber();
    if (input.startsWith("true", index)) {
      index += 4;
      return true;
    }
    if (input.startsWith("false", index)) {
      index += 5;
      return true;
    }
    if (input.startsWith("null", index)) {
      index += 4;
      return true;
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (input[index] === "]") {
        index += 1;
        return true;
      }
      while (true) {
        if (!parseValue(depth + 1)) return false;
        skipWhitespace();
        if (input[index] === "]") {
          index += 1;
          return true;
        }
        if (input[index] !== ",") return false;
        index += 1;
      }
    }
    if (character === "{") {
      index += 1;
      skipWhitespace();
      if (input[index] === "}") {
        index += 1;
        return true;
      }
      while (true) {
        skipWhitespace();
        if (!parseString()) return false;
        skipWhitespace();
        if (input[index] !== ":") return false;
        index += 1;
        if (!parseValue(depth + 1)) return false;
        skipWhitespace();
        if (input[index] === "}") {
          index += 1;
          return true;
        }
        if (input[index] !== ",") return false;
        index += 1;
      }
    }
    return false;
  };

  const valid = parseValue(0);
  skipWhitespace();
  return valid && index === input.length;
}

export function parseSessionJsonl(
  input: string,
  recordId?: string,
): SessionParseResult {
  const diagnostics: CofficeDiagnostic[] = [];
  const metadata: SessionMetadata = { events: [] };

  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const recordType = topLevelRecordType(line);
    if (
      recordType !== undefined &&
      !SESSION_METADATA_RECORD_TYPES.has(recordType)
    ) {
      continue;
    }
    if (recordType === "event_msg") {
      const event = shallowEventMetadata(line);
      if (event) {
        const safeStatusEvent = SAFE_STATUS_EVENT_TYPES.has(event.type);
        if (
          safeStatusEvent &&
          CONTENT_BEARING_STATUS_EVENT_TYPES.has(event.type) &&
          line.length > MAX_DEEP_CONTENT_STATUS_EVENT_BYTES
        ) {
          // Large message/reasoning payloads are private content, not required
          // status evidence. Skip them conservatively instead of monopolizing
          // the server thread with a deep syntax scan; index updatedAt remains
          // the activity fallback.
          continue;
        }
        if (safeStatusEvent && hasValidJsonSyntax(line)) {
          metadata.lastEventAt = event.timestamp;
          if (isTurnStartedEvent(event.type) && !metadata.startedAt) {
            metadata.startedAt = event.timestamp;
          }
          metadata.events.push(event);
          continue;
        }
        if (event.type !== "token_count" && !safeStatusEvent) {
          // Irrelevant event payloads can contain very large private content.
          // They do not affect status, so avoid a deep whole-line syntax scan;
          // the bounded index timestamp remains their activity fallback.
          continue;
        }
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      diagnostics.push({
        code: "SESSION_RECORD_SKIPPED",
        message: "A malformed session record was skipped.",
        severity: "warning",
        source: "session_file",
        recordId,
      });
      continue;
    }
    if (!isRecord(parsed)) continue;

    const timestamp = safeIsoTimestamp(parsed.timestamp);
    const payload = isRecord(parsed.payload) ? parsed.payload : undefined;
    if (!payload) continue;

    if (parsed.type === "session_meta") {
      if (!metadata.id && typeof payload.id === "string")
        metadata.id = payload.id;
      if (!metadata.cwd && typeof payload.cwd === "string")
        metadata.cwd = payload.cwd;
      const sessionTimestamp = safeIsoTimestamp(payload.timestamp) ?? timestamp;
      if (
        sessionTimestamp &&
        (!metadata.startedAt || sessionTimestamp < metadata.startedAt)
      ) {
        metadata.startedAt = sessionTimestamp;
      }
      continue;
    }

    if (parsed.type === "turn_context") {
      if (typeof payload.cwd === "string") metadata.cwd = payload.cwd;
      if (typeof payload.model === "string") metadata.model = payload.model;
      continue;
    }

    if (
      parsed.type !== "event_msg" ||
      !timestamp ||
      typeof payload.type !== "string"
    )
      continue;
    metadata.lastEventAt = timestamp;
    if (payload.type === "token_count") {
      const info = isRecord(payload.info) ? payload.info : undefined;
      const lastUsage = isRecord(info?.last_token_usage)
        ? info.last_token_usage
        : undefined;
      const totalUsage = isRecord(info?.total_token_usage)
        ? info.total_token_usage
        : undefined;
      const contextTokens = safeCount(lastUsage?.total_tokens);
      const contextWindow = safeCount(info?.model_context_window);
      const cumulativeTokens = safeCount(totalUsage?.total_tokens);
      if (contextTokens !== undefined && contextWindow) {
        metadata.tokenUsage = {
          contextTokens,
          contextWindow,
          ...(cumulativeTokens !== undefined ? { cumulativeTokens } : {}),
          timestamp,
        };
      }
    }
    if (isTurnStartedEvent(payload.type) && !metadata.startedAt)
      metadata.startedAt = timestamp;
    if (SAFE_STATUS_EVENT_TYPES.has(payload.type)) {
      const affectsTurnStatus = parsedEventAffectsTurnStatus(
        payload.type,
        payload,
      );
      metadata.events.push({
        type: payload.type,
        timestamp,
        ...(affectsTurnStatus === undefined ? {} : { affectsTurnStatus }),
      });
    }
  }

  metadata.events.sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
  return { metadata, diagnostics };
}

/**
 * Selects the bounded evidence needed by the snapshot projection without
 * parsing every event/content record in the session tail. Status reduction
 * only consumes the latest mapped event, so older status lines are irrelevant.
 */
export function selectSessionSummaryJsonl(input: string): string {
  const lines = input.split(/\r?\n/).filter(Boolean);
  const selected = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      topLevelRecordType(line) === "session_meta" &&
      line.length <= MAX_DEEP_CONTENT_STATUS_EVENT_BYTES &&
      hasValidJsonSyntax(line)
    ) {
      selected.add(index);
      break;
    }
  }

  let hasTurnContext = false;
  let hasTokenCount = false;
  let hasStatusEvent = false;
  let hasMalformedCandidate = false;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (
      hasTurnContext &&
      hasTokenCount &&
      hasStatusEvent &&
      hasMalformedCandidate
    )
      break;
    const line = lines[index];
    if (line.length > MAX_DEEP_CONTENT_STATUS_EVENT_BYTES) continue;
    const recordType = topLevelRecordType(line);
    if (
      !hasMalformedCandidate &&
      recordType === undefined &&
      line.trimStart().startsWith("{")
    ) {
      selected.add(index);
      hasMalformedCandidate = true;
      continue;
    }
    if (!hasTurnContext && recordType === "turn_context") {
      if (hasValidJsonSyntax(line)) {
        selected.add(index);
        hasTurnContext = true;
      }
      continue;
    }
    if (recordType !== "event_msg") continue;
    const event = shallowEventMetadata(line);
    if (!event) continue;
    if (!hasTokenCount && event.type === "token_count") {
      if (hasValidJsonSyntax(line)) {
        selected.add(index);
        hasTokenCount = true;
      }
      continue;
    }
    if (!hasStatusEvent && SAFE_STATUS_EVENT_TYPES.has(event.type)) {
      if (hasValidJsonSyntax(line)) {
        selected.add(index);
        hasStatusEvent = true;
      }
    }
  }

  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => lines[index])
    .join("\n");
}

function getCodexRoot(): string {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) throw new Error("No user profile directory is available.");
  // The Codex root is runtime-only local data; never trace user-profile files into a build.
  return path.join(/*turbopackIgnore: true*/ home, ".codex");
}

async function readTail(filePath: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    const text = buffer.toString("utf8");
    return stat.size > length ? text.replace(/^[^\r\n]*(?:\r?\n)?/, "") : text;
  } finally {
    await handle.close();
  }
}

async function readBoundedUtf8File(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (stat.size > maxBytes)
      throw new Error("Bounded metadata file is too large");
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

function summaryHasStatusEvidence(summary: string): boolean {
  return summary.split(/\r?\n/).some((line) => {
    if (topLevelRecordType(line) !== "event_msg") return false;
    const event = shallowEventMetadata(line);
    return Boolean(event && SAFE_STATUS_EVENT_TYPES.has(event.type));
  });
}

async function readSessionSummary(
  handle: FileHandle,
  size: number,
): Promise<string> {
  if (size <= SESSION_SUMMARY_HEAD_BYTES + SESSION_SUMMARY_INITIAL_TAIL_BYTES) {
    return selectSessionSummaryJsonl(
      await handle.readFile({ encoding: "utf8" }),
    );
  }
  const head = Buffer.alloc(SESSION_SUMMARY_HEAD_BYTES);
  await handle.read(head, 0, head.length, 0);
  const headText = head.toString("utf8").replace(/[^\r\n]*$/, "");
  let tailLength = Math.min(
    SESSION_SUMMARY_INITIAL_TAIL_BYTES,
    size - head.length,
  );

  while (true) {
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tail.length, size - tail.length);
    const tailText = tail.toString("utf8").replace(/^[^\r\n]*(?:\r?\n)?/, "");
    const summary = selectSessionSummaryJsonl(`${headText}\n${tailText}`);
    if (
      summaryHasStatusEvidence(summary) ||
      tailLength >= MAX_SESSION_TAIL_BYTES ||
      tailLength >= size - head.length
    ) {
      return summary;
    }
    tailLength = Math.min(MAX_SESSION_TAIL_BYTES, tailLength * 2);
  }
}

export interface SessionFile {
  filePath: string;
  sessionId: string;
  location: SessionLocation;
}

export type SessionLocation = "live" | "archived";

function sessionIdFromFilename(filePath: string): string | undefined {
  const match =
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(
      filePath,
    );
  return match?.[1];
}

/**
 * UUIDv7 ids encode their creation Unix timestamp in milliseconds in the first
 * 48 bits (first 12 hex digits). Returns that value, or undefined for ids that
 * are not UUIDv7 (including legacy v4 ids and malformed strings). UUIDv7 values
 * are far below Number.MAX_SAFE_INTEGER, so a plain integer parse is exact.
 */
function uuidv7TimestampMs(id: string): number | undefined {
  const match =
    /^([0-9a-f]{8})-([0-9a-f]{4})-7([0-9a-f]{3})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(
      id,
    );
  if (!match) return undefined;
  const timestampMilliseconds = Number.parseInt(`${match[1]}${match[2]}`, 16);
  if (!Number.isInteger(timestampMilliseconds) || timestampMilliseconds < 0)
    return undefined;
  return timestampMilliseconds;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function utcDayPath(date: Date): string {
  return `${date.getUTCFullYear()}/${twoDigits(date.getUTCMonth() + 1)}/${twoDigits(date.getUTCDate())}`;
}

function localDayPath(date: Date): string {
  return `${date.getFullYear()}/${twoDigits(date.getMonth() + 1)}/${twoDigits(date.getDate())}`;
}

/**
 * Candidate `sessions/YYYY/MM/DD` directories for a UUIDv7 id. The session's
 * calendar day is derived from the encoded timestamp; the directory may be
 * keyed in UTC or local time, so both are considered plus the adjacent UTC day
 * to absorb a timezone offset. Returns undefined for non-v7 ids so the caller
 * can fall back to a recursive scan for those.
 */
function uuidv7DayDirectories(id: string): string[] | undefined {
  const milliseconds = uuidv7TimestampMs(id);
  if (milliseconds === undefined) return undefined;
  const oneDayMilliseconds = 24 * 60 * 60 * 1_000;
  const dayDirectories = new Set<string>();
  for (const offset of [-oneDayMilliseconds, 0, oneDayMilliseconds]) {
    const instant = new Date(milliseconds + offset);
    dayDirectories.add(utcDayPath(instant));
    dayDirectories.add(localDayPath(instant));
  }
  return [...dayDirectories].sort();
}

/**
 * Finds only files whose UUID is in the metadata allowlist. Directory entries
 * are filtered before stat/read, and the archived tree is skipped entirely
 * when every requested live session has already been found.
 *
 * UUIDv7 ids are resolved through a direct-date fast path: only the matching
 * `sessions/YYYY/MM/DD` directories (derived from the encoded timestamp) plus
 * the flat `archived_sessions` directory are read, avoiding the cold-start cost
 * of recursively walking the entire sessions tree. The recursive fallback is
 * retained only for unresolved ids and non-v7 ids. Results are deterministic.
 */
export async function discoverSessionFiles(
  root: string,
  targetIds: ReadonlySet<string>,
): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  const targetOrder = new Map(
    [...targetIds].map((id, index) => [id, index] as const),
  );
  const remaining = new Set(targetIds);
  const v7Ids = new Set<string>();
  const candidateDirectories = new Set<string>();

  for (const id of targetIds) {
    const dayDirectories = uuidv7DayDirectories(id);
    if (dayDirectories === undefined) continue;
    v7Ids.add(id);
    for (const dayDirectory of dayDirectories)
      candidateDirectories.add(dayDirectory);
  }

  /**
   * Reads a single directory level, collecting allowlisted files. When
   * `onlyV7` is set, non-v7 ids are left to the recursive fallback so the live
   * `sessions` tree always wins over the archived tree for those ids. Missing
   * or unreadable directories are tolerated.
   */
  async function scanDirectory(
    directory: string,
    location: SessionLocation,
    onlyV7 = false,
  ): Promise<void> {
    if (remaining.size === 0) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (remaining.size === 0) return;
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const sessionId = sessionIdFromFilename(entry.name);
      if (!sessionId || !remaining.has(sessionId)) continue;
      if (onlyV7 && !v7Ids.has(sessionId)) continue;
      files.push({
        filePath: path.join(/*turbopackIgnore: true*/ directory, entry.name),
        sessionId,
        location,
      });
      remaining.delete(sessionId);
    }
  }

  async function visit(
    directory: string,
    location: SessionLocation,
  ): Promise<void> {
    if (remaining.size === 0) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (remaining.size === 0) return;
      const entryPath = path.join(
        /*turbopackIgnore: true*/ directory,
        entry.name,
      );
      if (entry.isDirectory()) {
        await visit(entryPath, location);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const sessionId = sessionIdFromFilename(entry.name);
        if (!sessionId || !remaining.has(sessionId)) continue;
        files.push({ filePath: entryPath, sessionId, location });
        remaining.delete(sessionId);
      }
    }
  }

  // Fast path: read only the sessions/YYYY/MM/DD directories derived from the
  // target UUIDv7 ids, then the flat archived_sessions directory. Both are
  // restricted to v7 ids; unresolved v7 ids and non-v7 ids defer to the
  // recursive fallback below.
  await mapWithConcurrency(
    [...candidateDirectories].sort(),
    SESSION_READ_CONCURRENCY,
    async (dayDirectory) => {
      await scanDirectory(
        path.join(/*turbopackIgnore: true*/ root, "sessions", dayDirectory),
        "live",
        true,
      );
    },
  );
  await scanDirectory(
    path.join(/*turbopackIgnore: true*/ root, "archived_sessions"),
    "archived",
    true,
  );

  // Recursive fallback for unresolved v7 ids and non-v7 ids only.
  if (remaining.size > 0) {
    for (const directory of SESSION_DIRECTORIES) {
      await visit(
        path.join(/*turbopackIgnore: true*/ root, directory),
        directory === "sessions" ? "live" : "archived",
      );
    }
  }

  return files.sort(
    (left, right) =>
      (targetOrder.get(left.sessionId) ?? Number.MAX_SAFE_INTEGER) -
      (targetOrder.get(right.sessionId) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * Enumerates the live sessions tree without reading session contents. The
 * bounded session-index tail supplies labels when available, but cannot define
 * roster membership because an old live session can fall outside that tail.
 */
export async function discoverLiveSessionFiles(
  root: string,
): Promise<SessionFile[]> {
  const discovered = new Map<string, SessionFile>();

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const entryPath = path.join(
        /*turbopackIgnore: true*/ directory,
        entry.name,
      );
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const sessionId = sessionIdFromFilename(entry.name);
      if (!sessionId || discovered.has(sessionId)) continue;
      discovered.set(sessionId, {
        filePath: entryPath,
        sessionId,
        location: "live",
      });
    }
  }

  await visit(path.join(/*turbopackIgnore: true*/ root, "sessions"));
  return [...discovered.values()].sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId),
  );
}

function fallbackSessionUpdatedAt(sessionId: string): string {
  const timestamp = uuidv7TimestampMs(sessionId);
  return new Date(timestamp ?? 0).toISOString();
}

interface CachedSessionParse {
  signature: string;
  parsed: SessionParseResult;
}

const sessionParseCache = new Map<string, CachedSessionParse>();
let sessionParseCacheLimit = MIN_SESSION_PARSE_CACHE_ENTRIES;

function configureSessionParseCache(files: readonly SessionFile[]): void {
  const livePaths = new Set(files.map((file) => file.filePath));
  for (const filePath of sessionParseCache.keys()) {
    if (!livePaths.has(filePath)) sessionParseCache.delete(filePath);
  }
  // Essential metadata for the complete live roster must not thrash merely
  // because the roster exceeds a fixed cache constant. The cache remains
  // bounded to the current authoritative roster (with a small test/dev floor).
  sessionParseCacheLimit = Math.max(
    MIN_SESSION_PARSE_CACHE_ENTRIES,
    livePaths.size,
  );
}

function rememberSessionParse(
  filePath: string,
  value: CachedSessionParse,
): void {
  sessionParseCache.delete(filePath);
  sessionParseCache.set(filePath, value);
  while (sessionParseCache.size > sessionParseCacheLimit) {
    const oldest = sessionParseCache.keys().next().value as string | undefined;
    if (!oldest) break;
    sessionParseCache.delete(oldest);
  }
}

function hasUsableSessionMetadata(metadata: SessionMetadata): boolean {
  return Boolean(
    metadata.id ||
    metadata.cwd ||
    metadata.model ||
    metadata.startedAt ||
    metadata.lastEventAt ||
    metadata.events.length > 0 ||
    metadata.tokenUsage,
  );
}

function earlierTimestamp(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function laterTimestamp(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function mergeSessionMetadata(
  previous: SessionMetadata,
  next: SessionMetadata,
): SessionMetadata {
  const events = new Map<string, SessionStatusEvent>();
  for (const event of [...previous.events, ...next.events]) {
    events.set(`${event.type}\u0000${event.timestamp}`, event);
  }
  const mergedEvents = [...events.values()]
    .sort(
      (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
    )
    .slice(-512);
  const previousUsage = previous.tokenUsage;
  const nextUsage = next.tokenUsage;
  const tokenUsage =
    !previousUsage ||
    (nextUsage &&
      Date.parse(nextUsage.timestamp) >= Date.parse(previousUsage.timestamp))
      ? nextUsage
      : previousUsage;

  return {
    ...(previous.id || next.id ? { id: previous.id ?? next.id } : {}),
    ...(next.cwd || previous.cwd ? { cwd: next.cwd ?? previous.cwd } : {}),
    ...(next.model || previous.model
      ? { model: next.model ?? previous.model }
      : {}),
    ...(earlierTimestamp(previous.startedAt, next.startedAt)
      ? { startedAt: earlierTimestamp(previous.startedAt, next.startedAt) }
      : {}),
    ...(laterTimestamp(previous.lastEventAt, next.lastEventAt)
      ? { lastEventAt: laterTimestamp(previous.lastEventAt, next.lastEventAt) }
      : {}),
    events: mergedEvents,
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

function unavailableSessionFallback(
  file: SessionFile,
  cached: CachedSessionParse,
): SessionParseResult {
  return {
    metadata: cached.parsed.metadata,
    diagnostics: [
      {
        code: "SESSION_FILE_UNAVAILABLE",
        message:
          "A session metadata file could not be refreshed; the last valid metadata was retained.",
        severity: "warning",
        source: "session_file",
        recordId: file.sessionId,
      },
    ],
  };
}

async function readSessionMetadataFileAttempt(
  file: SessionFile,
  retryOnRace: boolean,
): Promise<SessionParseResult> {
  const cached = sessionParseCache.get(file.filePath);
  let pathStat;
  try {
    pathStat = await fs.stat(file.filePath);
  } catch (error) {
    if (cached) return unavailableSessionFallback(file, cached);
    throw error;
  }
  const pathSignature = `${pathStat.size}:${pathStat.mtimeMs}`;
  if (cached?.signature === pathSignature) {
    rememberSessionParse(file.filePath, cached);
    return cached.parsed;
  }

  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(file.filePath, "r");
    const openedStat = await handle.stat();
    const openedSignature = `${openedStat.size}:${openedStat.mtimeMs}`;
    if (openedSignature !== pathSignature) {
      await handle.close();
      handle = undefined;
      if (retryOnRace) return await readSessionMetadataFileAttempt(file, false);
      if (cached) return unavailableSessionFallback(file, cached);
      throw new Error("Session metadata changed during a bounded read.");
    }

    const parsed = parseSessionJsonl(
      await readSessionSummary(handle, openedStat.size),
      file.sessionId,
    );
    if (cached && parsed.diagnostics.length === 0) {
      const refreshed = {
        ...parsed,
        metadata: hasUsableSessionMetadata(parsed.metadata)
          ? mergeSessionMetadata(cached.parsed.metadata, parsed.metadata)
          : cached.parsed.metadata,
      };
      rememberSessionParse(file.filePath, {
        signature: openedSignature,
        parsed: refreshed,
      });
      return refreshed;
    }
    if (parsed.diagnostics.length > 0 && cached) {
      const merged = {
        metadata: hasUsableSessionMetadata(parsed.metadata)
          ? mergeSessionMetadata(cached.parsed.metadata, parsed.metadata)
          : cached.parsed.metadata,
        diagnostics: parsed.diagnostics,
      };
      if (hasUsableSessionMetadata(parsed.metadata)) {
        rememberSessionParse(file.filePath, {
          signature: openedSignature,
          parsed: merged,
        });
      }
      return merged;
    }
    if (parsed.diagnostics.length === 0) {
      rememberSessionParse(file.filePath, {
        signature: openedSignature,
        parsed,
      });
    }
    return parsed;
  } catch (error) {
    if (!cached) throw error;
    return unavailableSessionFallback(file, cached);
  } finally {
    await handle?.close();
  }
}

export async function readSessionMetadataFile(
  file: SessionFile,
): Promise<SessionParseResult> {
  return await readSessionMetadataFileAttempt(file, true);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => await worker(),
    ),
  );
  return results;
}

export async function enrichProjectRepositories(
  projects: readonly SourceProject[],
  reader: (
    rootPath: string,
  ) => Promise<RepositoryEvidence> = readRepositoryEvidence,
): Promise<SourceProject[]> {
  const roots = projects.flatMap((project, projectIndex) =>
    project.rootPaths.map((rootPath, rootIndex) => ({
      projectIndex,
      rootIndex,
      rootPath,
    })),
  );
  if (roots.length > MAX_REPOSITORY_ROOTS_PER_REFRESH) {
    return projects.map(markRepositoryCollectionBoundedOut);
  }
  const observed = await mapWithConcurrency(
    roots,
    REPOSITORY_ENRICHMENT_CONCURRENCY,
    async ({ projectIndex, rootIndex, rootPath }) => {
      let evidence: RepositoryEvidence;
      try {
        evidence = await reader(rootPath);
      } catch {
        evidence = {
          availability: "unavailable",
          source: "git",
          observedAt: new Date().toISOString(),
        };
      }
      return { projectIndex, rootIndex, evidence };
    },
  );
  const repositories = projects.map(
    (project) => new Array<RepositoryEvidence>(project.rootPaths.length),
  );
  for (const { projectIndex, rootIndex, evidence } of observed) {
    repositories[projectIndex]![rootIndex] = evidence;
  }
  return projects.map((project, index) => {
    const projectRepositories = repositories[index]!;
    return {
      ...project,
      repositories: projectRepositories,
      ...(projectRepositories[0] ? { repository: projectRepositories[0] } : {}),
    };
  });
}

function markRepositoryCollectionBoundedOut(
  project: SourceProject,
): SourceProject {
  const safe = { ...project };
  delete safe.repository;
  delete safe.repositories;
  return { ...safe, repositoryCollectionBoundedOut: true };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export interface ReadCodexSourceOptions {
  /**
   * Defers session metadata and repository evidence so the lifecycle roster
   * can publish before background enrichment.
   */
  deferSessionMetadata?: boolean;
  /** Read activity without spawning Git processes for repository evidence. */
  includeRepositoryEvidence?: boolean;
  /** Test/integration seam; production uses the privacy-isolated Git reader. */
  repositoryReader?: (rootPath: string) => Promise<RepositoryEvidence>;
}

export async function readCodexSource(
  options: ReadCodexSourceOptions = {},
): Promise<CodexSourceSnapshot> {
  const deferSessionMetadata = options.deferSessionMetadata === true;
  const root = getCodexRoot();
  const diagnostics: CofficeDiagnostic[] = [];
  let inventory: SourceProjectInventory = {
    projects: [],
    threadRootHints: new Map(),
    threadProjectAssignments: new Map(),
    invalidThreadProjectAssignments: new Set(),
    currentAssignmentsAvailable: false,
    diagnostics: [],
  };
  let globalStateAvailable = false;
  let sessionIndexAvailable = false;
  let rosterAvailable = false;
  let sessions: SessionIndexRecord[] = [];

  try {
    const globalState = await readBoundedUtf8File(
      path.join(/*turbopackIgnore: true*/ root, GLOBAL_STATE_FILE),
      MAX_GLOBAL_STATE_BYTES,
    );
    inventory = parseSavedProjectsJson(globalState);
    diagnostics.push(...inventory.diagnostics);
    globalStateAvailable = !inventory.diagnostics.some(
      (item) => item.severity === "error",
    );
  } catch {
    diagnostics.push({
      code: "GLOBAL_STATE_UNAVAILABLE",
      message: "Codex global state is unavailable.",
      severity: "error",
      source: "global_state",
    });
  }

  try {
    const indexText = await readTail(
      path.join(/*turbopackIgnore: true*/ root, SESSION_INDEX_FILE),
      MAX_INDEX_BYTES,
    );
    const index = parseSessionIndexJsonl(indexText);
    sessions = index.records;
    diagnostics.push(...index.diagnostics);
    sessionIndexAvailable = true;
  } catch {
    diagnostics.push({
      code: "SESSION_INDEX_UNAVAILABLE",
      message: "Codex session index is unavailable.",
      severity: "error",
      source: "session_index",
    });
  }

  const threadState = readCodexThreadState(
    path.join(/*turbopackIgnore: true*/ root, THREAD_STATE_FILE),
  );
  if (threadState.status === "ready") {
    rosterAvailable = true;
  } else if (threadState.status === "missing") {
    // Older Codex profiles do not have the current thread database. Preserve
    // the bounded legacy index + live-rollout fallback for those profiles.
    rosterAvailable = sessionIndexAvailable;
  } else {
    diagnostics.push({
      code:
        threadState.status === "unsupported"
          ? "THREAD_STATE_SCHEMA_UNSUPPORTED"
          : "THREAD_STATE_UNAVAILABLE",
      message:
        threadState.status === "unsupported"
          ? "Codex visible-thread metadata uses an unsupported schema."
          : "Codex visible-thread metadata is temporarily unavailable.",
      severity: "error",
      source: "thread_state",
    });
  }

  let sessionFiles: SessionFile[] = [];
  try {
    sessionFiles = await discoverLiveSessionFiles(root);
  } catch {
    diagnostics.push({
      code: "SESSION_DIRECTORY_UNAVAILABLE",
      message: "Codex session directories are unavailable.",
      severity: "warning",
      source: "session_file",
    });
  }
  const indexedSessionById = new Map(
    sessions.map((session) => [session.id, session] as const),
  );
  let sessionLocations: Map<string, SessionLocation>;
  if (threadState.status === "ready") {
    const visibleThreadIds = new Set(
      threadState.threads.map((thread) => thread.id),
    );
    sessions = threadState.threads.map((thread): SessionIndexRecord => {
      const indexed = indexedSessionById.get(thread.id);
      return {
        id: thread.id,
        // Explicit state names are newest when present; session_index names are
        // the established user-facing title source. The state title is already
        // constrained to concise, non-prompt-like metadata by its adapter.
        title: thread.name ?? indexed?.title ?? thread.title ?? "",
        updatedAt:
          threadStateTimestamp(thread.updatedAt) ??
          indexed?.updatedAt ??
          fallbackSessionUpdatedAt(thread.id),
      };
    });
    sessionFiles = sessionFiles.filter((file) =>
      visibleThreadIds.has(file.sessionId),
    );
    sessionLocations = new Map(
      sessions.map((session) => [session.id, "live"] as const),
    );
  } else if (threadState.status === "missing") {
    sessions = sessionFiles.map(
      (file): SessionIndexRecord =>
        indexedSessionById.get(file.sessionId) ?? {
          id: file.sessionId,
          title: "",
          updatedAt: fallbackSessionUpdatedAt(file.sessionId),
        },
    );
    sessionLocations = new Map(
      sessionFiles.map((file) => [file.sessionId, file.location] as const),
    );
  } else {
    // Fail closed. Publishing every rollout file when current visibility cannot
    // be read would resurrect hidden/internal tasks; SnapshotCache retains the
    // last valid roster instead.
    sessions = [];
    sessionFiles = [];
    sessionLocations = new Map();
  }
  const sessionMetadata = new Map<string, SessionMetadata>();
  configureSessionParseCache(sessionFiles);
  if (deferSessionMetadata) {
    diagnostics.push({
      code: "SESSION_METADATA_DEFERRED",
      message:
        "Session metadata and repository evidence are enriching in the background.",
      severity: "warning",
      source: "adapter",
    });
  } else {
    const rosterIds = new Set(sessions.map((session) => session.id));
    try {
      // Cwd and structural status events are essential roster evidence, not
      // optional enrichment. Read them for every admitted top-level session so
      // age, completion, or roster size cannot silently degrade status. Current
      // project membership comes from explicit Codex assignments, never cwd.
      // Each read remains byte-bounded and the parse cache memory-bounded.
      const files = sessionFiles.filter((file) => file.location === "live");
      const results = await mapWithConcurrency(
        files,
        SESSION_ENRICHMENT_CONCURRENCY,
        async (file) => {
          try {
            return { file, parsed: await readSessionMetadataFile(file) };
          } catch {
            return { file };
          } finally {
            // Parsing is CPU-bound JavaScript. Yield after every file so route
            // handlers and rendering work are not starved by a large roster.
            await yieldToEventLoop();
          }
        },
      );
      for (const { file, parsed } of results) {
        if (parsed) {
          const id = file.sessionId;
          if (rosterIds.has(id)) sessionMetadata.set(id, parsed.metadata);
          diagnostics.push(...parsed.diagnostics);
        } else {
          diagnostics.push({
            code: "SESSION_FILE_UNAVAILABLE",
            message: "A session metadata file could not be read.",
            severity: "warning",
            source: "session_file",
            recordId: file.sessionId,
          });
        }
      }
    } catch {
      diagnostics.push({
        code: "SESSION_DIRECTORY_UNAVAILABLE",
        message: "Codex session metadata directories are unavailable.",
        severity: "warning",
        source: "session_file",
      });
    }
  }

  sessions = sessions.map((session) => {
    const lastEventAt = sessionMetadata.get(session.id)?.lastEventAt;
    return lastEventAt ? { ...session, updatedAt: lastEventAt } : session;
  });

  if (
    inventory.projects.length &&
    options.includeRepositoryEvidence !== false
  ) {
    const repositoryRootCount = inventory.projects.reduce(
      (total, project) => total + project.rootPaths.length,
      0,
    );
    if (repositoryRootCount > MAX_REPOSITORY_ROOTS_PER_REFRESH) {
      inventory.projects = inventory.projects.map(
        markRepositoryCollectionBoundedOut,
      );
      diagnostics.push({
        code: "REPOSITORY_ENRICHMENT_BOUND_EXCEEDED",
        message:
          "Repository evidence is unavailable because the source-wide collection safety bound was exceeded.",
        severity: "warning",
        source: "adapter",
      });
    } else if (!deferSessionMetadata) {
      inventory.projects = await enrichProjectRepositories(
        inventory.projects,
        options.repositoryReader,
      );
    }
  }

  return {
    projects: inventory.projects,
    threadRootHints: inventory.threadRootHints,
    threadProjectAssignments: inventory.threadProjectAssignments,
    invalidThreadProjectAssignments: inventory.invalidThreadProjectAssignments,
    currentAssignmentsAvailable: inventory.currentAssignmentsAvailable,
    sessions,
    sessionLocations,
    sessionMetadata,
    diagnostics,
    globalStateAvailable,
    sessionIndexAvailable,
    rosterAvailable,
  };
}
