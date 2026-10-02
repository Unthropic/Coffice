/**
 * Session-liveness projection.
 *
 * Liveness answers one narrow, truthful question: how recently did the local
 * Codex session evidence change? It is derived only from the safe
 * `lastActivityAt` metadata timestamp already present in the normalized
 * snapshot. It is deliberately distinct from semantic status freshness: a
 * worker's status can be stale while its session file is actively changing.
 * Liveness never reinterprets task status, never inspects task content, and
 * never claims that a process is alive — only that evidence moved.
 */

export const SESSION_LIVENESS_LIVE_WINDOW_MS = 60_000;
export const SESSION_LIVENESS_RECENT_WINDOW_MS = 15 * 60_000;

export type SessionLivenessTone = "live" | "recent" | "quiet" | "unknown";

export interface SessionLiveness {
  tone: SessionLivenessTone;
  /** Milliseconds between the evidence timestamp and the reference time. */
  ageMs: number | null;
}

export function resolveSessionLiveness(
  lastActivityAt: string | null | undefined,
  referenceTime: number,
): SessionLiveness {
  if (!lastActivityAt || !Number.isFinite(referenceTime)) {
    return { tone: "unknown", ageMs: null };
  }
  const timestamp = Date.parse(lastActivityAt);
  if (!Number.isFinite(timestamp)) return { tone: "unknown", ageMs: null };
  const ageMs = Math.max(0, referenceTime - timestamp);
  if (ageMs <= SESSION_LIVENESS_LIVE_WINDOW_MS) {
    return { tone: "live", ageMs };
  }
  if (ageMs <= SESSION_LIVENESS_RECENT_WINDOW_MS) {
    return { tone: "recent", ageMs };
  }
  return { tone: "quiet", ageMs };
}

/** Compact fixed-vocabulary age text, e.g. `42s`, `4m`, `3h`, `2d`. */
export function formatSessionAge(ageMs: number): string {
  const clamped = Math.max(0, ageMs);
  if (clamped < 60_000) return `${Math.max(1, Math.floor(clamped / 1_000))}s`;
  if (clamped < 3_600_000) return `${Math.floor(clamped / 60_000)}m`;
  if (clamped < 86_400_000) return `${Math.floor(clamped / 3_600_000)}h`;
  return `${Math.floor(clamped / 86_400_000)}d`;
}

/** Compact chip text. Tone carries the color; the text carries the fact. */
export function sessionLivenessChipText(liveness: SessionLiveness): string {
  if (liveness.tone === "live") return "Live now";
  if (liveness.tone === "unknown") return "No activity signal";
  return `${formatSessionAge(liveness.ageMs ?? 0)} ago`;
}

/** Explicit accessible phrasing so the cue cannot be mistaken for status. */
export function sessionLivenessAriaLabel(liveness: SessionLiveness): string {
  if (liveness.tone === "live") {
    return "Session activity: session file changed within the last minute";
  }
  if (liveness.tone === "recent") {
    return `Session activity: last change ${formatSessionAge(liveness.ageMs ?? 0)} ago`;
  }
  if (liveness.tone === "quiet") {
    return `Session activity: quiet, last change ${formatSessionAge(liveness.ageMs ?? 0)} ago`;
  }
  return "Session activity: no activity timestamp reported";
}

/** Structural task input shared by the campus and room view-models. */
export interface SessionSignalTask {
  lastActivityAt?: string;
  tokenUsage?: {
    contextTokens: number;
    contextWindow: number;
    stale?: boolean;
  } | null;
}

export interface ProjectSignalSummary {
  /** Most-live task liveness in the project. */
  liveness: SessionLiveness;
  /** Tasks whose session evidence changed within the live window. */
  liveCount: number;
  /** Highest reported context-window usage across tasks, if any. */
  maxContextPercent: number | null;
  /** True when the maximum context value comes from stale token evidence. */
  maxContextStale: boolean;
}

const TONE_RANK: Record<SessionLivenessTone, number> = {
  live: 0,
  recent: 1,
  quiet: 2,
  unknown: 3,
};

export function summarizeProjectSignals(
  tasks: readonly SessionSignalTask[],
  referenceTime: number,
): ProjectSignalSummary {
  let best: SessionLiveness = { tone: "unknown", ageMs: null };
  let liveCount = 0;
  let maxContextPercent: number | null = null;
  let maxContextStale = false;

  for (const task of tasks) {
    const liveness = resolveSessionLiveness(task.lastActivityAt, referenceTime);
    if (liveness.tone === "live") liveCount += 1;
    const beatsTone = TONE_RANK[liveness.tone] < TONE_RANK[best.tone];
    const tiesTone =
      liveness.tone === best.tone &&
      (liveness.ageMs ?? Number.POSITIVE_INFINITY) <
        (best.ageMs ?? Number.POSITIVE_INFINITY);
    if (beatsTone || tiesTone) best = liveness;

    const usage = task.tokenUsage;
    if (usage && usage.contextWindow > 0) {
      const percent = Math.round(
        Math.min(1, Math.max(0, usage.contextTokens / usage.contextWindow)) *
          100,
      );
      if (
        maxContextPercent === null ||
        percent > maxContextPercent ||
        (percent === maxContextPercent &&
          maxContextStale &&
          usage.stale !== true)
      ) {
        maxContextPercent = percent;
        maxContextStale = usage.stale === true;
      }
    }
  }

  return { liveness: best, liveCount, maxContextPercent, maxContextStale };
}
