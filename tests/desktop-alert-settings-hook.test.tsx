// @vitest-environment happy-dom

import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type DesktopAlertSettingsController,
  useDesktopAlertSettings,
} from "../src/components/use-desktop-alert-settings";

const core = vi.hoisted(() => ({
  changedEvent: "coffice:test-desktop-alerts-changed",
  stored: {
    preference: { version: 1, enabled: false } as {
      version: 1;
      enabled: boolean;
    } | null,
    ledger: null as {
      version: 1;
      handledEventDigests: readonly string[];
      saturated: boolean;
    } | null,
    ledgerPresent: false,
    projectMutes: {
      version: 1,
      mutedProjectDigests: [] as readonly string[],
    } as { version: number; mutedProjectDigests: readonly string[] } | null,
    projectMutesPresent: false,
    storageAccessible: true,
  },
  notificationSupported: true,
  coordinationSupported: true,
  pause: null as string | null,
  initialize: vi.fn(),
  writePreference: vi.fn(),
  clearPause: vi.fn(),
  readProjectMutes: vi.fn(),
  writeProjectMuted: vi.fn(),
  resetProjectMutes: vi.fn(),
}));

vi.mock("../src/lib/desktop-alerts", () => ({
  DESKTOP_ALERT_CHANGED_EVENT: core.changedEvent,
  DESKTOP_ALERT_LEDGER_STORAGE_KEY: "coffice:test-ledger",
  DESKTOP_ALERT_PREFERENCE_STORAGE_KEY: "coffice:test-preference",
  DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY: "coffice:test-project-mutes",
  MAX_DESKTOP_ALERT_HANDLED_DIGESTS: 4096,
  clearDesktopAlertRuntimePause: core.clearPause,
  desktopAlertCoordinationSupported: () => core.coordinationSupported,
  desktopAlertNotificationSupported: () => core.notificationSupported,
  getDesktopAlertRuntimePause: () => core.pause,
  initializeDesktopAlertLedger: core.initialize,
  readDesktopAlertStoredState: () => core.stored,
  readDesktopAlertProjectMutes: core.readProjectMutes,
  writeDesktopAlertProjectMuted: core.writeProjectMuted,
  resetDesktopAlertProjectMutes: core.resetProjectMutes,
  writeDesktopAlertPreference: core.writePreference,
}));

function Harness({
  onController,
}: {
  onController: (controller: DesktopAlertSettingsController) => void;
}) {
  onController(useDesktopAlertSettings());
  return null;
}

