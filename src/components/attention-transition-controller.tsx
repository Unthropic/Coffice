"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import type {
  AttentionDisposition,
  AttentionItem,
} from "../lib/attention-inbox";
import { reportDesktopAlertFailure } from "../lib/desktop-alerts";
import type { VerificationTarget } from "../lib/coffice-workspace";
import {
  AttentionTransitionCue,
  type AttentionTransitionSourceState,
} from "./attention-transition-cue";
import { useAttentionTransitionCue } from "./use-attention-transition-cue";
import type { DesktopAlertSettingsController } from "./use-desktop-alert-settings";
import { useDesktopAlertDelivery } from "./use-desktop-alert-delivery";

function hasOpenModal(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector('[aria-modal="true"]') !== null
  );
}

function subscribeToOpenModals(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["aria-modal"],
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}

function useOpenModal(): boolean {
  return useSyncExternalStore(subscribeToOpenModals, hasOpenModal, () => false);
}

function isUsableVerificationTarget(
  itemProjectId: string,
  target: AttentionItem["verificationTarget"],
): target is VerificationTarget {
  const resultKind = target?.resultKey?.kind;
  return Boolean(
    target?.projectId === itemProjectId &&
    target.projectId.trim() &&
    target.objectiveId.trim() &&
    target.workItemId.trim() &&
    target.attemptId.trim() &&
    target.resultKey?.id.trim() &&
    (resultKind === "turn" ||
      resultKind === "operation" ||
      resultKind === "revision"),
  );
}

export interface AttentionTransitionControllerProps {
  admissionReady: boolean;
  items: readonly AttentionItem[];
  dispositionFor: (eventKey: string) => AttentionDisposition | undefined;
  sourceState: AttentionTransitionSourceState;
  desktopAlerts: DesktopAlertSettingsController;
  onMarkSeen: (eventKey: string) => Promise<boolean>;
  onOpenTask: (projectId: string, taskId: string) => void;
  onOpenStoredResult: (target: VerificationTarget) => void;
  onOpenProjectPlan?: (projectId: string) => void;
  onRequestFallbackFocus: () => void;
}

export function AttentionTransitionController({
  admissionReady,
  items,
  dispositionFor,
  sourceState,
  desktopAlerts,
  onMarkSeen,
  onOpenTask,
  onOpenStoredResult,
  onOpenProjectPlan,
  onRequestFallbackFocus,
}: AttentionTransitionControllerProps) {
  const cue = useAttentionTransitionCue({
    admissionReady,
    items,
    dispositionFor,
  });
  const { consumeBatch } = cue;
  const modalOpen = useOpenModal();

  useEffect(() => {
    if (!desktopAlerts.enabled || !cue.saturated) return;
    reportDesktopAlertFailure(
      "Desktop alerts are paused because this open Coffice page reached its duplicate-prevention safety limit.",
    );
  }, [cue.saturated, desktopAlerts.enabled]);

  const latestRouteRef = useRef({
    items,
    dispositionFor,
    sourceState,
    onMarkSeen,
    onOpenTask,
    onOpenStoredResult,
    onOpenProjectPlan,
  });
  useLayoutEffect(() => {
    latestRouteRef.current = {
      items,
      dispositionFor,
      sourceState,
      onMarkSeen,
      onOpenTask,
      onOpenStoredResult,
      onOpenProjectPlan,
    };
  }, [
    dispositionFor,
    items,
    onMarkSeen,
    onOpenStoredResult,
    onOpenProjectPlan,
    onOpenTask,
    sourceState,
  ]);

  const routeExactItem = useCallback((eventKey: string) => {
    const latest = latestRouteRef.current;
    if (
      hasOpenModal() ||
      (latest.sourceState !== "fresh" && latest.sourceState !== "refreshing")
    ) {
      return;
    }
    const current = latest.items.find(
      (item) =>
        item.eventKey === eventKey &&
        latest.dispositionFor(eventKey) === undefined,
    );
    if (!current) return;

    const attemptSeenReceipt = () => {
      try {
        void latest.onMarkSeen(eventKey).catch(() => undefined);
      } catch {
        // Routing is still useful when a synchronous persistence adapter fails.
      }
    };
    if (current.verificationTarget !== undefined) {
      if (
        isUsableVerificationTarget(
          current.projectId,
          current.verificationTarget,
        )
      ) {
        attemptSeenReceipt();
        latest.onOpenStoredResult(current.verificationTarget);
      }
      return;
    }
    if (current.planProjectId) {
      attemptSeenReceipt();
      latest.onOpenProjectPlan?.(current.planProjectId);
      return;
    }
    if (!current.projectId.trim() || !current.openTaskId?.trim()) return;
    attemptSeenReceipt();
    latest.onOpenTask(current.projectId, current.openTaskId);
  }, []);

  const handleOpen = useCallback(
    (eventKey: string) => {
      consumeBatch();
      routeExactItem(eventKey);
    },
    [consumeBatch, routeExactItem],
  );

  useDesktopAlertDelivery({
    active: desktopAlerts.status === "on" && desktopAlerts.enabled,
    coordinationAvailable: desktopAlerts.coordinationAvailable,
    admissionReady,
    trackerReady: cue.baselined && !cue.saturated,
    items,
    dispositionFor,
    batch: cue.batch,
    announcementRevision: cue.announcementRevision,
    sourceState,
    onOpen: routeExactItem,
  });

  return (
    <AttentionTransitionCue
      item={cue.item}
      moreCount={cue.moreCount}
      announcementRevision={cue.announcementRevision}
      sourceState={sourceState}
      modalOpen={modalOpen}
      onOpen={handleOpen}
      onClose={consumeBatch}
      onRequestFallbackFocus={onRequestFallbackFocus}
    />
  );
}
