export type DesktopAlertStatus =
  "off" | "on" | "blocked" | "unavailable" | "paused";

export const DESKTOP_ALERT_PREFERENCE_STORAGE_KEY =
  "coffice:desktop-alert-preference:v1";
export const DESKTOP_ALERT_LEDGER_STORAGE_KEY =
  "coffice:desktop-alert-ledger:v1";
export const DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY =
  "coffice:desktop-alert-project-mutes:v1";
export const DESKTOP_ALERT_CHANGED_EVENT = "coffice:desktop-alerts-changed";
export const DESKTOP_ALERT_CLAIM_LOCK_NAME = "coffice:desktop-alert-claim:v1";
export const DESKTOP_ALERT_FOREGROUND_LOCK_NAME =
  "coffice:desktop-alert-foreground:v1";
export const DESKTOP_ALERT_DELIVERY_LOCK_NAME =
  "coffice:desktop-alert-delivery:v1";
export const DESKTOP_ALERT_PROJECT_MUTES_LOCK_NAME =
  "coffice:desktop-alert-project-mutes:v1";
export const DESKTOP_ALERT_NOTIFICATION_TAG = "coffice-attention-v1";

export const MAX_DESKTOP_ALERT_HANDLED_DIGESTS = 4_096;
export const MAX_DESKTOP_ALERT_PROJECT_MUTES = 4_096;

interface DesktopAlertPreference {
  version: 1;
  enabled: boolean;
}

interface DesktopAlertLedger {
  version: 1;
  handledEventDigests: readonly string[];
  saturated: boolean;
}

interface DesktopAlertProjectMutes {
  version: 1;
  mutedProjectDigests: readonly string[];
}

export interface DesktopAlertClaimResult {
  kind: "claimed" | "duplicate" | "unavailable" | "saturated";
  primaryDigest?: string;
  claimedCount: number;
}

export type DesktopAlertDeliveryOpportunity<T> =
  | { kind: "acquired"; value: T }
  | { kind: "foreground" }
  | { kind: "unavailable" };

const EMPTY_LEDGER: DesktopAlertLedger = {
  version: 1,
  handledEventDigests: [],
  saturated: false,
};
const EMPTY_PROJECT_MUTES: DesktopAlertProjectMutes = {
  version: 1,
  mutedProjectDigests: [],
};
const HEX_SHA_256 = /^[a-f0-9]{64}$/u;
let runtimePauseMessage: string | null = null;
let projectMuteRuntimePauseMessage: string | null = null;

function windowAvailable(): boolean {
  return typeof window !== "undefined";
}

function storageChanged(): void {
  if (!windowAvailable()) return;
  window.dispatchEvent(new Event(DESKTOP_ALERT_CHANGED_EVENT));
}

export function refreshDesktopAlertState(): void {
  storageChanged();
}

export function desktopAlertCoordinationSupported(): boolean {
  if (!windowAvailable() || typeof navigator === "undefined") return false;
  if (window.isSecureContext === false) return false;
  const runtimeNavigator = navigator as Navigator & {
    locks?: { request?: unknown };
  };
  const runtimeCrypto = globalThis.crypto as Crypto | undefined;
  return Boolean(
    typeof runtimeNavigator.locks?.request === "function" &&
    typeof runtimeCrypto?.subtle?.digest === "function" &&
    typeof TextEncoder !== "undefined",
  );
}

export function desktopAlertNotificationSupported(): boolean {
  if (!windowAvailable() || window.isSecureContext === false) return false;
  return Boolean(
    typeof Notification !== "undefined" &&
    typeof Notification.requestPermission === "function",
  );
}

function parsePreference(raw: string | null): DesktopAlertPreference | null {
  if (raw === null) return { version: 1, enabled: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).length === 2 &&
      "version" in value &&
      value.version === 1 &&
      "enabled" in value &&
      typeof value.enabled === "boolean"
    ) {
      return { version: 1, enabled: value.enabled };
    }
  } catch {
    // Corrupt opt-in state fails closed and is never silently rewritten.
  }
  return null;
}

function parseLedger(raw: string | null): DesktopAlertLedger | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      Object.keys(value).length !== 3 ||
      !("version" in value) ||
      value.version !== 1 ||
      !("handledEventDigests" in value) ||
      !Array.isArray(value.handledEventDigests) ||
      !("saturated" in value) ||
      typeof value.saturated !== "boolean" ||
      value.handledEventDigests.length > MAX_DESKTOP_ALERT_HANDLED_DIGESTS ||
      value.handledEventDigests.some(
        (digest) => typeof digest !== "string" || !HEX_SHA_256.test(digest),
      ) ||
      new Set(value.handledEventDigests).size !==
        value.handledEventDigests.length
    ) {
      return null;
    }
    return {
      version: 1,
      handledEventDigests: value.handledEventDigests,
      saturated: value.saturated,
    };
  } catch {
    return null;
  }
}

