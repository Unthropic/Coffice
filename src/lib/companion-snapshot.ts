import { readCodexSource } from "./codex-source";
import type { CofficeSnapshot } from "./domain";
import { buildSnapshotFromSource } from "./snapshot";
import { SnapshotCache } from "./snapshot-cache";

export const COMPANION_POLL_INTERVAL_MS = 3_000;

/** The companion observes local activity; it never connects to App Server. */
export async function buildCompanionSnapshot(): Promise<CofficeSnapshot> {
  const source = await readCodexSource({ includeRepositoryEvidence: false });
  if (!source.rosterAvailable || !source.globalStateAvailable) {
    throw new Error("Codex visible-thread metadata is unavailable.");
  }
  const snapshot = buildSnapshotFromSource(source);
  return {
    ...snapshot,
    source: { ...snapshot.source, pollIntervalMs: COMPANION_POLL_INTERVAL_MS },
  };
}

export function createCompanionSnapshotReader(
  loader: () => Promise<CofficeSnapshot> = buildCompanionSnapshot,
  now: () => number = Date.now,
  seed?: () => Promise<CofficeSnapshot>,
): () => Promise<CofficeSnapshot> {
  const cache = new SnapshotCache(loader, {
    freshForMs: 1_000,
    retryAfterMs: COMPANION_POLL_INTERVAL_MS,
    now,
  });
  let seedRead: Promise<void> | undefined;

  return async () => {
    if (seed) {
      seedRead ??= seed()
        .then((value) => {
          cache.seed(value);
          void cache.revalidateInBackground();
        })
        .catch((error: unknown) => {
          seedRead = undefined;
          throw error;
        });
      await seedRead;
    }
    const { value, metadata } = await cache.readWithMetadata(2_500);
    return {
      ...value,
      source: {
        ...value.source,
        health:
          metadata.state === "failed" && value.source.health === "connected"
            ? "degraded"
            : value.source.health,
        pollIntervalMs: COMPANION_POLL_INTERVAL_MS,
        freshness:
          metadata.state !== "failed" &&
          metadata.ageMs < COMPANION_POLL_INTERVAL_MS * 3 &&
          !value.diagnostics.some(
            (item) => item.code === "SESSION_METADATA_DEFERRED",
          )
            ? "fresh"
            : "stale",
        refreshState: metadata.state,
        cacheAgeMs: metadata.ageMs,
        lastRefreshSuccessAt: new Date(metadata.lastSuccessAt).toISOString(),
        ...(metadata.lastAttemptAt !== undefined
          ? {
              lastRefreshAttemptAt: new Date(
                metadata.lastAttemptAt,
              ).toISOString(),
            }
          : {}),
        ...(metadata.lastFailureAt !== undefined
          ? {
              lastRefreshFailureAt: new Date(
                metadata.lastFailureAt,
              ).toISOString(),
            }
          : {}),
      },
    };
  };
}

export const getCompanionSnapshot = createCompanionSnapshotReader(
  buildCompanionSnapshot,
  Date.now,
  async () => {
    const source = await readCodexSource({
      deferSessionMetadata: true,
      includeRepositoryEvidence: false,
    });
    if (!source.rosterAvailable || !source.globalStateAvailable) {
      throw new Error("Codex visible-thread metadata is unavailable.");
    }
    return buildSnapshotFromSource(source);
  },
);
