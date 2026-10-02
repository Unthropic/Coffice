// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopAlertSettings } from "../src/components/desktop-alert-settings";
import type { DesktopAlertSettingsController } from "../src/components/use-desktop-alert-settings";

function controller(
  overrides: Partial<DesktopAlertSettingsController> = {},
): DesktopAlertSettingsController {
  return {
    status: "off",
    busy: false,
    message: null,
    enabled: false,
    optedIn: false,
    coordinationAvailable: true,
    projectMutedById: new Map(),
    projectMuteBusyId: null,
    projectMuteMessage: null,
    projectMuteResetBusy: false,
    projectMuteResetAvailable: false,
    projectMuteManageable: true,
    setProjectMuted: vi.fn().mockResolvedValue(true),
    resetProjectMutes: vi.fn().mockResolvedValue(true),
    enable: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn(),
    ...overrides,
  };
}

describe("DesktopAlertSettings", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function render(value: DesktopAlertSettingsController) {
    await act(async () =>
      root.render(
        <DesktopAlertSettings
          controller={value}
          projects={[
            { id: "project-a", name: "Project A" },
            {
              id: "__unassigned__",
              name: "Unassigned sessions",
              holding: true,
            },
          ]}
        />,
      ),
    );
  }

  function button(): HTMLButtonElement | null {
    return host.querySelector("button");
  }

  it("discloses privacy and support limits without requesting permission", async () => {
    const value = controller();
    await render(value);

    expect(host.textContent).toContain("Desktop alerts");
    expect(host.textContent).toContain("Off");
    expect(host.textContent).toContain("Coffice must remain open");
    expect(host.textContent).toContain("never include a project name");
    expect(host.textContent).toContain("notification history");
    expect(value.enable).not.toHaveBeenCalled();

    await act(async () => {
      host.querySelector("summary")!.click();
    });
    expect(value.enable).not.toHaveBeenCalled();
  });

  it("requests permission only from the explicit enable button", async () => {
    const value = controller();
    await render(value);

    await act(async () => button()!.click());
    expect(value.enable).toHaveBeenCalledOnce();
    expect(value.disable).not.toHaveBeenCalled();
  });

  it("keeps one focused control when enabled and explains browser ownership", async () => {
    const value = controller({ status: "on", enabled: true });
    await render(value);

    expect(button()?.textContent).toBe("Turn off desktop alerts");
    expect(host.textContent).toContain("does not revoke the browser");
    await act(async () => button()!.click());
    expect(value.disable).toHaveBeenCalledOnce();
    expect(value.enable).not.toHaveBeenCalled();
  });

  it.each([
    ["blocked", "blocked by the browser", "Desktop alerts blocked"],
    [
      "unavailable",
      "in-app cue and Digest remain available",
      "Desktop alerts unavailable",
    ],
    ["paused", "paused to prevent duplicate alerts", "Desktop alerts paused"],
  ] as const)(
    "renders the %s state without an unsafe action",
    async (status, copy, label) => {
      await render(controller({ status, coordinationAvailable: false }));

      expect(host.textContent).toContain(copy);
      expect(button()?.textContent).toBe(label);
      expect(button()?.disabled).toBe(true);
    },
  );

  it("keeps an explicit off control when delivery pauses after enablement", async () => {
    const value = controller({ status: "paused", enabled: true });
    await render(value);

    expect(button()?.textContent).toBe("Turn off desktop alerts");
    expect(button()?.disabled).toBe(false);
    await act(async () => button()!.click());
    expect(value.disable).toHaveBeenCalledOnce();
  });

  it("keeps permission progress and failure text accessible", async () => {
    await render(
      controller({
        busy: true,
        message: "The permission request was dismissed.",
      }),
    );

    expect(button()?.disabled).toBe(true);
    expect(button()?.textContent).toBe("Requesting permission…");
    expect(
      Array.from(host.querySelectorAll('[role="status"]')).some((item) =>
        item.textContent?.includes("dismissed"),
      ),
    ).toBe(true);
  });

  it("keeps project delivery controls visible while opted in and changes only that preference", async () => {
    const setProjectMuted = vi.fn().mockResolvedValue(true);
    const value = controller({
      status: "blocked",
      optedIn: true,
      enabled: true,
      projectMutedById: new Map([
        ["project-a", false],
        ["__unassigned__", true],
      ]),
      projectMuteResetAvailable: true,
      setProjectMuted,
    });
    await render(value);

    const project = host.querySelector<HTMLInputElement>(
      'input[aria-label="Desktop alerts for Project A"]',
    )!;
    const holding = host.querySelector<HTMLInputElement>(
      'input[aria-label="Desktop alerts for Unassigned sessions"]',
    )!;
    expect(project.checked).toBe(true);
    expect(holding.checked).toBe(false);
    expect(host.textContent).toContain(
      "Muted projects still appear in Attention",
    );
    expect(host.textContent).toContain(
      "Muting only stops future desktop alerts",
    );
    expect(host.textContent).toContain("does not withdraw an alert");

    project.focus();
    await act(async () => project.click());
    expect(setProjectMuted).toHaveBeenCalledWith("project-a", true);
    expect(document.activeElement).toBe(project);
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "Desktop alerts muted for Project A.",
    );
  });

  it("does not guess while a project preference is unresolved and reports failed writes", async () => {
    await render(
      controller({
        status: "paused",
        optedIn: true,
        projectMutedById: new Map([["__unassigned__", false]]),
        projectMuteMessage: "Project alert settings could not be saved.",
        projectMuteResetAvailable: true,
        setProjectMuted: vi.fn().mockResolvedValue(false),
      }),
    );

    const unresolved = host.querySelector<HTMLInputElement>(
      'input[aria-label="Desktop alerts for Project A"]',
    )!;
    expect(unresolved.disabled).toBe(true);
    expect(unresolved.checked).toBe(false);
    expect(host.textContent).toContain("could not be saved");
  });

  it("confirms reset before resuming visible and hidden delivery scopes", async () => {
    const resetProjectMutes = vi.fn().mockResolvedValue(true);
    await render(
      controller({
        status: "on",
        optedIn: true,
        enabled: true,
        projectMutedById: new Map([
          ["project-a", true],
          ["__unassigned__", false],
        ]),
        projectMuteResetAvailable: true,
        resetProjectMutes,
      }),
    );

    const reset = Array.from(host.querySelectorAll("button")).find(
      (candidate) =>
        candidate.textContent === "Reset all muted delivery scopes",
    )!;
    await act(async () => reset.click());
    expect(resetProjectMutes).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      "including projects not currently shown",
    );
    expect(host.textContent).toContain("does not create or replay an alert");
    expect(document.activeElement?.textContent).toBe("Keep current mutes");

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    expect(resetProjectMutes).not.toHaveBeenCalled();
    const restoredReset = Array.from(host.querySelectorAll("button")).find(
      (candidate) =>
        candidate.textContent === "Reset all muted delivery scopes",
    )!;
    expect(document.activeElement).toBe(restoredReset);

    await act(async () => restoredReset.click());

    const confirm = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Resume all future alerts",
    )!;
    await act(async () => confirm.click());
    expect(resetProjectMutes).toHaveBeenCalledOnce();
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "All muted desktop-delivery scopes were reset.",
    );
    expect(document.activeElement).toBe(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="Desktop alerts for Project A"]',
      ),
    );
  });

  it("keeps project rows unavailable while reset is being persisted", async () => {
    await render(
      controller({
        projectMutedById: new Map([
          ["project-a", true],
          ["__unassigned__", false],
        ]),
        projectMuteResetAvailable: true,
        projectMuteResetBusy: true,
      }),
    );

    expect(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="Desktop alerts for Project A"]',
      )?.disabled,
    ).toBe(true);
  });

  it("allows delivery preconfiguration while globally off without requesting permission", async () => {
    const value = controller({
      status: "off",
      optedIn: false,
      coordinationAvailable: true,
      projectMutedById: new Map([
        ["project-a", false],
        ["__unassigned__", false],
      ]),
    });
    await render(value);

    expect(
      host.querySelector('input[aria-label="Desktop alerts for Project A"]'),
    ).not.toBeNull();
    expect(value.enable).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      "These choices apply if desktop alerts are enabled.",
    );
    expect(host.textContent).not.toContain("Reset all muted delivery scopes");
  });

  it("keeps project choices manageable when browser notifications are unavailable", async () => {
    await render(
      controller({
        status: "unavailable",
        coordinationAvailable: true,
        projectMuteManageable: true,
        projectMutedById: new Map([
          ["project-a", false],
          ["__unassigned__", true],
        ]),
        projectMuteResetAvailable: true,
      }),
    );

    expect(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="Desktop alerts for Project A"]',
      )?.disabled,
    ).toBe(false);
    expect(host.textContent).toContain("Reset all muted delivery scopes");
  });

  it("offers reset recovery for an unreadable mute record while leaving rows unresolved", async () => {
    await render(
      controller({
        status: "paused",
        projectMuteManageable: true,
        projectMutedById: new Map(),
        projectMuteResetAvailable: true,
        projectMuteMessage:
          "Project alert settings are unreadable and need to be reset.",
      }),
    );

    expect(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="Desktop alerts for Project A"]',
      )?.disabled,
    ).toBe(true);
    expect(host.textContent).toContain("Reset all muted delivery scopes");
    expect(host.textContent).toContain("unreadable and need to be reset");
  });

  it("follows authoritative project rename, removal, and reappearance without losing the ID preference", async () => {
    const value = controller({
      status: "on",
      enabled: true,
      optedIn: true,
      projectMutedById: new Map([
        ["project-a", true],
        ["__unassigned__", false],
      ]),
      projectMuteResetAvailable: true,
    });
    await act(async () =>
      root.render(
        <DesktopAlertSettings
          controller={value}
          projects={[{ id: "project-a", name: "Renamed project" }]}
        />,
      ),
    );
    expect(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="Desktop alerts for Renamed project"]',
      )?.checked,
    ).toBe(false);

    await act(async () =>
      root.render(<DesktopAlertSettings controller={value} projects={[]} />),
    );
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.textContent).toContain("Reset all muted delivery scopes");

    await act(async () =>
      root.render(
        <DesktopAlertSettings
          controller={value}
          projects={[{ id: "project-a", name: "Renamed again" }]}
        />,
      ),
    );
    expect(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="Desktop alerts for Renamed again"]',
      )?.checked,
    ).toBe(false);
  });

  it("disambiguates duplicate visible project names without exposing exact IDs", async () => {
    const value = controller({
      status: "on",
      enabled: true,
      projectMutedById: new Map([
        ["private-project-id-a", false],
        ["private-project-id-b", true],
      ]),
    });
    await act(async () =>
      root.render(
        <DesktopAlertSettings
          controller={value}
          projects={[
            { id: "private-project-id-a", name: "Shared name" },
            { id: "private-project-id-b", name: "Shared name" },
          ]}
        />,
      ),
    );

    expect(
      host.querySelector(
        'input[aria-label="Desktop alerts for Shared name (1)"]',
      ),
    ).not.toBeNull();
    expect(
      host.querySelector(
        'input[aria-label="Desktop alerts for Shared name (2)"]',
      ),
    ).not.toBeNull();
    expect(host.textContent).not.toContain("private-project-id");
  });

  it("keeps the holding scope's exact name when a saved project shares it", async () => {
    await act(async () =>
      root.render(
        <DesktopAlertSettings
          controller={controller({
            projectMutedById: new Map([
              ["saved-project", false],
              ["__unassigned__", true],
            ]),
          })}
          projects={[
            { id: "saved-project", name: "Unassigned sessions" },
            {
              id: "__unassigned__",
              name: "Unassigned sessions",
              holding: true,
            },
          ]}
        />,
      ),
    );

    expect(
      host.querySelector(
        'input[aria-label="Desktop alerts for Unassigned sessions"]',
      ),
    ).not.toBeNull();
    expect(
      host.querySelector(
        'input[aria-label="Desktop alerts for Unassigned sessions (project 1)"]',
      ),
    ).not.toBeNull();
  });

  it("omits project controls when safe coordination is unavailable", async () => {
    await render(
      controller({
        status: "unavailable",
        coordinationAvailable: false,
        projectMuteManageable: false,
        projectMuteResetAvailable: true,
      }),
    );

    expect(host.querySelector("fieldset")).toBeNull();
    expect(host.textContent).not.toContain("Reset all muted delivery scopes");
  });
});
