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
  DESKTOP_ALERT_CHANGED_EVENT,
  DESKTOP_ALERT_LEDGER_STORAGE_KEY,
  DESKTOP_ALERT_PREFERENCE_STORAGE_KEY,
  DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
  MAX_DESKTOP_ALERT_HANDLED_DIGESTS,
  clearDesktopAlertRuntimePause,
  desktopAlertCoordinationSupported,
  desktopAlertNotificationSupported,
  getDesktopAlertRuntimePause,
  initializeDesktopAlertLedger,
  readDesktopAlertProjectMutes,
  readDesktopAlertStoredState,
  writeDesktopAlertPreference,
  writeDesktopAlertProjectMuted,
  resetDesktopAlertProjectMutes,
  type DesktopAlertStatus,
} from "../lib/desktop-alerts";

export interface DesktopAlertSettingsController {
  status: DesktopAlertStatus;
  busy: boolean;
  message: string | null;
  enabled: boolean;
  optedIn: boolean;
  coordinationAvailable: boolean;
  projectMutedById: ReadonlyMap<string, boolean>;
  projectMuteBusyId: string | null;
  projectMuteMessage: string | null;
  projectMuteResetBusy: boolean;
  projectMuteResetAvailable: boolean;
  projectMuteManageable: boolean;
  enable: () => Promise<void>;
  disable: () => void;
  setProjectMuted: (projectId: string, muted: boolean) => Promise<boolean>;
  resetProjectMutes: () => Promise<boolean>;
}

interface ResolvedProjectMutes {
  key: string;
  values: ReadonlyMap<string, boolean>;
}

function projectMutesKey(): string {
  const stored = readDesktopAlertStoredState();
  return stored.projectMutes
    ? stored.projectMutes.mutedProjectDigests.join(":")
    : "invalid";
}

interface DesktopAlertSettingsSnapshot {
  status: DesktopAlertStatus;
  busy: boolean;
  message: string | null;
  enabled: boolean;
  coordinationAvailable: boolean;
  optedIn: boolean;
  projectMutesKey: string;
  projectMuteStorageAccessible: boolean;
}

const SERVER_SNAPSHOT: DesktopAlertSettingsSnapshot = {
  status: "off",
  busy: false,
  message: null,
  enabled: false,
  coordinationAvailable: false,
  optedIn: false,
  projectMutesKey: "",
  projectMuteStorageAccessible: false,
};

function sameSnapshot(
  left: DesktopAlertSettingsSnapshot,
  right: DesktopAlertSettingsSnapshot,
): boolean {
  return (
    left.status === right.status &&
    left.busy === right.busy &&
    left.message === right.message &&
    left.enabled === right.enabled &&
    left.coordinationAvailable === right.coordinationAvailable &&
    left.optedIn === right.optedIn &&
    left.projectMutesKey === right.projectMutesKey &&
    left.projectMuteStorageAccessible === right.projectMuteStorageAccessible
  );
}

let permissionBusy = false;
let transientMessage: string | null = null;
let cachedSnapshotKey = "";
let cachedSnapshot = SERVER_SNAPSHOT;

function dispatchSettingsChanged(): void {
  cachedSnapshotKey = "";
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DESKTOP_ALERT_CHANGED_EVENT));
  }
}

function currentPermission(): NotificationPermission | "unavailable" {
  if (!desktopAlertNotificationSupported()) return "unavailable";
  try {
    return Notification.permission;
  } catch {
    return "unavailable";
  }
}

