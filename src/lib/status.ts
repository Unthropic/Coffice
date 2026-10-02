import type { NormalizedStatusValue, StatusEvidence } from "./domain";

export interface SessionStatusEvent {
  type: string;
  timestamp: string;
  source?: string;
  /** Structural protocol outcome only; error messages are never retained. */
  affectsTurnStatus?: boolean;
}

export interface ReduceStatusOptions {
  now?: Date;
  staleAfterMs?: number;
  fallbackTimestamp?: string;
  sourceAvailable?: boolean;
  persistentStaff?: boolean;
}

const DEFAULT_STALE_AFTER_MS = 2 * 60 * 1000;
const STARTING_WINDOW_MS = 15 * 1000;
const RESIDENT_COMPLETION_WINDOW_MS = 60 * 1000;

export function authoritativeBlockedStatus(
  timestamp: string,
  stale = false,
): StatusEvidence {
  return {
    value: "blocked",
    provenance: "observed",
    source: "codex-app-server:thread/goal/get",
    timestamp,
    stale,
    confidence: 1,
  };
}

/**
 * Structural Codex event discriminators only. No prompt, response, reasoning,
 * command, tool argument, or result content participates in status mapping.
 * End events return to generic active because they prove completion of one
 * activity, not that the activity remains in progress.
 */
const EVENT_STATUS: Readonly<
  Record<string, { value: NormalizedStatusValue; confidence?: number }>
> = {
  user_message: { value: "queued", confidence: 0.9 },
  task_started: { value: "active", confidence: 1 },
  turn_started: { value: "active", confidence: 1 },
  // Current Codex rollouts use item lifecycle events. An item finishing is
  // evidence of turn activity, never evidence that the entire turn finished.
  item_started: { value: "active", confidence: 1 },
  item_completed: { value: "active", confidence: 0.9 },
  plan_update: { value: "planning", confidence: 1 },
  agent_reasoning: { value: "thinking", confidence: 1 },
  web_search_begin: { value: "researching", confidence: 1 },
  web_search_end: { value: "active", confidence: 0.9 },
  image_generation_begin: { value: "running", confidence: 1 },
  image_generation_end: { value: "active", confidence: 0.9 },
  mcp_tool_call_begin: { value: "running", confidence: 1 },
  mcp_tool_call_end: { value: "active", confidence: 0.9 },
  exec_command_begin: { value: "running", confidence: 1 },
  exec_command_end: { value: "active", confidence: 0.9 },
  patch_apply_begin: { value: "coding", confidence: 1 },
  patch_apply_end: { value: "active", confidence: 0.95 },
  entered_review_mode: { value: "reviewing", confidence: 1 },
  exited_review_mode: { value: "active", confidence: 0.9 },
  exec_approval_request: { value: "waiting_for_user", confidence: 1 },
  apply_patch_approval_request: { value: "waiting_for_user", confidence: 1 },
  request_permissions: { value: "waiting_for_user", confidence: 1 },
  request_user_input: { value: "waiting_for_user", confidence: 1 },
  elicitation_request: { value: "waiting_for_user", confidence: 1 },
  agent_message: { value: "active", confidence: 0.85 },
  task_complete: { value: "completed", confidence: 1 },
  turn_complete: { value: "completed", confidence: 1 },
  error: { value: "failed", confidence: 1 },
  turn_aborted: { value: "idle", confidence: 0.65 },
};

function eventStatus(event: SessionStatusEvent) {
  if (event.type === "error" && event.affectsTurnStatus === false) {
    return undefined;
  }
  if (event.type === "turn_complete" && event.affectsTurnStatus === true) {
    return { value: "failed" as const, confidence: 1 };
  }
  return EVENT_STATUS[event.type];
}

function validTimestamp(value: string | undefined, fallback: string): string {
  if (value && Number.isFinite(Date.parse(value)))
    return new Date(value).toISOString();
  return fallback;
}

export function reduceSessionStatus(
  events: readonly SessionStatusEvent[],
  options: ReduceStatusOptions = {},
): StatusEvidence {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const fallbackTimestamp = validTimestamp(options.fallbackTimestamp, nowIso);

  if (options.sourceAvailable === false) {
    return {
      value: "offline",
      provenance: "observed",
      source: "codex-local:unavailable",
      timestamp: fallbackTimestamp,
      stale: true,
      confidence: 1,
    };
  }

  const normalized = events
    .map((event) => ({
      ...event,
      parsedAt: Date.parse(event.timestamp),
      mapping: eventStatus(event),
    }))
    .filter(
      (
        event,
      ): event is typeof event & {
        mapping: NonNullable<typeof event.mapping>;
      } => Boolean(event.mapping) && Number.isFinite(event.parsedAt),
    )
    .sort((left, right) => left.parsedAt - right.parsedAt);

  const latest = normalized.at(-1);
  if (!latest) {
    const timestamp = fallbackTimestamp;
    return {
      value: "idle",
      provenance: "inferred",
      source: "session-index:last-updated",
      timestamp,
      stale:
        now.getTime() - Date.parse(timestamp) >
        (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS),
      confidence: 0.55,
    };
  }

  const timestamp = new Date(latest.parsedAt).toISOString();
  const observationAgeMs = Math.max(0, now.getTime() - latest.parsedAt);
  if (
    (latest.type === "task_started" || latest.type === "turn_started") &&
    observationAgeMs <= STARTING_WINDOW_MS
  ) {
    return {
      value: "starting",
      provenance: "observed",
      source: latest.source ?? `session-jsonl:event_msg.${latest.type}`,
      timestamp,
      stale: false,
      confidence: 1,
    };
  }

  if (
    (latest.type === "task_complete" || latest.type === "turn_complete") &&
    latest.mapping.value === "completed" &&
    options.persistentStaff &&
    observationAgeMs > RESIDENT_COMPLETION_WINDOW_MS
  ) {
    return {
      value: "idle",
      provenance: "inferred",
      source: latest.source ?? `session-jsonl:event_msg.${latest.type}`,
      timestamp,
      stale:
        observationAgeMs > (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS),
      confidence: 0.9,
    };
  }

  if (latest.type === "turn_aborted") {
    return {
      value: "idle",
      provenance: "inferred",
      source: latest.source ?? "session-jsonl:event_msg.turn_aborted",
      timestamp,
      stale: true,
      confidence: 0.65,
    };
  }

  const terminal =
    latest.mapping.value === "completed" || latest.mapping.value === "failed";
  const remainsCurrentUntilSuperseded =
    terminal || latest.mapping.value === "waiting_for_user";
  return {
    value: latest.mapping.value,
    provenance: "observed",
    source: latest.source ?? `session-jsonl:event_msg.${latest.type}`,
    timestamp,
    stale:
      !remainsCurrentUntilSuperseded &&
      observationAgeMs > (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS),
    confidence: latest.mapping.confidence,
  };
}
