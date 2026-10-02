"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import type {
  AttentionDisposition,
  AttentionItem,
} from "../lib/attention-inbox";
import {
  DESKTOP_ALERT_NOTIFICATION_TAG,
  claimDesktopAlertEventKeys,
  digestDesktopAlertEventKey,
  holdDesktopAlertForegroundLock,
  refreshDesktopAlertState,
  reportDesktopAlertFailure,
  withDesktopAlertDeliveryOpportunity,
  withDesktopAlertMutePartition,
} from "../lib/desktop-alerts";
import type { AttentionTransitionSourceState } from "./attention-transition-cue";

const SINGULAR_BODY = "A new action is ready. Open Coffice to review it.";
const PLURAL_BODY = "New actions are ready. Open Coffice to review them.";

interface DesktopAlertDeliveryInput {
  active: boolean;
  coordinationAvailable: boolean;
  admissionReady: boolean;
  trackerReady: boolean;
  items: readonly AttentionItem[];
  dispositionFor: (eventKey: string) => AttentionDisposition | undefined;
  batch: readonly AttentionItem[];
  announcementRevision: number;
  sourceState: AttentionTransitionSourceState;
  onOpen: (eventKey: string) => void;
}

interface LatestDesktopAlertInput {
  active: boolean;
  items: readonly AttentionItem[];
  dispositionFor: (eventKey: string) => AttentionDisposition | undefined;
  sourceState: AttentionTransitionSourceState;
  onOpen: (eventKey: string) => void;
}

function isCurrentPageForeground(): boolean {
  return (
    document.visibilityState === "visible" ||
    (typeof document.hasFocus === "function" && document.hasFocus())
  );
}

function closeNotification(notification: Notification | null): void {
  if (!notification) return;
  try {
    notification.close();
  } catch {
    // Browser-owned presentation failures must not affect Attention.
  }
}

function uniqueEventKeys(items: readonly AttentionItem[]): string[] {
  return [...new Set(items.map((item) => item.eventKey))];
}

function uniqueItems(items: readonly AttentionItem[]): AttentionItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.eventKey)) return false;
    seen.add(item.eventKey);
    return true;
  });
}

/**
 * Presents the already-admitted canonical transition batch on the optional
 * desktop channel. It does not create another Attention admission model.
 */
