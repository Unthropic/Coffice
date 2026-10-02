import { describe, expect, it } from "vitest";

import {
  SnapshotCache,
  SnapshotRefreshTimeoutError,
} from "../src/lib/snapshot-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe("SnapshotCache", () => {
  it("deduplicates concurrent cold callers onto one loader", async () => {
    const load = deferred<{ version: number }>();
    let loads = 0;
    const cache = new SnapshotCache(
      async () => {
        loads += 1;
        return await load.promise;
      },
      { freshForMs: 10_000, retryAfterMs: 10_000 },
    );

    const first = cache.read();
    const second = cache.read();
    await Promise.resolve();
    expect(loads).toBe(1);

    load.resolve({ version: 1 });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { version: 1 },
      { version: 1 },
    ]);
  });

  it("serves fresh and stale values promptly while one refresh runs", async () => {
    let now = 1_000;
    let loads = 0;
    const refresh = deferred<{ version: number }>();
    const cache = new SnapshotCache(
      async () => {
        loads += 1;
        return loads === 1 ? { version: 1 } : await refresh.promise;
      },
      { freshForMs: 100, retryAfterMs: 50, now: () => now },
    );

    await expect(cache.read()).resolves.toEqual({ version: 1 });
    now += 50;
    await expect(cache.read()).resolves.toEqual({ version: 1 });
    expect(loads).toBe(1);

    now += 51;
    await expect(cache.readWithMetadata()).resolves.toMatchObject({
      value: { version: 1 },
      metadata: { state: "refreshing", ageMs: 101 },
    });
    await expect(
      Promise.all([cache.read(), cache.read(), cache.read()]),
    ).resolves.toEqual([{ version: 1 }, { version: 1 }, { version: 1 }]);
    await Promise.resolve();
    expect(loads).toBe(2);

    refresh.resolve({ version: 2 });
    await refresh.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(cache.read()).resolves.toEqual({ version: 2 });
  });

  it("retains the last good value and backs off after a failed refresh", async () => {
    let now = 5_000;
    let loads = 0;
    const cache = new SnapshotCache(
      async () => {
        loads += 1;
        if (loads > 1) throw new Error("synthetic refresh failure");
        return "last-good";
      },
      { freshForMs: 10, retryAfterMs: 100, now: () => now },
    );

    await expect(cache.read()).resolves.toBe("last-good");
    now += 11;
    await expect(cache.read()).resolves.toBe("last-good");
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toBe(2);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(cache.readWithMetadata()).resolves.toMatchObject({
      value: "last-good",
      metadata: { state: "failed", lastFailureAt: now },
    });

    await expect(cache.read()).resolves.toBe("last-good");
    expect(loads).toBe(2);
    now += 100;
    await expect(cache.read()).resolves.toBe("last-good");
    await Promise.resolve();
    expect(loads).toBe(3);
  });

  it("bounds a cold caller without abandoning the shared refresh", async () => {
    const load = deferred<string>();
    let loads = 0;
    const cache = new SnapshotCache(
      async () => {
        loads += 1;
        return await load.promise;
      },
      { freshForMs: 100, retryAfterMs: 100 },
    );

    await expect(cache.read(5)).rejects.toBeInstanceOf(
      SnapshotRefreshTimeoutError,
    );
    expect(loads).toBe(1);

    const waitingCaller = cache.read(100);
    expect(loads).toBe(1);
    load.resolve("eventual-value");
    await expect(waitingCaller).resolves.toBe("eventual-value");
    await expect(cache.read()).resolves.toBe("eventual-value");
  });

  it("seeds an initial value and never overwrites an existing one", async () => {
    let loads = 0;
    const cache = new SnapshotCache(
      async () => {
        loads += 1;
        return { version: 2 };
      },
      { freshForMs: 10_000, retryAfterMs: 10_000 },
    );

    cache.seed({ version: 1 });
    await expect(cache.read()).resolves.toEqual({ version: 1 });
    expect(loads).toBe(0);

    // A second seed must not replace the already cached value.
    cache.seed({ version: 9 });
    await expect(cache.read()).resolves.toEqual({ version: 1 });
    expect(loads).toBe(0);
  });

  it("revalidates in the background as one shared flight", async () => {
    let loads = 0;
    const refresh = deferred<{ version: number }>();
    const cache = new SnapshotCache(
      async () => {
        loads += 1;
        return await refresh.promise;
      },
      { freshForMs: 100, retryAfterMs: 100 },
    );

    const first = cache.revalidateInBackground();
    const second = cache.revalidateInBackground();
    await Promise.resolve();
    expect(loads).toBe(1);
    cache.seed({ version: 1 });
    await expect(cache.readWithMetadata()).resolves.toMatchObject({
      value: { version: 1 },
      metadata: { state: "refreshing" },
    });

    refresh.resolve({ version: 7 });
    await expect(first).resolves.toEqual({ version: 7 });
    await expect(second).resolves.toEqual({ version: 7 });
    await expect(cache.read()).resolves.toEqual({ version: 7 });
  });

  it("background revalidation never rejects and honors failure backoff", async () => {
    let now = 0;
    let loads = 0;
    const cache = new SnapshotCache(
      async () => {
        loads += 1;
        throw new Error("synthetic background failure");
      },
      { freshForMs: 100, retryAfterMs: 50, now: () => now },
    );

    await expect(cache.revalidateInBackground()).resolves.toBeUndefined();
    expect(loads).toBe(1);

    // Within the backoff window the call is skipped without touching the loader.
    await expect(cache.revalidateInBackground()).resolves.toBeUndefined();
    expect(loads).toBe(1);

    now += 50;
    await expect(cache.revalidateInBackground()).resolves.toBeUndefined();
    expect(loads).toBe(2);
  });
});