describe("useDesktopAlertSettings", () => {
  let host: HTMLDivElement;
  let root: Root;
  let controller: DesktopAlertSettingsController | null;
  let permission: NotificationPermission;
  let requestPermission: ReturnType<
    typeof vi.fn<() => Promise<NotificationPermission>>
  >;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    controller = null;
    permission = "default";
    requestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", {
      get permission() {
        return permission;
      },
      requestPermission,
    });
    core.notificationSupported = true;
    core.coordinationSupported = true;
    core.pause = null;
    core.stored = {
      preference: { version: 1, enabled: false },
      ledger: null,
      ledgerPresent: false,
      projectMutes: { version: 1, mutedProjectDigests: [] },
      projectMutesPresent: false,
      storageAccessible: true,
    };
    core.readProjectMutes.mockReset().mockResolvedValue(new Map());
    core.writeProjectMuted.mockReset().mockResolvedValue(true);
    core.resetProjectMutes.mockReset().mockResolvedValue(true);
    core.initialize.mockReset().mockResolvedValue(true);
    core.writePreference.mockReset().mockImplementation((enabled: boolean) => {
      core.stored.preference = { version: 1, enabled };
      if (enabled) {
        core.stored.ledger = {
          version: 1,
          handledEventDigests: [],
          saturated: false,
        };
        core.stored.ledgerPresent = true;
      }
      return true;
    });
    core.clearPause.mockReset().mockImplementation(() => {
      core.pause = null;
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(strict = true) {
    await act(async () => {
      root.render(
        strict ? (
          <StrictMode>
            <Harness onController={(next) => (controller = next)} />
          </StrictMode>
        ) : (
          <Harness onController={(next) => (controller = next)} />
        ),
      );
    });
  }

  async function notifyChanged() {
    await act(async () => {
      window.dispatchEvent(new Event(core.changedEvent));
    });
  }

  it("never requests permission on mount, focus, visibility, or settings refresh", async () => {
    await render();
    expect(controller?.status).toBe("off");
    expect(requestPermission).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("shows unavailable when the browser refuses permission-state reads", async () => {
    vi.stubGlobal("Notification", {
      get permission() {
        throw new Error("permission state unavailable");
      },
      requestPermission,
    });
    core.stored.preference = { version: 1, enabled: true };
    core.stored.ledger = {
      version: 1,
      handledEventDigests: [],
      saturated: false,
    };
    core.stored.ledgerPresent = true;

    await render();

    expect(controller?.status).toBe("unavailable");
    expect(controller?.enabled).toBe(false);
    await act(async () => controller?.enable());
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("calls requestPermission synchronously before ledger initialization", async () => {
    const order: string[] = [];
    requestPermission.mockImplementation(() => {
      order.push("permission");
      permission = "granted";
      return Promise.resolve("granted");
    });
    core.initialize.mockImplementation(async () => {
      order.push("ledger");
      return true;
    });
    await render();

    await act(async () => controller?.enable());

    expect(order).toEqual(["permission", "ledger"]);
    expect(core.clearPause).toHaveBeenCalledOnce();
    expect(core.writePreference).toHaveBeenCalledExactlyOnceWith(true);
    expect(controller?.status).toBe("on");
  });

  it("stays paused when safe initialization fails after permission is granted", async () => {
    requestPermission.mockImplementation(() => {
      permission = "granted";
      return Promise.resolve("granted");
    });
    core.stored.ledger = {
      version: 1,
      handledEventDigests: [],
      saturated: false,
    };
    core.stored.ledgerPresent = true;
    core.initialize.mockImplementation(async () => {
      core.pause = "Safe cross-tab coordination failed.";
      return false;
    });
    await render();

    await act(async () => controller?.enable());

    expect(core.writePreference).toHaveBeenCalledExactlyOnceWith(true);
    expect(controller?.enabled).toBe(true);
    expect(controller?.status).toBe("paused");
    expect(controller?.message).toContain("cross-tab coordination failed");
  });

  it("keeps opt-in off after a dismissed default permission", async () => {
    requestPermission.mockResolvedValue("default");
    await render();

    await act(async () => controller?.enable());

    expect(core.initialize).not.toHaveBeenCalled();
    expect(core.writePreference).toHaveBeenCalledExactlyOnceWith(false);
    expect(controller?.status).toBe("off");
    expect(controller?.message).toContain("dismissed");
  });

  it("persists denied permission as blocked without automatically re-prompting", async () => {
    requestPermission.mockImplementation(() => {
      permission = "denied";
      return Promise.resolve("denied");
    });
    await render();

    await act(async () => controller?.enable());

    expect(core.initialize).toHaveBeenCalledOnce();
    expect(core.writePreference).toHaveBeenCalledExactlyOnceWith(true);
    expect(controller?.status).toBe("blocked");
    expect(controller?.enabled).toBe(true);
    expect(requestPermission).toHaveBeenCalledOnce();

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("re-reads permission on focus and visibility changes", async () => {
    permission = "granted";
    core.stored.preference = { version: 1, enabled: true };
    core.stored.ledger = {
      version: 1,
      handledEventDigests: [],
      saturated: false,
    };
    core.stored.ledgerPresent = true;
    await render();
    expect(controller?.status).toBe("on");

    permission = "denied";
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(controller?.status).toBe("blocked");

    permission = "granted";
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(controller?.status).toBe("on");
  });

  it("synchronizes preference changes and disables without revoking permission", async () => {
    permission = "granted";
    await render();

    core.stored.preference = { version: 1, enabled: true };
    core.stored.ledger = {
      version: 1,
      handledEventDigests: [],
      saturated: false,
    };
    core.stored.ledgerPresent = true;
    await notifyChanged();
    expect(controller?.status).toBe("on");

    await act(async () => controller?.disable());
    await notifyChanged();
    expect(core.writePreference).toHaveBeenLastCalledWith(false);
    expect(controller?.status).toBe("off");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("shows an explicit opt-out after disabling a saturated runtime-paused setting", async () => {
    permission = "granted";
    const ledger = {
      version: 1 as const,
      handledEventDigests: ["a".repeat(64)],
      saturated: true,
    };
    core.stored.preference = { version: 1, enabled: true };
    core.stored.ledger = ledger;
    core.stored.ledgerPresent = true;
    core.pause = "A previous runtime delivery failed.";
    await render();
    expect(controller?.status).toBe("paused");

    await act(async () => controller?.disable());
    await notifyChanged();

    expect(controller?.status).toBe("off");
    expect(controller?.message).toBeNull();
    expect(core.stored.ledger).toBe(ledger);
    expect(permission).toBe("granted");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("fails closed for missing enabled ledger, persisted saturation, and unavailable support", async () => {
    permission = "granted";
    core.stored.preference = { version: 1, enabled: true };
    await render();
    expect(controller?.status).toBe("paused");
    expect(controller?.coordinationAvailable).toBe(true);

    core.stored.ledger = {
      version: 1,
      handledEventDigests: [],
      saturated: true,
    };
    core.stored.ledgerPresent = true;
    await notifyChanged();
    expect(controller?.status).toBe("paused");
    expect(controller?.message).toContain("safety limit");

    core.notificationSupported = false;
    await notifyChanged();
    expect(controller?.status).toBe("unavailable");
  });

  it("keeps a denied browser permission off until direct enable records the blocked opt-in", async () => {
    permission = "denied";
    await render();

    expect(controller?.status).toBe("off");
    expect(controller?.enabled).toBe(false);
    await act(async () => controller?.enable());
    expect(requestPermission).not.toHaveBeenCalled();
    expect(core.initialize).toHaveBeenCalledOnce();
    expect(core.writePreference).toHaveBeenCalledExactlyOnceWith(true);
    expect(controller?.status).toBe("blocked");
    expect(controller?.enabled).toBe(true);
  });

  it("does not carry a dismissed-request message into a later external opt-in", async () => {
    requestPermission.mockResolvedValue("default");
    await render();
    await act(async () => controller?.enable());
    expect(controller?.message).toContain("dismissed");

    permission = "granted";
    core.stored.preference = { version: 1, enabled: true };
    core.stored.ledger = {
      version: 1,
      handledEventDigests: [],
      saturated: false,
    };
    core.stored.ledgerPresent = true;
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "coffice:test-preference",
          storageArea: window.localStorage,
        }),
      );
    });

    expect(controller?.status).toBe("on");
    expect(controller?.message).toBeNull();

    core.stored.preference = { version: 1, enabled: false };
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "coffice:test-preference",
          storageArea: window.localStorage,
        }),
      );
    });
    expect(controller?.status).toBe("off");
    expect(controller?.message).toBeNull();
  });

  it("clears a dismissed-request message when browser permission changes", async () => {
    requestPermission.mockResolvedValue("default");
    await render();
    await act(async () => controller?.enable());
    expect(controller?.message).toContain("dismissed");

    permission = "granted";
    await act(async () => window.dispatchEvent(new Event("focus")));

    expect(controller?.status).toBe("off");
    expect(controller?.message).toBeNull();
  });

  it("treats a cross-tab localStorage clear event as a settings change", async () => {
    permission = "granted";
    core.stored.preference = { version: 1, enabled: true };
    core.stored.ledger = {
      version: 1,
      handledEventDigests: [],
      saturated: false,
    };
    core.stored.ledgerPresent = true;
    await render();
    expect(controller?.status).toBe("on");

    core.stored.preference = { version: 1, enabled: false };
    core.stored.ledger = null;
    core.stored.ledgerPresent = false;
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: null,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(controller?.status).toBe("off");
  });

  it("hides stale project choices over corruption and clears the error after cross-tab repair", async () => {
    let currentProjectMutes: ReadonlyMap<string, boolean> | null = new Map([
      ["project-a", true],
    ]);
    core.readProjectMutes.mockImplementation(async () => currentProjectMutes);

    function ProjectHarness({
      onController,
    }: {
      onController: (value: DesktopAlertSettingsController) => void;
    }) {
      onController(useDesktopAlertSettings(["project-a"]));
      return null;
    }

    await act(async () => {
      root.render(
        <ProjectHarness onController={(next) => (controller = next)} />,
      );
    });
    expect(controller?.projectMutedById.get("project-a")).toBe(true);

    currentProjectMutes = null as ReadonlyMap<string, boolean> | null;
    core.stored.projectMutes = null;
    core.stored.projectMutesPresent = true;
    await notifyChanged();
    expect(controller?.projectMutedById.has("project-a")).toBe(false);
    expect(controller?.projectMuteMessage).toContain("unavailable");

    currentProjectMutes = new Map([["project-a", false]]);
    core.stored.projectMutes = { version: 1, mutedProjectDigests: [] };
    await notifyChanged();
    expect(controller?.projectMutedById.get("project-a")).toBe(false);
    expect(controller?.projectMuteMessage).toBeNull();
  });

  it("cleans up permission and storage listeners on unmount", async () => {
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    await render(false);

    await act(async () => root.unmount());

    expect(removeWindow).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith("storage", expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith(
      core.changedEvent,
      expect.any(Function),
    );
    expect(removeDocument).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    root = createRoot(host);
  });
});
