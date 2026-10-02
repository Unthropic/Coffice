"use client";

import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  consumeAttentionTransitionCueBatch,
  createInitialAttentionTransitionCueState,
  reconcileAttentionTransitionCueState,
  type AttentionTransitionCueInput,
  type AttentionTransitionCueState,
} from "../lib/attention-transition-cue";
import type {
  AttentionDisposition,
  AttentionItem,
} from "../lib/attention-inbox";

export interface AttentionTransitionCueController {
  item: AttentionItem | null;
  batch: readonly AttentionItem[];
  moreCount: number;
  announcementRevision: number;
  baselined: boolean;
  saturated: boolean;
  consumeBatch: () => void;
}

type AttentionTransitionCueAction =
  | { type: "reconcile"; input: AttentionTransitionCueInput }
  | { type: "consume" };

function transitionCueReducer(
  state: AttentionTransitionCueState,
  action: AttentionTransitionCueAction,
): AttentionTransitionCueState {
  return action.type === "reconcile"
    ? reconcileAttentionTransitionCueState(state, action.input)
    : consumeAttentionTransitionCueBatch(state);
}

export function useAttentionTransitionCue({
  admissionReady,
  items,
  dispositionFor,
}: {
  admissionReady: boolean;
  items: readonly AttentionItem[];
  dispositionFor: (eventKey: string) => AttentionDisposition | undefined;
}): AttentionTransitionCueController {
  const [state, dispatch] = useReducer(
    transitionCueReducer,
    undefined,
    createInitialAttentionTransitionCueState,
  );

  useEffect(() => {
    dispatch({
      type: "reconcile",
      input: {
        admissionReady,
        items,
        dispositionFor,
      },
    });
  }, [admissionReady, dispositionFor, items]);

  const liveBatch = useMemo(() => {
    const current = new Map<string, AttentionItem>();
    for (const item of items) {
      if (!current.has(item.eventKey)) current.set(item.eventKey, item);
    }
    return state.batchEventKeys.flatMap((eventKey) => {
      const item = current.get(eventKey);
      return item && dispositionFor(eventKey) === undefined ? [item] : [];
    });
  }, [dispositionFor, items, state.batchEventKeys]);

  const consumeBatch = useCallback(() => {
    dispatch({ type: "consume" });
  }, []);

  return {
    item: liveBatch[0] ?? null,
    batch: liveBatch,
    moreCount: Math.max(0, liveBatch.length - 1),
    announcementRevision: state.announcementRevision,
    baselined: state.baselined,
    saturated: state.saturated,
    consumeBatch,
  };
}