function parseProjectMutes(
  raw: string | null,
): DesktopAlertProjectMutes | null {
  // Missing v1 state is the additive migration from the original all-project
  // desktop channel. It means that no exact project identity is muted.
  if (raw === null) return EMPTY_PROJECT_MUTES;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      Object.keys(value).length !== 2 ||
      !("version" in value) ||
      value.version !== 1 ||
      !("mutedProjectDigests" in value) ||
      !Array.isArray(value.mutedProjectDigests) ||
      value.mutedProjectDigests.length > MAX_DESKTOP_ALERT_PROJECT_MUTES ||
      value.mutedProjectDigests.some(
        (digest) => typeof digest !== "string" || !HEX_SHA_256.test(digest),
      ) ||
      new Set(value.mutedProjectDigests).size !==
        value.mutedProjectDigests.length
    ) {
      return null;
    }
    return {
      version: 1,
      mutedProjectDigests: value.mutedProjectDigests,
    };
  } catch {
    return null;
  }
}

export interface DesktopAlertStoredState {
  preference: DesktopAlertPreference | null;
  ledger: DesktopAlertLedger | null;
  ledgerPresent: boolean;
  projectMutes: DesktopAlertProjectMutes | null;
  projectMutesPresent: boolean;
  storageAccessible: boolean;
}

export function readDesktopAlertStoredState(): DesktopAlertStoredState {
  if (!windowAvailable()) {
    return {
      preference: { version: 1, enabled: false },
      ledger: null,
      ledgerPresent: false,
      projectMutes: EMPTY_PROJECT_MUTES,
      projectMutesPresent: false,
      storageAccessible: false,
    };
  }
  try {
    const ledgerRaw = window.localStorage.getItem(
      DESKTOP_ALERT_LEDGER_STORAGE_KEY,
    );
    const projectMutesRaw = window.localStorage.getItem(
      DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
    );
    return {
      preference: parsePreference(
        window.localStorage.getItem(DESKTOP_ALERT_PREFERENCE_STORAGE_KEY),
      ),
      ledger: parseLedger(ledgerRaw),
      ledgerPresent: ledgerRaw !== null,
      projectMutes: parseProjectMutes(projectMutesRaw),
      projectMutesPresent: projectMutesRaw !== null,
      storageAccessible: true,
    };
  } catch {
    return {
      preference: null,
      ledger: null,
      ledgerPresent: false,
      projectMutes: null,
      projectMutesPresent: false,
      storageAccessible: false,
    };
  }
}

export async function initializeDesktopAlertLedger(): Promise<boolean> {
  if (!windowAvailable() || !desktopAlertCoordinationSupported()) return false;
  try {
    return await requestLock(
      DESKTOP_ALERT_CLAIM_LOCK_NAME,
      { mode: "exclusive" },
      () => {
        const raw = window.localStorage.getItem(
          DESKTOP_ALERT_LEDGER_STORAGE_KEY,
        );
        if (raw !== null) {
          const ledger = parseLedger(raw);
          if (
            ledger &&
            !ledger.saturated &&
            ledger.handledEventDigests.length <
              MAX_DESKTOP_ALERT_HANDLED_DIGESTS
          ) {
            return true;
          }
          reportDesktopAlertFailure(
            ledger?.saturated ||
              ledger?.handledEventDigests.length ===
                MAX_DESKTOP_ALERT_HANDLED_DIGESTS
              ? "Desktop alerts are paused because their private delivery history reached its safety limit."
              : "Desktop alerts are paused because their private delivery history is unreadable.",
          );
          return false;
        }
        window.localStorage.setItem(
          DESKTOP_ALERT_LEDGER_STORAGE_KEY,
          JSON.stringify(EMPTY_LEDGER),
        );
        storageChanged();
        return true;
      },
    );
  } catch {
    reportDesktopAlertFailure(
      "Desktop alerts are paused because their private delivery history could not be initialized.",
    );
    return false;
  }
}

export function writeDesktopAlertPreference(enabled: boolean): boolean {
  if (!windowAvailable()) return false;
  try {
    const preference: DesktopAlertPreference = { version: 1, enabled };
    window.localStorage.setItem(
      DESKTOP_ALERT_PREFERENCE_STORAGE_KEY,
      JSON.stringify(preference),
    );
    if (!enabled) {
      runtimePauseMessage = null;
      projectMuteRuntimePauseMessage = null;
    }
    storageChanged();
    return true;
  } catch {
    reportDesktopAlertFailure(
      "Desktop alerts are paused because browser-local settings could not be saved.",
    );
    return false;
  }
}

