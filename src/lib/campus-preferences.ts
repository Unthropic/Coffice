/**
 * Coffice-owned campus map preferences.
 *
 * These preferences only change how the local campus map is arranged. They
 * never reorder Codex's saved project order, never persist task metadata, and
 * never touch Codex-owned storage. Malformed records fail closed to the
 * defaults so a corrupted value cannot break the map.
 */

export const CAMPUS_PREFERENCES_STORAGE_KEY = "coffice-campus-preferences-v1";

export interface CampusPreferences {
  version: 1;
  /** Sort doors by current canonical Attention, then liveness and saved order. */
  attentionFirst: boolean;
  /** Collapse saved projects with no sessions and no current Attention items. */
  hideQuietWings: boolean;
}

export const DEFAULT_CAMPUS_PREFERENCES: CampusPreferences = {
  version: 1,
  attentionFirst: true,
  hideQuietWings: true,
};

export function parseCampusPreferences(raw: string | null): CampusPreferences {
  if (!raw) return { ...DEFAULT_CAMPUS_PREFERENCES };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) {
      return { ...DEFAULT_CAMPUS_PREFERENCES };
    }
    const record = value as Record<string, unknown>;
    if (record.version !== 1) return { ...DEFAULT_CAMPUS_PREFERENCES };
    return {
      version: 1,
      attentionFirst: record.attentionFirst === true,
      hideQuietWings: record.hideQuietWings === true,
    };
  } catch {
    return { ...DEFAULT_CAMPUS_PREFERENCES };
  }
}

export function serializeCampusPreferences(
  preferences: CampusPreferences,
): string {
  return JSON.stringify({
    version: 1,
    attentionFirst: preferences.attentionFirst === true,
    hideQuietWings: preferences.hideQuietWings === true,
  });
}

/** Signals one door needs for attention-first ordering. */
export interface CampusOrderSignals {
  /** Current canonical Attention total for this exact project route. */
  attentionCount: number;
  /** Tasks whose session evidence changed within the live window. */
  liveCount: number;
}

/**
 * Deterministic attention-first comparator: attention descending, live
 * descending, then the saved Codex order ascending. Holding areas are always
 * pinned last so the foyer never jumps ahead of saved projects.
 */
export function compareCampusProjectsByAttention(
  a: { order: number; holding?: boolean; signals: CampusOrderSignals },
  b: { order: number; holding?: boolean; signals: CampusOrderSignals },
): number {
  const aHolding = a.holding === true ? 1 : 0;
  const bHolding = b.holding === true ? 1 : 0;
  if (aHolding !== bHolding) return aHolding - bHolding;
  if (a.signals.attentionCount !== b.signals.attentionCount) {
    return b.signals.attentionCount - a.signals.attentionCount;
  }
  if (a.signals.liveCount !== b.signals.liveCount) {
    return b.signals.liveCount - a.signals.liveCount;
  }
  return a.order - b.order;
}
