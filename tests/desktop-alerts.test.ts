// @vitest-environment happy-dom

import { webcrypto } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DESKTOP_ALERT_CLAIM_LOCK_NAME,
  DESKTOP_ALERT_DELIVERY_LOCK_NAME,
  DESKTOP_ALERT_FOREGROUND_LOCK_NAME,
  DESKTOP_ALERT_LEDGER_STORAGE_KEY,
  DESKTOP_ALERT_PREFERENCE_STORAGE_KEY,
  DESKTOP_ALERT_PROJECT_MUTES_LOCK_NAME,
  DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
  MAX_DESKTOP_ALERT_HANDLED_DIGESTS,
  MAX_DESKTOP_ALERT_PROJECT_MUTES,
  claimDesktopAlertEventKeys,
  clearDesktopAlertRuntimePause,
  digestDesktopAlertEventKey,
  getDesktopAlertRuntimePause,
  initializeDesktopAlertLedger,
  readDesktopAlertStoredState,
  readDesktopAlertProjectMutes,
  reportDesktopAlertFailure,
  resetDesktopAlertProjectMutes,
  withDesktopAlertDeliveryOpportunity,
  withDesktopAlertMutePartition,
  writeDesktopAlertPreference,
  writeDesktopAlertProjectMuted,
} from "../src/lib/desktop-alerts";

interface LockCall {
  name: string;
  options: LockOptions;
}

class TestLockManager {
  calls: LockCall[] = [];
  throwRequests = false;
  deliveryAvailable = true;
  foregroundAvailable = true;
  private deliveryQueue: Promise<void> = Promise.resolve();

  request<T>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T> {
    this.calls.push({ name, options });
    if (this.throwRequests) return Promise.reject(new Error("lock failed"));
    const available =
      name === DESKTOP_ALERT_DELIVERY_LOCK_NAME
        ? this.deliveryAvailable
        : name === DESKTOP_ALERT_FOREGROUND_LOCK_NAME
          ? this.foregroundAvailable
          : true;
    const lock =
      options.ifAvailable && !available
        ? null
        : ({ name, mode: options.mode ?? "exclusive" } as Lock);
    if (name === DESKTOP_ALERT_DELIVERY_LOCK_NAME && !options.ifAvailable) {
      const result = this.deliveryQueue.then(() => callback(lock));
      this.deliveryQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }
    return Promise.resolve(callback(lock));
  }
}

function setLedger(
  handledEventDigests: readonly string[],
  saturated = false,
): void {
  window.localStorage.setItem(
    DESKTOP_ALERT_LEDGER_STORAGE_KEY,
    JSON.stringify({ version: 1, handledEventDigests, saturated }),
  );
}