export function getDesktopAlertRuntimePause(): string | null {
  return runtimePauseMessage ?? projectMuteRuntimePauseMessage;
}

export function reportDesktopAlertFailure(message: string): void {
  runtimePauseMessage = message;
  storageChanged();
}

export function clearDesktopAlertRuntimePause(): void {
  if (runtimePauseMessage === null && projectMuteRuntimePauseMessage === null) {
    return;
  }
  runtimePauseMessage = null;
  projectMuteRuntimePauseMessage = null;
  storageChanged();
}

function reportDesktopAlertProjectMuteFailure(message: string): void {
  projectMuteRuntimePauseMessage = message;
  storageChanged();
}

function clearDesktopAlertProjectMutePause(): boolean {
  if (projectMuteRuntimePauseMessage === null) return false;
  projectMuteRuntimePauseMessage = null;
  return true;
}

export async function digestDesktopAlertEventKey(
  eventKey: string,
): Promise<string | undefined> {
  if (!desktopAlertCoordinationSupported()) return undefined;
  try {
    const bytes = new TextEncoder().encode(eventKey);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    reportDesktopAlertFailure(
      "Desktop alerts are paused because private delivery identities could not be created.",
    );
    return undefined;
  }
}

async function digestDesktopAlertProjectId(
  projectId: string,
): Promise<string | undefined> {
  if (!projectId.trim() || !desktopAlertCoordinationSupported()) {
    return undefined;
  }
  try {
    // Domain separation prevents a project ID and Attention event key with the
    // same text from sharing a persisted digest identity.
    const bytes = new TextEncoder().encode(`project\u0000${projectId}`);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    reportDesktopAlertProjectMuteFailure(
      "Project alert settings could not create private identities. Reset them before future alerts rely on project choices.",
    );
    return undefined;
  }
}

export type DesktopAlertProjectMuteWriteResult =
  "saved" | "capacity" | "unavailable";

export async function writeDesktopAlertProjectMuted(
  projectId: string,
  muted: boolean,
): Promise<DesktopAlertProjectMuteWriteResult> {
  const digest = await digestDesktopAlertProjectId(projectId);
  if (!digest || !windowAvailable()) return "unavailable";
  try {
    return await requestLock(
      DESKTOP_ALERT_PROJECT_MUTES_LOCK_NAME,
      { mode: "exclusive" },
      () => {
        const stored = readDesktopAlertStoredState();
        if (!stored.storageAccessible || !stored.projectMutes) {
          reportDesktopAlertProjectMuteFailure(
            "Project alert settings are unreadable. Reset them before future alerts rely on project choices.",
          );
          return "unavailable";
        }
        const current = new Set(stored.projectMutes.mutedProjectDigests);
        if (muted) current.add(digest);
        else current.delete(digest);
        if (current.size > MAX_DESKTOP_ALERT_PROJECT_MUTES) {
          // Never evict an older mute: doing so could silently resume a project.
          return "capacity";
        }
        const next: DesktopAlertProjectMutes = {
          version: 1,
          mutedProjectDigests: [...current],
        };
        window.localStorage.setItem(
          DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
          JSON.stringify(next),
        );
        clearDesktopAlertProjectMutePause();
        storageChanged();
        return "saved";
      },
    );
  } catch {
    reportDesktopAlertProjectMuteFailure(
      "Project alert settings could not be saved. Future alerts will not rely on the unverified change.",
    );
    return "unavailable";
  }
}

export async function resetDesktopAlertProjectMutes(): Promise<boolean> {
  if (!windowAvailable() || !desktopAlertCoordinationSupported()) return false;
  try {
    return await requestLock(
      DESKTOP_ALERT_PROJECT_MUTES_LOCK_NAME,
      { mode: "exclusive" },
      () => {
        // Explicit reset is the recovery path for corrupt, full, and orphaned
        // mute records. It intentionally clears identities not currently shown.
        window.localStorage.setItem(
          DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
          JSON.stringify(EMPTY_PROJECT_MUTES),
        );
        clearDesktopAlertProjectMutePause();
        storageChanged();
        return true;
      },
    );
  } catch {
    reportDesktopAlertProjectMuteFailure(
      "Project alert settings could not be reset. Existing local choices remain unchanged.",
    );
    return false;
  }
}

