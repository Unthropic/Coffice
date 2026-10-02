import type { AttentionDisposition, AttentionItem } from "./attention-inbox";

// This is a defensive memory bound, not a product capacity. If one mounted app
// observes more distinct events, cues fail quiet instead of forgetting an old
// key and notifying for it again.
const MAX_SESSION_OBSERVED_EVENT_KEYS = 4_096;

export interface AttentionTransitionCueState {
  baselined: boolean;
  observedEventKeys: ReadonlySet<string>;
  batchEventKeys: readonly string[];
  announcementRevision: number;
  saturated: boolean;
}

export interface AttentionTransitionCueInput {
  admissionReady: boolean;
  items: readonly AttentionItem[];
  dispositionFor: (eventKey: string) => AttentionDisposition | undefined;
}

export function createInitialAttentionTransitionCueState(): AttentionTransitionCueState {
  return {
    baselined: false,
    observedEventKeys: new Set(),
    batchEventKeys: [],
    announcementRevision: 0,
    saturated: false,
  };
}

function canonicalItemsByKey(
  items: readonly AttentionItem[],
): Map<string, AttentionItem> {
  const canonical = new Map<string, AttentionItem>();
  for (const item of items) {
    if (!canonical.has(item.eventKey)) canonical.set(item.eventKey, item);
  }
  return canonical;
}

/**
 * Advances session-only cue memory from the already canonical Attention list.
 * A non-authoritative input is deliberately a no-op: it neither establishes a
 * baseline nor consumes the novelty of an event first seen in stale data.
 */
export function reconcileAttentionTransitionCueState(
  state: AttentionTransitionCueState,
  input: AttentionTransitionCueInput,
): AttentionTransitionCueState {
  if (!input.admissionReady || state.saturated) return state;

  const current = canonicalItemsByKey(input.items);
  const currentKeys = [...current.keys()];
  const newEventKeys = currentKeys.filter(
    (eventKey) => !state.observedEventKeys.has(eventKey),
  );

  if (
    state.observedEventKeys.size + newEventKeys.length >
    MAX_SESSION_OBSERVED_EVENT_KEYS
  ) {
    return {
      ...state,
      batchEventKeys: [],
      saturated: true,
    };
  }

  const observedEventKeys = newEventKeys.length
    ? new Set([...state.observedEventKeys, ...newEventKeys])
    : state.observedEventKeys;

  if (!state.baselined) {
    return {
      baselined: true,
      observedEventKeys,
      batchEventKeys: [],
      announcementRevision: state.announcementRevision,
      saturated: false,
    };
  }

  const batchEventKeys = state.batchEventKeys.filter(
    (eventKey) =>
      current.has(eventKey) && input.dispositionFor(eventKey) === undefined,
  );
  let admittedNewEvent = false;
  for (const eventKey of newEventKeys) {
    if (input.dispositionFor(eventKey) === undefined) {
      batchEventKeys.push(eventKey);
      admittedNewEvent = true;
    }
  }

  if (
    observedEventKeys === state.observedEventKeys &&
    batchEventKeys.length === state.batchEventKeys.length &&
    batchEventKeys.every(
      (eventKey, index) => eventKey === state.batchEventKeys[index],
    )
  ) {
    return state;
  }

  return {
    ...state,
    observedEventKeys,
    batchEventKeys,
    announcementRevision:
      state.announcementRevision + (admittedNewEvent ? 1 : 0),
  };
}

export function consumeAttentionTransitionCueBatch(
  state: AttentionTransitionCueState,
): AttentionTransitionCueState {
  return state.batchEventKeys.length ? { ...state, batchEventKeys: [] } : state;
}
