"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ATTENTION_REVIEW_LEGACY_STORAGE_KEY,
  ATTENTION_REVIEW_STORAGE_KEY,
  parseAttentionReviewState,
  repairInvalidAttentionBaseline,
  serializeAttentionReviewState,
  type AttentionReviewState,
  type AttentionDisposition,
} from "../lib/attention-inbox";
import type {
  CofficeWorkspace,
  WorkspaceMutation,
} from "../lib/coffice-workspace";
import type { WorkspaceRecovery } from "../lib/coffice-workspace-store";

interface WorkspaceSuccessResponse {
  workspace: CofficeWorkspace;
  recovery: WorkspaceRecovery;
  persistence: { persistent: true };
}

interface WorkspaceErrorResponse {
  error: string;
  code: string;
  workspace?: CofficeWorkspace;
  recovery?: WorkspaceRecovery;
  persistence?: { persistent: boolean };
}

export type WorkspaceMutationResult =
  | { ok: true; workspace: CofficeWorkspace }
  | {
      ok: false;
      reason: "conflict" | "unavailable" | "invalid";
    };

export interface CofficeWorkspaceController {
  workspace: CofficeWorkspace | null;
  ready: boolean;
  persistent: boolean;
  recovery: WorkspaceRecovery | null;
  recoveryAcknowledged: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  acknowledgeRecovery: () => void;
  mutate: (mutation: WorkspaceMutation) => Promise<WorkspaceMutationResult>;
  replaceAttentionReview: (
    state: AttentionReviewState,
  ) => Promise<WorkspaceMutationResult>;
  updateAttentionEvent: (
    eventKey: string,
    disposition: AttentionDisposition | null,
    snoozedUntil: string | null,
  ) => Promise<WorkspaceMutationResult>;
}