export async function readDesktopAlertProjectMutes(
  projectIds: readonly string[],
): Promise<ReadonlyMap<string, boolean> | null> {
  let result: ReadonlyMap<string, boolean> | null = null;
  const uniqueProjectIds = [...new Set(projectIds)];
  const resolved = await withDesktopAlertMutePartition(
    uniqueProjectIds,
    (projectId) => projectId,
    ({ muted, unmuted }) => {
      result = new Map([
        ...muted.map((projectId) => [projectId, true] as const),
        ...unmuted.map((projectId) => [projectId, false] as const),
      ]);
    },
  );
  return resolved ? result : null;
}

export interface DesktopAlertMutePartition<T> {
  muted: readonly T[];
  unmuted: readonly T[];
}

/**
 * Linearizes one eligibility decision with cross-tab mute mutations. Exact
 * project IDs, including `__unassigned__`, are hashed before comparison and
 * never enter browser storage. Mutes are retained until explicit unmute or site
 * data clearing; transient project disappearance never silently unmutes work.
 */
export async function withDesktopAlertMutePartition<T>(
  values: readonly T[],
  projectIdFor: (value: T) => string,
  callback: (partition: DesktopAlertMutePartition<T>) => Promise<void> | void,
): Promise<boolean> {
  if (!desktopAlertCoordinationSupported()) return false;
  const digestEntries = await Promise.all(
    values.map(async (value) => ({
      value,
      digest: await digestDesktopAlertProjectId(projectIdFor(value)),
    })),
  );
  if (digestEntries.some(({ digest }) => digest === undefined)) {
    reportDesktopAlertProjectMuteFailure(
      "An exact project alert identity is unavailable. Future alerts will not rely on project choices.",
    );
    return false;
  }
  try {
    return await requestLock(
      DESKTOP_ALERT_PROJECT_MUTES_LOCK_NAME,
      { mode: "shared" },
      async () => {
        const stored = readDesktopAlertStoredState();
        if (!stored.storageAccessible || !stored.projectMutes) {
          reportDesktopAlertProjectMuteFailure(
            "Project alert settings are unreadable. Reset them before future alerts rely on project choices.",
          );
          return false;
        }
        const mutedDigests = new Set(stored.projectMutes.mutedProjectDigests);
        const partition: DesktopAlertMutePartition<T> = {
          muted: digestEntries
            .filter(({ digest }) => mutedDigests.has(digest!))
            .map(({ value }) => value),
          unmuted: digestEntries
            .filter(({ digest }) => !mutedDigests.has(digest!))
            .map(({ value }) => value),
        };
        await callback(partition);
        if (clearDesktopAlertProjectMutePause()) storageChanged();
        return true;
      },
    );
  } catch {
    reportDesktopAlertProjectMuteFailure(
      "Project alert settings could not coordinate safely across tabs. Future alerts will not rely on the unverified change.",
    );
    return false;
  }
}

async function requestLock<T>(
  name: string,
  options: LockOptions,
  callback: (lock: Lock | null) => Promise<T> | T,
): Promise<T> {
  return navigator.locks.request(name, options, callback);
}

