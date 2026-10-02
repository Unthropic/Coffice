/**
 * Small process-local stale-while-revalidate cache for expensive read-only
 * snapshots. The loader is single-flight: every caller observes the same
 * promise while a refresh is running.
 */
export interface SnapshotCacheOptions {
  freshForMs: number;
  retryAfterMs: number;
  now?: () => number;
}

export type SnapshotRefreshState = "fresh" | "refreshing" | "stale" | "failed";

export interface SnapshotCacheMetadata {
  state: SnapshotRefreshState;
  ageMs: number;
  lastSuccessAt: number;
  lastAttemptAt?: number;
  lastFailureAt?: number;
}

export interface SnapshotCacheRead<T> {
  value: T;
  metadata: SnapshotCacheMetadata;
}

export class SnapshotRefreshTimeoutError extends Error {
  constructor(maxWaitMs: number) {
    super(`Snapshot refresh exceeded the ${maxWaitMs}ms response deadline.`);
    this.name = "SnapshotRefreshTimeoutError";
  }
}

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export class SnapshotCache<T> {
  private readonly now: () => number;
  private cached: CacheEntry<T> | undefined;
  private inFlight: Promise<T> | undefined;
  private lastAttemptAt: number | undefined;
  private lastFailureAt: number | undefined;

  constructor(
    private readonly loader: () => Promise<T>,
    private readonly options: SnapshotCacheOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async read(maxWaitMs?: number): Promise<T> {
    return (await this.readWithMetadata(maxWaitMs)).value;
  }

  async readWithMetadata(maxWaitMs?: number): Promise<SnapshotCacheRead<T>> {
    const cached = this.cached;
    if (!cached) {
      const value = await this.waitForRefresh(this.refresh(), maxWaitMs);
      return { value, metadata: this.getMetadata() };
    }

    const age = Math.max(0, this.now() - cached.storedAt);
    if (age < this.options.freshForMs) {
      return { value: cached.value, metadata: this.getMetadata() };
    }

    // A stale value remains useful to the read-only UI. Return it immediately
    // while one shared refresh runs in the background.
    if (this.canRetry()) void this.refresh().catch(() => undefined);
    return { value: cached.value, metadata: this.getMetadata() };
  }

  /**
   * Stores an immediately available value (for example a fast deferred read)
   * without running the loader. Ignored once any value is already cached, so a
   * seed can never overwrite a successful load.
   */
  seed(value: T): void {
    if (this.cached) return;
    this.cached = { value, storedAt: this.now() };
  }

  /**
   * Starts one background refresh unless one is already running or the failure
   * backoff is still active. Single-flight: concurrent calls share the same
   * in-flight loader. Resolves with the refreshed value, or with undefined
   * when the refresh was skipped or failed; never rejects.
   */
  async revalidateInBackground(): Promise<T | undefined> {
    if (!this.canRetry()) return undefined;
    try {
      return await this.refresh();
    } catch {
      return undefined;
    }
  }

  private canRetry(): boolean {
    return (
      this.inFlight !== undefined ||
      this.lastFailureAt === undefined ||
      this.now() - this.lastFailureAt >= this.options.retryAfterMs
    );
  }

  private refresh(): Promise<T> {
    if (this.inFlight) return this.inFlight;

    this.lastAttemptAt = this.now();
    const refresh = Promise.resolve()
      .then(this.loader)
      .then((value) => {
        this.cached = { value, storedAt: this.now() };
        this.lastFailureAt = undefined;
        return value;
      })
      .catch((error: unknown) => {
        this.lastFailureAt = this.now();
        throw error;
      })
      .finally(() => {
        if (this.inFlight === refresh) this.inFlight = undefined;
      });

    this.inFlight = refresh;
    return refresh;
  }

  private getMetadata(): SnapshotCacheMetadata {
    const cached = this.cached;
    if (!cached) {
      throw new Error(
        "Snapshot cache metadata requested before a successful read.",
      );
    }
    const ageMs = Math.max(0, this.now() - cached.storedAt);
    const stale = ageMs >= this.options.freshForMs;
    const failed =
      this.lastFailureAt !== undefined && this.lastFailureAt >= cached.storedAt;
    return {
      state: this.inFlight
        ? "refreshing"
        : failed
          ? "failed"
          : !stale
            ? "fresh"
            : "stale",
      ageMs,
      lastSuccessAt: cached.storedAt,
      ...(this.lastAttemptAt !== undefined
        ? { lastAttemptAt: this.lastAttemptAt }
        : {}),
      ...(this.lastFailureAt !== undefined
        ? { lastFailureAt: this.lastFailureAt }
        : {}),
    };
  }

  private async waitForRefresh(
    refresh: Promise<T>,
    maxWaitMs: number | undefined,
  ): Promise<T> {
    if (maxWaitMs === undefined) return await refresh;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        refresh,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new SnapshotRefreshTimeoutError(maxWaitMs)),
            maxWaitMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