function getSnapshot(): DesktopAlertSettingsSnapshot {
  const notificationSupported = desktopAlertNotificationSupported();
  const coordinationSupported = desktopAlertCoordinationSupported();
  const stored = readDesktopAlertStoredState();
  const permission = currentPermission();
  const runtimePause = getDesktopAlertRuntimePause();
  const preferenceValid = Boolean(
    stored.storageAccessible && stored.preference,
  );
  const ledgerValid = Boolean(
    stored.ledger ||
    (!stored.ledgerPresent && stored.preference?.enabled === false),
  );
  const storageValid = preferenceValid && ledgerValid;
  const projectMutesValid = Boolean(stored.projectMutes);
  const saturated = Boolean(
    stored.ledger &&
    (stored.ledger.saturated ||
      stored.ledger.handledEventDigests.length >=
        MAX_DESKTOP_ALERT_HANDLED_DIGESTS),
  );
  const preferenceEnabled = stored.preference?.enabled ?? false;
  const coordinationAvailable = Boolean(coordinationSupported);

  let status: DesktopAlertStatus;
  let message: string | null = null;
  if (
    !notificationSupported ||
    !coordinationSupported ||
    permission === "unavailable"
  ) {
    status = "unavailable";
  } else if (!preferenceValid) {
    status = "paused";
    message ??=
      "Desktop alerts are paused because browser-local delivery state is unreadable.";
  } else if (!preferenceEnabled) {
    // A valid, explicit opt-out is authoritative even when an old ledger is
    // saturated or a previous delivery attempt paused this browser session.
    status = "off";
    message = transientMessage;
  } else if (!storageValid || !projectMutesValid) {
    status = "paused";
    message ??=
      "Desktop alerts are paused because browser-local delivery state is unreadable.";
  } else if (saturated) {
    status = "paused";
    message ??=
      "Desktop alerts are paused because their private delivery history reached its safety limit.";
  } else if (runtimePause) {
    status = "paused";
    message ??= runtimePause;
  } else if (permission === "denied") {
    status = "blocked";
  } else if (permission === "granted") {
    status = "on";
  } else {
    status = "off";
    message ??=
      "Browser notification permission needs to be enabled again before desktop alerts can resume.";
  }

  const enabled =
    preferenceEnabled && (permission === "granted" || permission === "denied");
  const key = JSON.stringify({
    status,
    busy: permissionBusy,
    message,
    enabled,
    coordinationAvailable,
    optedIn: preferenceEnabled,
    projectMutesKey: stored.projectMutes
      ? stored.projectMutes.mutedProjectDigests.join(":")
      : "invalid",
    projectMuteStorageAccessible: stored.storageAccessible,
    permission,
    preferenceEnabled,
    ledgerSize: stored.ledger?.handledEventDigests.length ?? -1,
  });
  if (key === cachedSnapshotKey) return cachedSnapshot;
  cachedSnapshotKey = key;
  cachedSnapshot = {
    status,
    busy: permissionBusy,
    message,
    enabled,
    coordinationAvailable,
    optedIn: preferenceEnabled,
    projectMutesKey: stored.projectMutes
      ? stored.projectMutes.mutedProjectDigests.join(":")
      : "invalid",
    projectMuteStorageAccessible: stored.storageAccessible,
  };
  return cachedSnapshot;
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== null &&
      event.key !== DESKTOP_ALERT_PREFERENCE_STORAGE_KEY &&
      event.key !== DESKTOP_ALERT_LEDGER_STORAGE_KEY &&
      event.key !== DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY
    ) {
      return;
    }
    transientMessage = null;
    cachedSnapshotKey = "";
    onChange();
  };
  const handleChanged = () => {
    cachedSnapshotKey = "";
    onChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(DESKTOP_ALERT_CHANGED_EVENT, handleChanged);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(DESKTOP_ALERT_CHANGED_EVENT, handleChanged);
  };
}