describe("desktop alert coordination core", () => {
  let locks: TestLockManager;

  beforeEach(() => {
    window.localStorage.clear();
    clearDesktopAlertRuntimePause();
    locks = new TestLockManager();
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: locks,
    });
    vi.stubGlobal("crypto", webcrypto);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    clearDesktopAlertRuntimePause();
  });

  it("creates exact lowercase SHA-256 identities without persisting raw keys", async () => {
    expect(await digestDesktopAlertEventKey("event-a")).toBe(
      "2edb68c52e4b9cf2c91e5752b72821bb9c0f45373c9fe9143f85453a5c76bd90",
    );
    expect(window.localStorage.length).toBe(0);
  });

  it("migrates missing project mutes to empty and stores only domain-separated digests", async () => {
    expect(readDesktopAlertStoredState().projectMutes).toEqual({
      version: 1,
      mutedProjectDigests: [],
    });
    expect(
      window.localStorage.getItem(DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY),
    ).toBeNull();

    expect(await writeDesktopAlertProjectMuted("__unassigned__", true)).toBe(
      "saved",
    );
    const raw =
      window.localStorage.getItem(DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY) ??
      "";
    expect(raw).not.toContain("__unassigned__");
    expect(raw).not.toContain("project-a");
    expect(locks.calls.at(-1)?.name).toBe(
      DESKTOP_ALERT_PROJECT_MUTES_LOCK_NAME,
    );
    expect(
      await readDesktopAlertProjectMutes(["__unassigned__", "project-a"]),
    ).toEqual(
      new Map([
        ["__unassigned__", true],
        ["project-a", false],
      ]),
    );

    const sameTextEventDigest =
      await digestDesktopAlertEventKey("__unassigned__");
    expect(
      readDesktopAlertStoredState().projectMutes?.mutedProjectDigests[0],
    ).not.toBe(sameTextEventDigest);
  });

  it("strictly rejects malformed project mute records without exposing or rewriting them", () => {
    const digest = "a".repeat(64);
    const invalidRecords = [
      {},
      { version: 2, mutedProjectDigests: [] },
      { version: 1 },
      { version: 1, mutedProjectDigests: [], extra: true },
      { version: 1, mutedProjectDigests: [digest, digest] },
      { version: 1, mutedProjectDigests: ["A".repeat(64)] },
      { version: 1, mutedProjectDigests: ["not-a-digest"] },
      {
        version: 1,
        mutedProjectDigests: Array.from(
          { length: MAX_DESKTOP_ALERT_PROJECT_MUTES + 1 },
          (_, index) => index.toString(16).padStart(64, "0"),
        ),
      },
    ];
    for (const record of invalidRecords) {
      const raw = JSON.stringify(record);
      window.localStorage.setItem(DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY, raw);
      expect(readDesktopAlertStoredState().projectMutes).toBeNull();
      expect(
        window.localStorage.getItem(DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY),
      ).toBe(raw);
    }
  });

  it("partitions exact projects, retains absent mutes, and supports unmute and reset recovery", async () => {
    await writeDesktopAlertProjectMuted("project-hidden", true);
    await writeDesktopAlertProjectMuted("project-a", true);
    const partition = vi.fn();
    expect(
      await withDesktopAlertMutePartition(
        [
          { id: "a", projectId: "project-a" },
          { id: "holding", projectId: "__unassigned__" },
        ],
        (value) => value.projectId,
        partition,
      ),
    ).toBe(true);
    expect(partition).toHaveBeenCalledWith({
      muted: [{ id: "a", projectId: "project-a" }],
      unmuted: [{ id: "holding", projectId: "__unassigned__" }],
    });

    await writeDesktopAlertProjectMuted("project-a", false);
    expect(
      (await readDesktopAlertProjectMutes(["project-a"]))?.get("project-a"),
    ).toBe(false);
    expect(
      readDesktopAlertStoredState().projectMutes?.mutedProjectDigests,
    ).toHaveLength(1);

    window.localStorage.setItem(
      DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
      "corrupt-private-state",
    );
    expect(readDesktopAlertStoredState().projectMutes).toBeNull();
    expect(await resetDesktopAlertProjectMutes()).toBe(true);
    expect(readDesktopAlertStoredState().projectMutes).toEqual({
      version: 1,
      mutedProjectDigests: [],
    });
  });

  it("reset clears only a mute-origin pause and preserves unrelated delivery failures", async () => {
    window.localStorage.setItem(
      DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
      "corrupt-private-state",
    );
    expect(await readDesktopAlertProjectMutes(["project-a"])).toBeNull();
    expect(getDesktopAlertRuntimePause()).toContain(
      "Project alert settings are unreadable",
    );
    expect(await resetDesktopAlertProjectMutes()).toBe(true);
    expect(getDesktopAlertRuntimePause()).toBeNull();

    reportDesktopAlertFailure("An unrelated constructor failure remains.");
    window.localStorage.setItem(
      DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
      "corrupt-private-state",
    );
    expect(await readDesktopAlertProjectMutes(["project-a"])).toBeNull();
    expect(await resetDesktopAlertProjectMutes()).toBe(true);
    expect(getDesktopAlertRuntimePause()).toBe(
      "An unrelated constructor failure remains.",
    );
  });

  it("a verified cross-tab repair clears only the local mute-origin pause", async () => {
    window.localStorage.setItem(
      DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
      "corrupt-private-state",
    );
    expect(await readDesktopAlertProjectMutes(["project-a"])).toBeNull();
    expect(getDesktopAlertRuntimePause()).toContain(
      "Project alert settings are unreadable",
    );

    window.localStorage.setItem(
      DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
      JSON.stringify({ version: 1, mutedProjectDigests: [] }),
    );
    expect(await readDesktopAlertProjectMutes(["project-a"])).toEqual(
      new Map([["project-a", false]]),
    );
    expect(getDesktopAlertRuntimePause()).toBeNull();

    reportDesktopAlertFailure("An unrelated constructor failure remains.");
    expect(await readDesktopAlertProjectMutes(["project-a"])).toEqual(
      new Map([["project-a", false]]),
    );
    expect(getDesktopAlertRuntimePause()).toBe(
      "An unrelated constructor failure remains.",
    );
  });

  it("merges concurrent different-project writes under the exclusive mute lock", async () => {
    await Promise.all([
      writeDesktopAlertProjectMuted("project-a", true),
      writeDesktopAlertProjectMuted("project-b", true),
    ]);
    expect(
      await readDesktopAlertProjectMutes([
        "project-a",
        "project-b",
        "project-renamed",
      ]),
    ).toEqual(
      new Map([
        ["project-a", true],
        ["project-b", true],
        ["project-renamed", false],
      ]),
    );
    expect(
      locks.calls.filter(
        ({ name, options }) =>
          name === DESKTOP_ALERT_PROJECT_MUTES_LOCK_NAME &&
          options.mode === "exclusive",
      ),
    ).toHaveLength(2);
  });

  it("refuses only a new mute at the bound without evicting existing choices or pausing delivery", async () => {
    const digests = Array.from(
      { length: MAX_DESKTOP_ALERT_PROJECT_MUTES },
      (_, index) => index.toString(16).padStart(64, "0"),
    );
    window.localStorage.setItem(
      DESKTOP_ALERT_PROJECT_MUTES_STORAGE_KEY,
      JSON.stringify({ version: 1, mutedProjectDigests: digests }),
    );

    expect(await writeDesktopAlertProjectMuted("new-project", true)).toBe(
      "capacity",
    );
    expect(getDesktopAlertRuntimePause()).toBeNull();
    expect(
      readDesktopAlertStoredState().projectMutes?.mutedProjectDigests,
    ).toEqual(digests);
    expect(await resetDesktopAlertProjectMutes()).toBe(true);
  });

  it("strictly rejects corrupt, extra-key, and missing enabled delivery state", () => {
    window.localStorage.setItem(
      DESKTOP_ALERT_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: 1, enabled: true, rawEventKey: "private" }),
    );
    setLedger([], false);
    expect(readDesktopAlertStoredState().preference).toBeNull();

    window.localStorage.setItem(
      DESKTOP_ALERT_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: 1, enabled: true }),
    );
    window.localStorage.setItem(
      DESKTOP_ALERT_LEDGER_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        handledEventDigests: [],
        saturated: false,
        eventKey: "must-not-be-accepted",
      }),
    );
    expect(readDesktopAlertStoredState().ledger).toBeNull();

    window.localStorage.removeItem(DESKTOP_ALERT_LEDGER_STORAGE_KEY);
    const missing = readDesktopAlertStoredState();
    expect(missing.preference?.enabled).toBe(true);
    expect(missing.ledgerPresent).toBe(false);
    expect(missing.ledger).toBeNull();
  });

  it("initializes an empty ledger under the claim lock before preference opt-in", async () => {
    expect(await initializeDesktopAlertLedger()).toBe(true);
    expect(locks.calls[0]).toMatchObject({
      name: DESKTOP_ALERT_CLAIM_LOCK_NAME,
      options: { mode: "exclusive" },
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(DESKTOP_ALERT_LEDGER_STORAGE_KEY) ?? "",
      ),
    ).toEqual({ version: 1, handledEventDigests: [], saturated: false });
    expect(
      window.localStorage.getItem(DESKTOP_ALERT_PREFERENCE_STORAGE_KEY),
    ).toBeNull();

    expect(writeDesktopAlertPreference(true)).toBe(true);
    expect(readDesktopAlertStoredState().preference?.enabled).toBe(true);
  });

  it("never overwrites a corrupt ledger during initialization", async () => {
    const corrupt = '{"version":1,"handledEventDigests":["raw-key"]}';
    window.localStorage.setItem(DESKTOP_ALERT_LEDGER_STORAGE_KEY, corrupt);

    expect(await initializeDesktopAlertLedger()).toBe(false);
    expect(window.localStorage.getItem(DESKTOP_ALERT_LEDGER_STORAGE_KEY)).toBe(
      corrupt,
    );
    expect(getDesktopAlertRuntimePause()).toContain("unreadable");
  });

  it("atomically claims only new digests and reports the exact primary and count", async () => {
    await initializeDesktopAlertLedger();
    const existingDigest = await digestDesktopAlertEventKey("existing");
    const newDigest = await digestDesktopAlertEventKey("new");
    setLedger([existingDigest!]);

    const result = await claimDesktopAlertEventKeys(
      ["existing", "new", "new"],
      "delivered",
    );

    expect(result).toEqual({
      kind: "claimed",
      primaryDigest: newDigest,
      claimedCount: 1,
    });
    const storedRaw =
      window.localStorage.getItem(DESKTOP_ALERT_LEDGER_STORAGE_KEY) ?? "";
    expect(storedRaw).not.toContain("existing");
    expect(storedRaw).not.toContain('"new"');
    expect(JSON.parse(storedRaw)).toEqual({
      version: 1,
      handledEventDigests: [existingDigest, newDigest],
      saturated: false,
    });
  });

  it("persists saturation at the exact bound without evicting identities or accepting later overflow", async () => {
    const existing = Array.from(
      { length: MAX_DESKTOP_ALERT_HANDLED_DIGESTS - 1 },
      (_, index) => index.toString(16).padStart(64, "0"),
    );
    setLedger(existing);

    const finalDigest = await digestDesktopAlertEventKey("final-identity");
    const exactBound = await claimDesktopAlertEventKeys(
      ["final-identity"],
      "delivered",
    );
    expect(exactBound).toEqual({ kind: "saturated", claimedCount: 0 });

    const saturated = readDesktopAlertStoredState().ledger;
    expect(saturated?.saturated).toBe(true);
    expect(saturated?.handledEventDigests).toEqual([...existing, finalDigest]);
    expect(getDesktopAlertRuntimePause()).toContain("safety limit");

    clearDesktopAlertRuntimePause();
    const afterReload = await claimDesktopAlertEventKeys(
      ["overflow-c"],
      "delivered",
    );
    expect(afterReload).toEqual({ kind: "saturated", claimedCount: 0 });
    expect(readDesktopAlertStoredState().ledger?.handledEventDigests).toEqual([
      ...existing,
      finalDigest,
    ]);
  });

  it("fails closed on hashing, storage, and lock failures", async () => {
    const subtle = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValueOnce(new Error("hash failed"));
    expect(await digestDesktopAlertEventKey("private-key")).toBeUndefined();
    expect(getDesktopAlertRuntimePause()).toContain("identities");
    subtle.mockRestore();

    clearDesktopAlertRuntimePause();
    await initializeDesktopAlertLedger();
    vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("storage failed");
    });
    expect(await claimDesktopAlertEventKeys(["new"], "delivered")).toEqual({
      kind: "unavailable",
      claimedCount: 0,
    });
    expect(getDesktopAlertRuntimePause()).toContain("could not be saved");

    vi.restoreAllMocks();
    clearDesktopAlertRuntimePause();
    locks.throwRequests = true;
    expect(await claimDesktopAlertEventKeys(["other"], "delivered")).toEqual({
      kind: "unavailable",
      claimedCount: 0,
    });
    expect(getDesktopAlertRuntimePause()).toContain("cross-tab coordination");
  });

  it("distinguishes acquired, foreground, queued, and unavailable opportunities", async () => {
    const callback = vi.fn(() => () => "delivered");
    const foreground = vi.fn();
    await expect(
      withDesktopAlertDeliveryOpportunity(callback, foreground),
    ).resolves.toEqual({ kind: "acquired", value: "delivered" });
    expect(callback).toHaveBeenCalledOnce();
    expect(foreground).not.toHaveBeenCalled();
    expect(
      locks.calls.find(({ name }) => name === DESKTOP_ALERT_DELIVERY_LOCK_NAME)
        ?.options,
    ).toEqual({ mode: "exclusive" });

    locks.foregroundAvailable = false;
    await expect(
      withDesktopAlertDeliveryOpportunity(callback, foreground),
    ).resolves.toEqual({ kind: "foreground" });
    expect(callback).toHaveBeenCalledOnce();
    expect(foreground).toHaveBeenCalledOnce();

    locks.foregroundAvailable = true;
    locks.deliveryAvailable = false;
    await expect(
      withDesktopAlertDeliveryOpportunity(callback, foreground),
    ).resolves.toEqual({ kind: "acquired", value: "delivered" });
    expect(callback).toHaveBeenCalledTimes(2);

    locks.deliveryAvailable = true;
    locks.throwRequests = true;
    await expect(
      withDesktopAlertDeliveryOpportunity(callback, foreground),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(callback).toHaveBeenCalledTimes(2);
    expect(getDesktopAlertRuntimePause()).toContain("cross-tab coordination");
  });

  it("queues a different hidden-page batch instead of dropping the contender", async () => {
    await initializeDesktopAlertLedger();
    const order: string[] = [];
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withDesktopAlertDeliveryOpportunity(
      async () => {
        order.push("prepare-a");
        markFirstStarted?.();
        await firstGate;
        await claimDesktopAlertEventKeys(["unique-a"], "delivered");
        return () => {
          order.push("commit-a");
        };
      },
      () => undefined,
    );
    await firstStarted;
    const second = withDesktopAlertDeliveryOpportunity(
      async () => {
        order.push("prepare-b");
        await claimDesktopAlertEventKeys(["unique-b"], "delivered");
        return () => {
          order.push("commit-b");
        };
      },
      () => undefined,
    );

    expect(order).toEqual(["prepare-a"]);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(["prepare-a", "commit-a", "prepare-b", "commit-b"]);
    const ledger = readDesktopAlertStoredState().ledger;
    expect(ledger?.handledEventDigests).toEqual([
      await digestDesktopAlertEventKey("unique-a"),
      await digestDesktopAlertEventKey("unique-b"),
    ]);
  });

  it("lets a visible tab win the final probe after async preparation", async () => {
    let finishPreparation: (() => void) | undefined;
    const preparation = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    const commit = vi.fn();
    const foreground = vi.fn();
    const opportunity = withDesktopAlertDeliveryOpportunity(async () => {
      await preparation;
      return commit;
    }, foreground);

    await Promise.resolve();
    await Promise.resolve();
    locks.foregroundAvailable = false;
    finishPreparation?.();

    await expect(opportunity).resolves.toEqual({ kind: "foreground" });
    expect(foreground).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });
});