export function useDesktopAlertDelivery({
  active,
  coordinationAvailable,
  admissionReady,
  trackerReady,
  items,
  dispositionFor,
  batch,
  announcementRevision,
  sourceState,
  onOpen,
}: DesktopAlertDeliveryInput): void {
  const latestRef = useRef<LatestDesktopAlertInput>({
    active,
    items,
    dispositionFor,
    sourceState,
    onOpen,
  });
  const mountedRef = useRef(false);
  const activationStartedRef = useRef(false);
  const baselineReadyRef = useRef(false);
  const activationGenerationRef = useRef(0);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const handledInThisPageRef = useRef(new Set<string>());
  const lastNotificationRef = useRef<Notification | null>(null);

  useLayoutEffect(() => {
    latestRef.current = {
      active,
      items,
      dispositionFor,
      sourceState,
      onOpen,
    };
  }, [active, dispositionFor, items, onOpen, sourceState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      latestRef.current = { ...latestRef.current, active: false };
      closeNotification(lastNotificationRef.current);
      lastNotificationRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (active) return;
    activationGenerationRef.current += 1;
    activationStartedRef.current = false;
    baselineReadyRef.current = false;
    operationQueueRef.current = Promise.resolve();
    handledInThisPageRef.current.clear();
    closeNotification(lastNotificationRef.current);
    lastNotificationRef.current = null;
  }, [active]);

  useEffect(() => {
    if (!coordinationAvailable) return;

    let foregroundController: AbortController | null = null;
    const synchronizeForegroundLock = () => {
      foregroundController?.abort();
      foregroundController = null;
      if (document.visibilityState !== "visible") return;
      foregroundController = new AbortController();
      void holdDesktopAlertForegroundLock(foregroundController.signal).catch(
        () => undefined,
      );
    };

    synchronizeForegroundLock();
    document.addEventListener("visibilitychange", synchronizeForegroundLock);
    return () => {
      document.removeEventListener(
        "visibilitychange",
        synchronizeForegroundLock,
      );
      foregroundController?.abort();
    };
  }, [coordinationAvailable]);

  useEffect(() => {
    if (
      !active ||
      !coordinationAvailable ||
      !admissionReady ||
      !trackerReady ||
      sourceState !== "fresh"
    ) {
      return;
    }

    if (!activationStartedRef.current) {
      activationStartedRef.current = true;
      baselineReadyRef.current = false;
      const generation = activationGenerationRef.current + 1;
      activationGenerationRef.current = generation;
      const baselineEventKeys = uniqueEventKeys(items);
      operationQueueRef.current = Promise.resolve()
        .then(async () => {
          const claim = baselineEventKeys.length
            ? await claimDesktopAlertEventKeys(baselineEventKeys, "baseline")
            : ({ kind: "duplicate", claimedCount: 0 } as const);
          if (
            !mountedRef.current ||
            generation !== activationGenerationRef.current ||
            !latestRef.current.active
          ) {
            return;
          }
          if (claim.kind === "claimed" || claim.kind === "duplicate") {
            for (const eventKey of baselineEventKeys) {
              handledInThisPageRef.current.add(eventKey);
            }
            baselineReadyRef.current = true;
          }
        })
        .catch(() => undefined);
      return;
    }

    const capturedBatch = uniqueItems(batch);
    const capturedBatchEventKeys = capturedBatch.map((item) => item.eventKey);
    const generation = activationGenerationRef.current;
    operationQueueRef.current = operationQueueRef.current
      .then(async () => {
        const isCurrentActivation = () =>
          mountedRef.current &&
          generation === activationGenerationRef.current &&
          latestRef.current.active;
        if (!baselineReadyRef.current || !isCurrentActivation()) {
          return;
        }
        const eventKeys = capturedBatchEventKeys.filter(
          (eventKey) => !handledInThisPageRef.current.has(eventKey),
        );
        if (eventKeys.length === 0) return;
        for (const eventKey of eventKeys) {
          handledInThisPageRef.current.add(eventKey);
        }

        if (isCurrentPageForeground()) {
          if (!isCurrentActivation()) return;
          await claimDesktopAlertEventKeys(eventKeys, "foreground");
          return;
        }

        const eventKeySet = new Set(eventKeys);
        const eligibleBatch = capturedBatch.filter((item) =>
          eventKeySet.has(item.eventKey),
        );
        await withDesktopAlertMutePartition(
          eligibleBatch,
          (item) => item.projectId,
          async ({ muted, unmuted }) => {
            const mutedEventKeys = muted.map((item) => item.eventKey);
            if (mutedEventKeys.length) {
              const mutedClaim = await claimDesktopAlertEventKeys(
                mutedEventKeys,
                "muted",
              );
              if (
                mutedClaim.kind !== "claimed" &&
                mutedClaim.kind !== "duplicate"
              ) {
                return;
              }
            }
            const deliveryEventKeys = unmuted.map((item) => item.eventKey);
            if (!deliveryEventKeys.length) return;

            await withDesktopAlertDeliveryOpportunity(
              async () => {
                if (!isCurrentActivation()) return () => undefined;
                if (isCurrentPageForeground()) {
                  if (!isCurrentActivation()) return () => undefined;
                  await claimDesktopAlertEventKeys(
                    deliveryEventKeys,
                    "foreground",
                  );
                  return () => undefined;
                }
                const digestEntries = await Promise.all(
                  deliveryEventKeys.map(async (eventKey) => ({
                    eventKey,
                    digest: await digestDesktopAlertEventKey(eventKey),
                  })),
                );
                if (digestEntries.some(({ digest }) => digest === undefined)) {
                  return () => undefined;
                }
                if (!isCurrentActivation()) return () => undefined;
                // Visibility can change while WebCrypto is hashing. Suppress and
                // permanently claim this exact batch before any delivery claim.
                if (isCurrentPageForeground()) {
                  if (!isCurrentActivation()) return () => undefined;
                  await claimDesktopAlertEventKeys(
                    deliveryEventKeys,
                    "foreground",
                  );
                  return () => undefined;
                }

                if (!isCurrentActivation()) return () => undefined;
                const claim = await claimDesktopAlertEventKeys(
                  deliveryEventKeys,
                  "delivered",
                );
                if (!isCurrentActivation()) return () => undefined;
                if (claim.kind !== "claimed" || !claim.primaryDigest) {
                  return () => undefined;
                }
                const primary = digestEntries.find(
                  ({ digest }) => digest === claim.primaryDigest,
                );
                const primaryItem = unmuted.find(
                  (item) => item.eventKey === primary?.eventKey,
                );
                if (!primary || !primaryItem) {
                  reportDesktopAlertFailure(
                    "Desktop alerts are paused because an exact delivery identity could not be recovered.",
                  );
                  return () => undefined;
                }

                const latest = latestRef.current;
                const current = latest.items.find(
                  (item) =>
                    item.eventKey === primary.eventKey &&
                    item.projectId === primaryItem.projectId &&
                    latest.dispositionFor(primary.eventKey) === undefined,
                );
                if (
                  !isCurrentActivation() ||
                  !current ||
                  (latest.sourceState !== "fresh" &&
                    latest.sourceState !== "refreshing")
                ) {
                  return () => undefined;
                }

                // The returned function is intentionally synchronous. Core invokes
                // it only while holding the final exclusive foreground probe.
                return () => {
                  const commitInput = latestRef.current;
                  const commitCurrent = commitInput.items.find(
                    (item) =>
                      item.eventKey === primary.eventKey &&
                      item.projectId === primaryItem.projectId &&
                      commitInput.dispositionFor(primary.eventKey) ===
                        undefined,
                  );
                  if (
                    isCurrentPageForeground() ||
                    !isCurrentActivation() ||
                    !commitCurrent ||
                    (commitInput.sourceState !== "fresh" &&
                      commitInput.sourceState !== "refreshing")
                  ) {
                    return;
                  }
                  if (
                    typeof Notification === "undefined" ||
                    Notification.permission !== "granted"
                  ) {
                    refreshDesktopAlertState();
                    return;
                  }

                  closeNotification(lastNotificationRef.current);
                  lastNotificationRef.current = null;

                  let notification: Notification;
                  try {
                    notification = new Notification("Coffice", {
                      body:
                        claim.claimedCount === 1 ? SINGULAR_BODY : PLURAL_BODY,
                      tag: DESKTOP_ALERT_NOTIFICATION_TAG,
                      silent: true,
                    });
                  } catch {
                    reportDesktopAlertFailure(
                      "Desktop alerts are paused because this browser could not display the alert.",
                    );
                    return;
                  }
                  lastNotificationRef.current = notification;
                  notification.onerror = () => {
                    reportDesktopAlertFailure(
                      "Desktop alerts are paused because this browser could not display the alert.",
                    );
                  };
                  notification.onclose = () => {
                    if (lastNotificationRef.current === notification) {
                      lastNotificationRef.current = null;
                    }
                  };
                  notification.onclick = () => {
                    closeNotification(notification);
                    try {
                      window.focus();
                    } catch {
                      // Focus is best-effort; current-target validation still applies.
                    }
                    const clickInput = latestRef.current;
                    if (isCurrentActivation()) {
                      clickInput.onOpen(primary.eventKey);
                    }
                  };
                };
              },
              async () => {
                if (!isCurrentActivation()) return;
                await claimDesktopAlertEventKeys(
                  deliveryEventKeys,
                  "foreground",
                );
              },
            );
          },
        );
        // Hidden pages queue in core, then the digest ledger decides whether
        // this exact batch is new or a duplicate. Coordination failures pause
        // delivery through the shared settings state.
      })
      .catch(() => undefined);
  }, [
    active,
    admissionReady,
    announcementRevision,
    batch,
    coordinationAvailable,
    items,
    sourceState,
    trackerReady,
  ]);
}