export function useDesktopAlertSettings(
  projectIds: readonly string[] = [],
): DesktopAlertSettingsController {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => SERVER_SNAPSHOT,
  );
  const projectIdsKey = JSON.stringify([
    ...new Set(projectIds.filter((projectId) => projectId.trim())),
  ]);
  const stableProjectIds = useMemo(
    () => JSON.parse(projectIdsKey) as string[],
    [projectIdsKey],
  );
  const [resolvedProjectMutes, setResolvedProjectMutes] =
    useState<ResolvedProjectMutes>(() => ({ key: "", values: new Map() }));
  const [projectMuteBusyId, setProjectMuteBusyId] = useState<string | null>(
    null,
  );
  const [projectMuteMessage, setProjectMuteMessage] = useState<string | null>(
    null,
  );
  const [projectMuteResetBusy, setProjectMuteResetBusy] = useState(false);
  const projectMuteOperationRef = useRef(false);
  const projectMuteResetAvailable =
    snapshot.projectMutesKey === "invalid" ||
    (snapshot.projectMutesKey !== "" && snapshot.projectMutesKey.length > 0);
  const projectMuteManageable =
    snapshot.coordinationAvailable && snapshot.projectMuteStorageAccessible;
  const projectMutedById =
    resolvedProjectMutes.key === snapshot.projectMutesKey
      ? resolvedProjectMutes.values
      : new Map<string, boolean>();

  useEffect(() => {
    let cancelled = false;
    const resolutionKey = snapshot.projectMutesKey;
    void readDesktopAlertProjectMutes(stableProjectIds).then((next) => {
      if (cancelled) return;
      if (next) {
        setResolvedProjectMutes({ key: resolutionKey, values: next });
        setProjectMuteMessage(null);
      } else {
        setResolvedProjectMutes({ key: resolutionKey, values: new Map() });
        setProjectMuteMessage(
          "Project mute settings are unavailable. Reset them before relying on project-specific desktop delivery.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [stableProjectIds, snapshot.projectMutesKey]);

  useEffect(() => {
    let permission = currentPermission();
    let snapshot = getSnapshot();
    const refreshPermission = () => {
      const nextPermission = currentPermission();
      if (nextPermission !== permission) transientMessage = null;
      const nextSnapshot = getSnapshot();
      if (
        nextPermission === permission &&
        sameSnapshot(nextSnapshot, snapshot)
      ) {
        return;
      }
      permission = nextPermission;
      snapshot = nextSnapshot;
      dispatchSettingsChanged();
    };
    window.addEventListener("focus", refreshPermission);
    document.addEventListener("visibilitychange", refreshPermission);
    return () => {
      window.removeEventListener("focus", refreshPermission);
      document.removeEventListener("visibilitychange", refreshPermission);
    };
  }, []);

  const enable = useCallback(async () => {
    if (
      permissionBusy ||
      !desktopAlertNotificationSupported() ||
      !desktopAlertCoordinationSupported()
    ) {
      dispatchSettingsChanged();
      return;
    }

    const permissionBeforeRequest = currentPermission();
    if (permissionBeforeRequest === "unavailable") {
      dispatchSettingsChanged();
      return;
    }

    if (permissionBeforeRequest === "denied") {
      permissionBusy = true;
      transientMessage = null;
      dispatchSettingsChanged();
      try {
        clearDesktopAlertRuntimePause();
        const initialized = await initializeDesktopAlertLedger();
        // The direct choice remains recorded even when the private ledger
        // cannot be used, so the resulting state truthfully reads Paused
        // instead of presenting another apparently usable Enable action.
        writeDesktopAlertPreference(true);
        if (!initialized) dispatchSettingsChanged();
      } finally {
        permissionBusy = false;
        dispatchSettingsChanged();
      }
      return;
    }

    let permissionRequest: Promise<NotificationPermission>;
    try {
      // This call intentionally happens before any await or state update so it
      // remains directly inside the user's Enable-button gesture.
      permissionRequest = Notification.requestPermission();
    } catch {
      transientMessage =
        "The browser could not request notification permission.";
      dispatchSettingsChanged();
      return;
    }

    permissionBusy = true;
    transientMessage = null;
    dispatchSettingsChanged();
    try {
      const permission = await permissionRequest;
      if (permission === "granted") {
        clearDesktopAlertRuntimePause();
        const initialized = await initializeDesktopAlertLedger();
        writeDesktopAlertPreference(true);
        if (!initialized) dispatchSettingsChanged();
      } else if (permission === "denied") {
        const initialized = await initializeDesktopAlertLedger();
        writeDesktopAlertPreference(true);
        if (!initialized) dispatchSettingsChanged();
      } else {
        writeDesktopAlertPreference(false);
        transientMessage = "The permission request was dismissed.";
      }
    } catch {
      transientMessage =
        "The browser could not complete the permission request.";
    } finally {
      permissionBusy = false;
      dispatchSettingsChanged();
    }
  }, []);

  const disable = useCallback(() => {
    transientMessage = null;
    writeDesktopAlertPreference(false);
    dispatchSettingsChanged();
  }, []);

  const setProjectMuted = useCallback(
    async (projectId: string, muted: boolean) => {
      if (projectMuteOperationRef.current) return false;
      projectMuteOperationRef.current = true;
      setProjectMuteBusyId(projectId);
      setProjectMuteMessage(null);
      try {
        const result = await writeDesktopAlertProjectMuted(projectId, muted);
        if (result !== "saved") {
          setProjectMuteMessage(
            result === "capacity"
              ? "The project mute list is full. Existing choices and eligible desktop delivery are unchanged."
              : "This project alert setting could not be saved. Coffice will not rely on the unverified change.",
          );
          return false;
        }
        const next = await readDesktopAlertProjectMutes(stableProjectIds);
        if (!next) {
          setProjectMuteMessage(
            "Project mute settings could not be verified. Existing local choices were left unchanged.",
          );
          return false;
        }
        setResolvedProjectMutes({
          key: projectMutesKey(),
          values: next,
        });
        setProjectMuteMessage(null);
        return true;
      } finally {
        projectMuteOperationRef.current = false;
        setProjectMuteBusyId(null);
      }
    },
    [stableProjectIds],
  );

  const resetProjectMutes = useCallback(async () => {
    if (projectMuteOperationRef.current) return false;
    projectMuteOperationRef.current = true;
    setProjectMuteResetBusy(true);
    setProjectMuteMessage(null);
    try {
      const reset = await resetDesktopAlertProjectMutes();
      if (!reset) {
        setProjectMuteMessage(
          "Project alert settings could not be reset. Existing local state was left unchanged.",
        );
        return false;
      }
      const next = await readDesktopAlertProjectMutes(stableProjectIds);
      if (!next) {
        setProjectMuteMessage(
          "Project mute settings could not be verified after reset.",
        );
        return false;
      }
      setResolvedProjectMutes({
        key: projectMutesKey(),
        values: next,
      });
      setProjectMuteMessage(null);
      dispatchSettingsChanged();
      return true;
    } finally {
      projectMuteOperationRef.current = false;
      setProjectMuteResetBusy(false);
    }
  }, [stableProjectIds]);

  return {
    ...snapshot,
    projectMutedById,
    projectMuteBusyId,
    projectMuteMessage,
    projectMuteResetBusy,
    projectMuteResetAvailable,
    projectMuteManageable,
    enable,
    disable,
    setProjectMuted,
    resetProjectMutes,
  };
}
