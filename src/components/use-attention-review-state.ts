"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  ATTENTION_REVIEW_LEGACY_STORAGE_KEY,
  ATTENTION_REVIEW_STORAGE_KEY,
  clearAttentionEvent,
  createInitialAttentionReviewState,
  isAttentionItemBaselined,
  parseAttentionReviewState,
  pruneAttentionReviewState,
  repairInvalidAttentionBaseline,
  resolvedPlanLinkEventKeys,
  restoreAttentionEvent,
  selectAttentionItems,
  serializeAttentionReviewState,
  setAttentionDisposition,
  snoozeAttentionEvent,
  type AttentionDisposition,
  type AttentionItem,
  type AttentionProject,
  type AttentionReviewState,
} from "../lib/attention-inbox";

export interface AttentionReviewController {
  ready: boolean;
  persistent: boolean;
  initializedAt: string | null;
  items: readonly AttentionItem[];
  dispositionFor: (eventKey: string) => AttentionDisposition | undefined;
  snoozedUntilFor: (eventKey: string) => string | undefined;
  isBaselined: (item: AttentionItem) => boolean;
  markSeen: (eventKey: string) => Promise<boolean>;
  markReviewed: (eventKey: string) => Promise<boolean>;
  dismiss: (eventKey: string) => void;
  snooze: (eventKey: string, durationMs: number) => void;
  restore: (eventKey: string) => void;
}

export interface DurableAttentionReviewPersistence {
  state: AttentionReviewState | null;
  ready: boolean;
  persistent: boolean;
  updateEvent: (
    eventKey: string,
    disposition: AttentionDisposition | null,
    snoozedUntil: string | null,
  ) => Promise<{ ok: boolean }>;
}

const REVIEW_STATE_CHANGED_EVENT = "coffice:attention-review-state-changed";
const EMPTY_RESOLVED_COMPLETION_EVENT_KEYS: ReadonlySet<string> = new Set();
let cachedStorageValue: string | null | undefined;
let cachedLegacyStorageValue: string | null | undefined;
let cachedStorageState: AttentionReviewState | null = null;
let memoryFallback: AttentionReviewState | null = null;
let storageAccessible = true;
let storageRewriteNeeded = false;

function readStoredStateSnapshot(): AttentionReviewState | null {
  if (memoryFallback) return memoryFallback;
  let raw: string | null;
  let legacyRaw: string | null;
  try {
    raw = window.localStorage.getItem(ATTENTION_REVIEW_STORAGE_KEY);
    legacyRaw = window.localStorage.getItem(
      ATTENTION_REVIEW_LEGACY_STORAGE_KEY,
    );
  } catch {
    storageAccessible = false;
    return memoryFallback;
  }
  if (raw === cachedStorageValue && legacyRaw === cachedLegacyStorageValue) {
    return cachedStorageState;
  }
  cachedStorageValue = raw;
  cachedLegacyStorageValue = legacyRaw;
  const currentState = parseAttentionReviewState(raw);
  const legacyState = currentState
    ? null
    : parseAttentionReviewState(legacyRaw);
  cachedStorageState = currentState ?? legacyState;
  storageRewriteNeeded = Boolean(
    cachedStorageState &&
    (legacyState || raw !== serializeAttentionReviewState(cachedStorageState)),
  );
  storageAccessible = true;
  return cachedStorageState;
}

function writeStoredState(state: AttentionReviewState): boolean {
  const serialized = serializeAttentionReviewState(state);
  const boundedState = parseAttentionReviewState(serialized);
  if (!boundedState) return false;
  try {
    window.localStorage.setItem(ATTENTION_REVIEW_STORAGE_KEY, serialized);
    memoryFallback = null;
    storageAccessible = true;
    storageRewriteNeeded = false;
    try {
      window.localStorage.removeItem(ATTENTION_REVIEW_LEGACY_STORAGE_KEY);
    } catch {
      // The current state is safely stored under the v2 key. A stale legacy
      // copy is harmless and can be cleaned up by a later successful write.
    }
    cachedStorageValue = serialized;
    cachedLegacyStorageValue = null;
    cachedStorageState = boundedState;
  } catch {
    // Never fall back to the older raw value after an action appeared to work.
    // Keep the bounded update in memory until a later local write succeeds.
    memoryFallback = boundedState;
    storageAccessible = false;
    window.dispatchEvent(new Event(REVIEW_STATE_CHANGED_EVENT));
    return false;
  }
  window.dispatchEvent(new Event(REVIEW_STATE_CHANGED_EVENT));
  return true;
}