function mutationId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function contentMutationId(value: string): string {
  // Two independent 32-bit accumulators provide a stable browser-only receipt
  // without retaining any attention data in the identifier.
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `attention-migration-${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

async function responseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function useCofficeWorkspace(): CofficeWorkspaceController {
  const [workspace, setWorkspace] = useState<CofficeWorkspace | null>(null);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(false);
  const [recovery, setRecovery] = useState<WorkspaceRecovery | null>(null);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceRef = useRef<CofficeWorkspace | null>(null);
  const recoveryRef = useRef<WorkspaceRecovery | null>(null);
  const recoveryKeyRef = useRef<string | null>(null);
  const recoveryAcknowledgedRef = useRef(false);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const migrationInFlight = useRef(false);
  const migrationAttempted = useRef<string | null>(null);

  const acceptRecovery = useCallback((next: WorkspaceRecovery) => {
    const key = next.kind === "backup" ? `backup:${next.reason}` : null;
    if (key !== recoveryKeyRef.current) {
      recoveryKeyRef.current = key;
      recoveryAcknowledgedRef.current = false;
      setRecoveryAcknowledged(false);
    }
    recoveryRef.current = next;
    setRecovery(next);
  }, []);

  const accept = useCallback(
    (payload: WorkspaceSuccessResponse) => {
      if (
        workspaceRef.current &&
        payload.workspace.revision < workspaceRef.current.revision &&
        payload.recovery.kind !== "backup"
      ) {
        setPersistent(payload.persistence.persistent);
        setError(null);
        return;
      }
      workspaceRef.current = payload.workspace;
      setWorkspace(payload.workspace);
      acceptRecovery(payload.recovery);
      setPersistent(payload.persistence.persistent);
      setError(null);
    },
    [acceptRecovery],
  );

  const acknowledgeRecovery = useCallback(() => {
    if (recoveryRef.current?.kind !== "backup") return;
    recoveryAcknowledgedRef.current = true;
    setRecoveryAcknowledged(true);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/workspace", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await responseJson<
        WorkspaceSuccessResponse | WorkspaceErrorResponse
      >(response);
      if (!response.ok || !payload || !("workspace" in payload)) {
        setPersistent(false);
        setError(
          payload && "error" in payload
            ? payload.error
            : "Coffice workspace is unavailable.",
        );
        return;
      }
      accept(payload as WorkspaceSuccessResponse);
    } catch {
      setPersistent(false);
      setError("Coffice workspace is unavailable.");
    } finally {
      setReady(true);
    }
  }, [accept]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const sendMutation = useCallback(
    (
      mutation: WorkspaceMutation,
      id = mutationId(),
    ): Promise<WorkspaceMutationResult> => {
      const execute = async (): Promise<WorkspaceMutationResult> => {
        const current = workspaceRef.current;
        if (!current) return { ok: false, reason: "unavailable" };
        if (
          recoveryRef.current?.kind === "backup" &&
          !recoveryAcknowledgedRef.current
        ) {
          setError("Review the recovered workspace before saving new changes.");
          return { ok: false, reason: "unavailable" };
        }
        const body = JSON.stringify({
          expectedRevision: current.revision,
          mutationId: id,
          mutation,
        });

        let response: Response;
        try {
          response = await fetch("/api/workspace", {
            method: "PATCH",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body,
          });
        } catch {
          // A lost response is ambiguous: retry the byte-identical idempotent
          // request once. Never replay a semantic mutation against a new revision.
          try {
            response = await fetch("/api/workspace", {
              method: "PATCH",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body,
            });
          } catch {
            setPersistent(false);
            setError("Coffice could not save this change.");
            return { ok: false, reason: "unavailable" };
          }
        }

        const payload = await responseJson<
          WorkspaceSuccessResponse | WorkspaceErrorResponse
        >(response);
        if (response.ok && payload && "workspace" in payload) {
          const confirmed = payload as WorkspaceSuccessResponse;
          accept(confirmed);
          return { ok: true, workspace: confirmed.workspace };
        }
        if (response.status === 409 && payload?.workspace) {
          workspaceRef.current = payload.workspace;
          setWorkspace(payload.workspace);
          if (payload.recovery) acceptRecovery(payload.recovery);
          setPersistent(payload.persistence?.persistent === true);
          setError(
            "The workspace changed elsewhere. Review the latest state and try again.",
          );
          return { ok: false, reason: "conflict" };
        }
        if (payload?.persistence) {
          setPersistent(payload.persistence.persistent === true);
        }
        setError(
          payload && "error" in payload
            ? payload.error
            : "Coffice could not save this change.",
        );
        return {
          ok: false,
          reason:
            response.status === 400 || response.status === 413
              ? "invalid"
              : "unavailable",
        };
      };
      const result = mutationQueueRef.current.then(execute, execute);
      mutationQueueRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [accept, acceptRecovery],
  );

  const writePersistent =
    persistent && (recovery?.kind !== "backup" || recoveryAcknowledged);

  const replaceAttentionReview = useCallback(
    (state: AttentionReviewState) =>
      sendMutation({ type: "attention.update", state }),
    [sendMutation],
  );
  const updateAttentionEvent = useCallback(
    (
      eventKey: string,
      disposition: AttentionDisposition | null,
      snoozedUntil: string | null,
    ) =>
      sendMutation({
        type: "attention.event",
        eventKey,
        disposition,
        snoozedUntil,
      }),
    [sendMutation],
  );

  useEffect(() => {
    if (!ready || !writePersistent || !workspace || migrationInFlight.current) {
      return;
    }
    let raw: string | null = null;
    let state: AttentionReviewState | null = null;
    try {
      raw = window.localStorage.getItem(ATTENTION_REVIEW_STORAGE_KEY);
      state = parseAttentionReviewState(raw);
      if (!state) {
        raw = window.localStorage.getItem(ATTENTION_REVIEW_LEGACY_STORAGE_KEY);
        state = parseAttentionReviewState(raw);
      }
    } catch {
      return;
    }
    const observedAt = new Date().toISOString();
    if (workspace.migrations.attentionReviewV2ImportedAt) {
      try {
        window.localStorage.removeItem(ATTENTION_REVIEW_STORAGE_KEY);
        window.localStorage.removeItem(ATTENTION_REVIEW_LEGACY_STORAGE_KEY);
      } catch {
        // The server-side migration receipt remains authoritative.
      }
      const repaired = repairInvalidAttentionBaseline(
        workspace.attentionReview,
        observedAt,
      );
      if (repaired === workspace.attentionReview) return;
      const repairKey = `repair:${workspace.revision}:${serializeAttentionReviewState(repaired)}`;
      if (migrationAttempted.current === repairKey) return;
      migrationAttempted.current = repairKey;
      migrationInFlight.current = true;
      void sendMutation({ type: "attention.update", state: repaired }).then(
        () => {
          migrationInFlight.current = false;
        },
      );
      return;
    }

    if (!state) {
      const repaired = repairInvalidAttentionBaseline(
        workspace.attentionReview,
        observedAt,
      );
      if (repaired === workspace.attentionReview) return;
      const repairKey = `repair:${workspace.revision}:${serializeAttentionReviewState(repaired)}`;
      if (migrationAttempted.current === repairKey) return;
      migrationAttempted.current = repairKey;
      migrationInFlight.current = true;
      void sendMutation({ type: "attention.update", state: repaired }).then(
        () => {
          migrationInFlight.current = false;
        },
      );
      return;
    }
    const importedState = repairInvalidAttentionBaseline(state, observedAt);
    const serialized = serializeAttentionReviewState(importedState);
    const importKey = `import:${serialized}`;
    if (migrationAttempted.current === importKey) return;
    migrationAttempted.current = importKey;
    migrationInFlight.current = true;
    void sendMutation(
      {
        type: "attention.import",
        state: importedState,
        importedAt: observedAt,
      },
      contentMutationId(serialized),
    ).then((result) => {
      migrationInFlight.current = false;
      if (!result.ok) return;
      try {
        window.localStorage.removeItem(ATTENTION_REVIEW_STORAGE_KEY);
        window.localStorage.removeItem(ATTENTION_REVIEW_LEGACY_STORAGE_KEY);
      } catch {
        // Persistence already succeeded. Cleanup can be retried on a later load.
      }
    });
  }, [ready, sendMutation, workspace, writePersistent]);

  return {
    workspace,
    ready,
    persistent: writePersistent,
    recovery,
    recoveryAcknowledged,
    error,
    refresh,
    acknowledgeRecovery,
    mutate: sendMutation,
    replaceAttentionReview,
    updateAttentionEvent,
  };
}