export async function claimDesktopAlertEventKeys(
  eventKeys: readonly string[],
  mode: "delivered" | "foreground" | "baseline" | "muted",
): Promise<DesktopAlertClaimResult> {
  void mode;
  const uniqueKeys = [...new Set(eventKeys)];
  if (uniqueKeys.length === 0) {
    return { kind: "duplicate", claimedCount: 0 };
  }
  const digests = await Promise.all(
    uniqueKeys.map((eventKey) => digestDesktopAlertEventKey(eventKey)),
  );
  if (digests.some((digest) => digest === undefined)) {
    return { kind: "unavailable", claimedCount: 0 };
  }
  const exactDigests = digests as string[];
  if (!desktopAlertCoordinationSupported()) {
    return { kind: "unavailable", claimedCount: 0 };
  }

  try {
    return await requestLock(
      DESKTOP_ALERT_CLAIM_LOCK_NAME,
      { mode: "exclusive" },
      () => {
        const stored = readDesktopAlertStoredState();
        if (!stored.storageAccessible || !stored.ledger) {
          reportDesktopAlertFailure(
            "Desktop alerts are paused because their private delivery history is unavailable.",
          );
          return { kind: "unavailable", claimedCount: 0 } as const;
        }
        if (stored.ledger.saturated) {
          return { kind: "saturated", claimedCount: 0 } as const;
        }
        const handled = new Set(stored.ledger.handledEventDigests);
        const newlyClaimed = exactDigests.filter(
          (digest) => !handled.has(digest),
        );
        if (newlyClaimed.length === 0) {
          return { kind: "duplicate", claimedCount: 0 } as const;
        }
        const nextSize = handled.size + newlyClaimed.length;
        if (nextSize >= MAX_DESKTOP_ALERT_HANDLED_DIGESTS) {
          const saturatedLedger: DesktopAlertLedger = {
            ...stored.ledger,
            handledEventDigests:
              nextSize === MAX_DESKTOP_ALERT_HANDLED_DIGESTS
                ? [...stored.ledger.handledEventDigests, ...newlyClaimed]
                : stored.ledger.handledEventDigests,
            saturated: true,
          };
          try {
            window.localStorage.setItem(
              DESKTOP_ALERT_LEDGER_STORAGE_KEY,
              JSON.stringify(saturatedLedger),
            );
          } catch {
            reportDesktopAlertFailure(
              "Desktop alerts are paused because their private delivery history could not be saved.",
            );
            return { kind: "unavailable", claimedCount: 0 } as const;
          }
          reportDesktopAlertFailure(
            "Desktop alerts are paused because their private delivery history reached its safety limit.",
          );
          return { kind: "saturated", claimedCount: 0 } as const;
        }

        const next: DesktopAlertLedger = {
          version: 1,
          handledEventDigests: [
            ...stored.ledger.handledEventDigests,
            ...newlyClaimed,
          ],
          saturated: false,
        };
        try {
          window.localStorage.setItem(
            DESKTOP_ALERT_LEDGER_STORAGE_KEY,
            JSON.stringify(next),
          );
        } catch {
          reportDesktopAlertFailure(
            "Desktop alerts are paused because their private delivery history could not be saved.",
          );
          return { kind: "unavailable", claimedCount: 0 } as const;
        }
        storageChanged();
        return {
          kind: "claimed",
          primaryDigest: newlyClaimed[0],
          claimedCount: newlyClaimed.length,
        } as const;
      },
    );
  } catch {
    reportDesktopAlertFailure(
      "Desktop alerts are paused because safe cross-tab coordination failed.",
    );
    return { kind: "unavailable", claimedCount: 0 };
  }
}

export async function holdDesktopAlertForegroundLock(
  signal: AbortSignal,
): Promise<void> {
  if (!desktopAlertCoordinationSupported() || signal.aborted) return;
  try {
    await requestLock(
      DESKTOP_ALERT_FOREGROUND_LOCK_NAME,
      { mode: "shared", signal },
      async () => {
        if (signal.aborted) return;
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
  } catch {
    if (!signal.aborted) {
      reportDesktopAlertFailure(
        "Desktop alerts are paused because foreground coordination failed.",
      );
    }
  }
}

/**
 * Gives one hidden page the delivery opportunity and proves, atomically for
 * that callback, that no visible Coffice page holds the shared foreground lock.
 * Hidden contenders queue so a different batch cannot be mistaken for the
 * winner's batch. The preparation phase runs without the foreground lock;
 * presentation is then committed synchronously under a second probe.
 */
export async function withDesktopAlertDeliveryOpportunity<T>(
  prepare: () => Promise<() => T> | (() => T),
  onForeground: () => Promise<void> | void,
): Promise<DesktopAlertDeliveryOpportunity<T>> {
  if (!desktopAlertCoordinationSupported()) return { kind: "unavailable" };
  try {
    return await requestLock(
      DESKTOP_ALERT_DELIVERY_LOCK_NAME,
      { mode: "exclusive" },
      async () => {
        const initiallyClear = await requestLock(
          DESKTOP_ALERT_FOREGROUND_LOCK_NAME,
          { mode: "exclusive", ifAvailable: true },
          (foregroundOpportunity) => Boolean(foregroundOpportunity),
        );
        if (!initiallyClear) {
          await onForeground();
          return { kind: "foreground" } as const;
        }

        // Hashing and ledger I/O run without a foreground lock. A page that
        // becomes visible during those awaits can therefore acquire/queue its
        // shared lock before this final, synchronous presentation gate.
        const commit = await prepare();
        return requestLock(
          DESKTOP_ALERT_FOREGROUND_LOCK_NAME,
          { mode: "exclusive", ifAvailable: true },
          async (foregroundOpportunity) => {
            if (!foregroundOpportunity) {
              await onForeground();
              return { kind: "foreground" } as const;
            }
            return { kind: "acquired", value: commit() } as const;
          },
        );
      },
    );
  } catch {
    reportDesktopAlertFailure(
      "Desktop alerts are paused because safe cross-tab coordination failed.",
    );
    return { kind: "unavailable" };
  }
}