function subscribeToStoredState(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== ATTENTION_REVIEW_STORAGE_KEY &&
      event.key !== ATTENTION_REVIEW_LEGACY_STORAGE_KEY
    ) {
      return;
    }
    // An external tab must not overwrite an update that this tab could not
    // persist. Keep the in-memory state authoritative until a local retry.
    if (!memoryFallback) storageAccessible = true;
    cachedStorageValue = undefined;
    cachedLegacyStorageValue = undefined;
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(REVIEW_STATE_CHANGED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(REVIEW_STATE_CHANGED_EVENT, onStoreChange);
  };
}

export function useAttentionReviewState(
  projects: readonly AttentionProject[],
  referenceTime: number,
  canInitialize: boolean,
  initialBaselineTime = referenceTime,
  durable?: DurableAttentionReviewPersistence,
  resolvedCompletionEventKeys: ReadonlySet<string> = EMPTY_RESOLVED_COMPLETION_EVENT_KEYS,
): AttentionReviewController {
  const storedState = useSyncExternalStore(
    subscribeToStoredState,
    readStoredStateSnapshot,
    () => null,
  );
  const [optimisticDurableState, setOptimisticDurableState] =
    useState<AttentionReviewState | null>(null);
  const pendingDurableStateRef = useRef<AttentionReviewState | null>(null);
  const durableWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const planLinkResetRequestsRef = useRef(
    new Map<string, AttentionReviewState>(),
  );
  const durableState = optimisticDurableState ?? durable?.state ?? null;
  const sourceState = durable ? durableState : storedState;
  const state = useMemo(() => {
    const observationTime = new Date(initialBaselineTime).toISOString();
    const current =
      sourceState ??
      (canInitialize
        ? createInitialAttentionReviewState(observationTime)
        : null);
    const repaired = current
      ? repairInvalidAttentionBaseline(current, observationTime)
      : null;
    return repaired && canInitialize
      ? pruneAttentionReviewState(repaired, projects)
      : repaired;
  }, [canInitialize, initialBaselineTime, projects, sourceState]);

  useEffect(() => {
    if (durable) return;
    if (
      state &&
      canInitialize &&
      (!storedState || state !== storedState || storageRewriteNeeded)
    ) {
      writeStoredState(state);
    }
  }, [canInitialize, durable, state, storedState]);

  useEffect(() => {
    if (!durable || pendingDurableStateRef.current) return;
    setOptimisticDurableState(null);
  }, [durable, durable?.state]);

  const persistDurably = useCallback(
    (eventKey: string, next: AttentionReviewState): Promise<boolean> => {
      if (!durable) return Promise.resolve(false);
      pendingDurableStateRef.current = next;
      setOptimisticDurableState(next);
      const resultPromise = durableWriteQueueRef.current.then(async () => {
        let saved = false;
        try {
          const result = await durable.updateEvent(
            eventKey,
            next.dispositions[eventKey] ?? null,
            next.snoozedUntil[eventKey] ?? null,
          );
          saved = result.ok;
        } catch {
          saved = false;
        }
        if (pendingDurableStateRef.current === next) {
          pendingDurableStateRef.current = null;
          setOptimisticDurableState(null);
        }
        return saved;
      });
      durableWriteQueueRef.current = resultPromise.then(() => undefined);
      return resultPromise;
    },
    [durable],
  );

  const update = useCallback(
    (
      eventKey: string,
      transform: (current: AttentionReviewState) => AttentionReviewState,
    ): Promise<boolean> => {
      const current = durable
        ? (pendingDurableStateRef.current ?? durable.state ?? state)
        : (readStoredStateSnapshot() ?? state);
      if (!current) return Promise.resolve(false);
      const next = transform(current);
      if (next === current) return Promise.resolve(true);
      if (durable) return persistDurably(eventKey, next);
      return Promise.resolve(writeStoredState(next));
    },
    [durable, persistDurably, state],
  );

  const markSeen = useCallback(
    (eventKey: string) => {
      const now = new Date().toISOString();
      return update(eventKey, (current) => {
        const snoozedUntil = current.snoozedUntil[eventKey];
        const activelySnoozed =
          snoozedUntil !== undefined &&
          Number.isFinite(Date.parse(snoozedUntil)) &&
          Date.parse(snoozedUntil) > Date.parse(now);
        if (
          current.dispositions[eventKey]?.kind === "needs_review" &&
          !activelySnoozed
        ) {
          return current;
        }
        return setAttentionDisposition(current, eventKey, "needs_review", now);
      });
    },
    [update],
  );

  useEffect(() => {
    if (
      !durable ||
      !durable.ready ||
      !durable.persistent ||
      !canInitialize ||
      !state
    ) {
      return;
    }
    const resolvedKeys = new Set(resolvedPlanLinkEventKeys(state, projects));
    for (const eventKey of planLinkResetRequestsRef.current.keys()) {
      if (!resolvedKeys.has(eventKey)) {
        planLinkResetRequestsRef.current.delete(eventKey);
      }
    }
    for (const eventKey of resolvedKeys) {
      if (planLinkResetRequestsRef.current.get(eventKey) === durable.state) {
        continue;
      }
      if (!durable.state) continue;
      planLinkResetRequestsRef.current.set(eventKey, durable.state);
      update(eventKey, (current) => clearAttentionEvent(current, eventKey));
    }
  }, [canInitialize, durable, projects, state, update]);

  const markReviewed = useCallback(
    (eventKey: string) =>
      update(eventKey, (current) =>
        setAttentionDisposition(
          current,
          eventKey,
          "reviewed",
          new Date().toISOString(),
        ),
      ),
    [update],
  );

  const dismiss = useCallback(
    (eventKey: string) => {
      update(eventKey, (current) =>
        setAttentionDisposition(
          current,
          eventKey,
          "dismissed",
          new Date().toISOString(),
        ),
      );
    },
    [update],
  );

  const snooze = useCallback(
    (eventKey: string, durationMs: number) => {
      const now = new Date();
      const until = new Date(
        now.getTime() + Math.max(0, durationMs),
      ).toISOString();
      update(eventKey, (current) =>
        snoozeAttentionEvent(current, eventKey, until, now.toISOString()),
      );
    },
    [update],
  );

  const restore = useCallback(
    (eventKey: string) => {
      update(eventKey, (current) =>
        restoreAttentionEvent(current, eventKey, new Date().toISOString()),
      );
    },
    [update],
  );

  const items = useMemo(
    () =>
      state
        ? selectAttentionItems(
            projects,
            state,
            referenceTime,
            resolvedCompletionEventKeys,
          )
        : [],
    [projects, referenceTime, resolvedCompletionEventKeys, state],
  );

  const dispositionFor = useCallback(
    (eventKey: string) => state?.dispositions[eventKey],
    [state],
  );
  const snoozedUntilFor = useCallback(
    (eventKey: string) => state?.snoozedUntil[eventKey],
    [state],
  );
  const isBaselined = useCallback(
    (item: AttentionItem) =>
      state ? isAttentionItemBaselined(item, state) : false,
    [state],
  );

  return {
    ready: durable ? durable.ready && state !== null : state !== null,
    persistent: durable
      ? durable.persistent
      : storageAccessible && memoryFallback === null,
    initializedAt: state?.initializedAt ?? null,
    items,
    dispositionFor,
    snoozedUntilFor,
    isBaselined,
    markSeen,
    markReviewed,
    dismiss,
    snooze,
    restore,
  };
}
