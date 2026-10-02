"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  CodexResultKey,
  VerificationFailureKind,
  VerificationState,
  VerificationTarget,
} from "../lib/coffice-workspace";

const ACTIVE_STATES = new Set<VerificationState>(["queued", "running"]);
const POLL_INTERVAL_MS = 1_500;
const DEGRADED_POLL_INTERVAL_MS = 10_000;
const CONFIRM_RUN = "CONFIRM_VERIFICATION";
const CONFIRM_CANCEL = "CONFIRM_CANCEL_VERIFICATION";

type StructuralRecord = Record<string, unknown>;

export interface VerificationProfileView {
  id: string;
  version: string;
  label: string;
  description: string;
  eligible: boolean;
}

export interface VerificationCheckView {
  id: string;
  version: string;
  state: VerificationState;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  failureKind?: VerificationFailureKind;
  exitCode?: number;
}

export interface VerificationReceiptView {
  id: string;
  target: VerificationTarget;
  profile: { id: string; version: string };
  checks: VerificationCheckView[];
  state: VerificationState;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface VerificationOperationView {
  receiptId: string;
  state: "running" | "cancelling";
}

export type VerificationActionResult =
  | { ok: true; receipt: VerificationReceiptView; replayed: boolean }
  | { ok: false; reason: "unavailable" | "rejected" | "confirmation_lost" };

export interface VerificationsController {
  ready: boolean;
  available: boolean;
  degraded: boolean;
  profiles: readonly VerificationProfileView[];
  receipts: readonly VerificationReceiptView[];
  operations: readonly VerificationOperationView[];
  busyReceiptId: string | null;
  receiptForTarget: (
    target: VerificationTarget,
  ) => VerificationReceiptView | null;
  run: (
    target: VerificationTarget,
    profile: Pick<VerificationProfileView, "id" | "version">,
  ) => Promise<VerificationActionResult>;
  cancel: (receiptId: string) => Promise<VerificationActionResult>;
  refresh: () => Promise<void>;
}

const EMPTY_PROFILES: readonly VerificationProfileView[] = [];
const EMPTY_RECEIPTS: readonly VerificationReceiptView[] = [];
const EMPTY_OPERATIONS: readonly VerificationOperationView[] = [];

function record(value: unknown): StructuralRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as StructuralRecord)
    : null;
}

function exactKeys(
  value: StructuralRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function boundedText(value: unknown, max = 320): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

function timestamp(value: unknown): string | null {
  const text = boundedText(value, 64);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function decodeResultKey(value: unknown): CodexResultKey | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["kind", "id"])) return null;
  const id = boundedText(source.id);
  if (
    (source.kind !== "turn" &&
      source.kind !== "operation" &&
      source.kind !== "revision") ||
    !id
  ) {
    return null;
  }
  return { kind: source.kind, id };
}

function decodeTarget(value: unknown): VerificationTarget | null {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, [
      "projectId",
      "objectiveId",
      "workItemId",
      "attemptId",
      "resultKey",
    ])
  ) {
    return null;
  }
  const projectId = boundedText(source.projectId);
  const objectiveId = boundedText(source.objectiveId);
  const workItemId = boundedText(source.workItemId);
  const attemptId = boundedText(source.attemptId);
  const resultKey = decodeResultKey(source.resultKey);
  return projectId && objectiveId && workItemId && attemptId && resultKey
    ? { projectId, objectiveId, workItemId, attemptId, resultKey }
    : null;
}

function decodeState(value: unknown): VerificationState | null {
  return value === "queued" ||
    value === "running" ||
    value === "passed" ||
    value === "failed" ||
    value === "unknown"
    ? value
    : null;
}

function decodeReference(
  value: unknown,
): { id: string; version: string } | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["id", "version"])) return null;
  const id = boundedText(source.id, 160);
  const version = boundedText(source.version, 80);
  return id && version ? { id, version } : null;
}

function decodeCheck(value: unknown): VerificationCheckView | null {
  const source = record(value);
  if (
    !source ||
    !exactKeys(
      source,
      ["id", "version", "state", "queuedAt"],
      ["startedAt", "completedAt", "failureKind", "exitCode"],
    )
  ) {
    return null;
  }
  const reference = decodeReference({ id: source.id, version: source.version });
  const state = decodeState(source.state);
  const queuedAt = timestamp(source.queuedAt);
  const startedAt =
    source.startedAt === undefined ? undefined : timestamp(source.startedAt);
  const completedAt =
    source.completedAt === undefined
      ? undefined
      : timestamp(source.completedAt);
  const failureKind =
    source.failureKind === undefined
      ? undefined
      : source.failureKind === "exit" ||
          source.failureKind === "timeout" ||
          source.failureKind === "launch"
        ? source.failureKind
        : null;
  const exitCode = source.exitCode;
  if (
    !reference ||
    !state ||
    !queuedAt ||
    startedAt === null ||
    completedAt === null ||
    failureKind === null ||
    (exitCode !== undefined &&
      (!Number.isInteger(exitCode) ||
        (exitCode as number) < -2_147_483_648 ||
        (exitCode as number) > 2_147_483_647))
  ) {
    return null;
  }
  return {
    ...reference,
    state,
    queuedAt,
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(failureKind ? { failureKind } : {}),
    ...(exitCode !== undefined ? { exitCode: exitCode as number } : {}),
  };
}

function decodeReceipt(value: unknown): VerificationReceiptView | null {
  const source = record(value);
  if (
    !source ||
    !exactKeys(
      source,
      ["id", "target", "profile", "checks", "state", "queuedAt"],
      ["startedAt", "completedAt"],
    )
  ) {
    return null;
  }
  const id = boundedText(source.id, 160);
  const target = decodeTarget(source.target);
  const profile = decodeReference(source.profile);
  const state = decodeState(source.state);
  const queuedAt = timestamp(source.queuedAt);
  const startedAt =
    source.startedAt === undefined ? undefined : timestamp(source.startedAt);
  const completedAt =
    source.completedAt === undefined
      ? undefined
      : timestamp(source.completedAt);
  const checks = Array.isArray(source.checks)
    ? source.checks.map(decodeCheck)
    : null;
  if (
    !id ||
    !target ||
    !profile ||
    !state ||
    !queuedAt ||
    startedAt === null ||
    completedAt === null ||
    !checks ||
    checks.length === 0 ||
    checks.length > 64 ||
    checks.some((check) => check === null)
  ) {
    return null;
  }
  return {
    id,
    target,
    profile,
    checks: checks as VerificationCheckView[],
    state,
    queuedAt,
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

function decodeProfile(value: unknown): VerificationProfileView | null {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["id", "version", "label", "description", "eligible"])
  ) {
    return null;
  }
  const reference = decodeReference({ id: source.id, version: source.version });
  const label = boundedText(source.label, 160);
  const description = boundedText(source.description, 500);
  return reference &&
    label &&
    description &&
    typeof source.eligible === "boolean"
    ? { ...reference, label, description, eligible: source.eligible }
    : null;
}

function decodeOperation(value: unknown): VerificationOperationView | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["receiptId", "state"])) return null;
  const receiptId = boundedText(source.receiptId, 160);
  return receiptId &&
    (source.state === "running" || source.state === "cancelling")
    ? { receiptId, state: source.state }
    : null;
}

function decodeSnapshot(value: unknown): {
  profiles: VerificationProfileView[];
  receipts: VerificationReceiptView[];
  operations: VerificationOperationView[];
} | null {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["profiles", "receipts", "operations"]) ||
    !Array.isArray(source.profiles) ||
    !Array.isArray(source.receipts) ||
    !Array.isArray(source.operations)
  ) {
    return null;
  }
  const profiles = source.profiles.map(decodeProfile);
  const receipts = source.receipts.map(decodeReceipt);
  const operations = source.operations.map(decodeOperation);
  return profiles.some((item) => item === null) ||
    receipts.some((item) => item === null) ||
    operations.some((item) => item === null)
    ? null
    : {
        profiles: profiles as VerificationProfileView[],
        receipts: receipts as VerificationReceiptView[],
        operations: operations as VerificationOperationView[],
      };
}

function sameTarget(
  left: VerificationTarget,
  right: VerificationTarget,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.objectiveId === right.objectiveId &&
    left.workItemId === right.workItemId &&
    left.attemptId === right.attemptId &&
    left.resultKey.kind === right.resultKey.kind &&
    left.resultKey.id === right.resultKey.id
  );
}

function receiptFingerprint(
  receipts: readonly VerificationReceiptView[],
): string {
  return receipts
    .map((receipt) =>
      [
        receipt.id,
        receipt.state,
        receipt.startedAt ?? "",
        receipt.completedAt ?? "",
        ...receipt.checks.map((check) => `${check.id}:${check.state}`),
      ].join("|"),
    )
    .join("\n");
}

function localId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useVerifications(
  projectId: string | null,
  onReceiptChanged?: () => void | Promise<void>,
): VerificationsController {
  const [profiles, setProfiles] = useState<VerificationProfileView[]>([]);
  const [receipts, setReceipts] = useState<VerificationReceiptView[]>([]);
  const [operations, setOperations] = useState<VerificationOperationView[]>([]);
  const [acceptedProjectId, setAcceptedProjectId] = useState<string | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [busyState, setBusyState] = useState<{
    generation: number;
    projectId: string | null;
    receiptId: string;
  } | null>(null);
  const receiptFingerprintRef = useRef<string | null>(null);
  const degradedRef = useRef(false);
  const acceptedProjectIdRef = useRef<string | null>(null);
  const projectGenerationRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const onReceiptChangedRef = useRef(onReceiptChanged);
  useEffect(() => {
    onReceiptChangedRef.current = onReceiptChanged;
  }, [onReceiptChanged]);

  const updateDegraded = useCallback((value: boolean) => {
    degradedRef.current = value;
    setDegraded(value);
  }, []);

  const acceptSnapshot = useCallback(
    (snapshot: ReturnType<typeof decodeSnapshot>, acceptedId: string) => {
      if (!snapshot) return false;
      const nextFingerprint = receiptFingerprint(snapshot.receipts);
      const previousFingerprint = receiptFingerprintRef.current;
      receiptFingerprintRef.current = nextFingerprint;
      setProfiles(snapshot.profiles);
      setReceipts(snapshot.receipts);
      setOperations(snapshot.operations);
      acceptedProjectIdRef.current = acceptedId;
      setAcceptedProjectId(acceptedId);
      setReady(true);
      updateDegraded(false);
      if (
        (previousFingerprint === null && snapshot.receipts.length > 0) ||
        (previousFingerprint !== null &&
          previousFingerprint !== nextFingerprint)
      ) {
        void onReceiptChangedRef.current?.();
      }
      return true;
    },
    [updateDegraded],
  );

  const acceptDegradedRead = useCallback(
    (acceptedId: string) => {
      if (acceptedProjectIdRef.current !== acceptedId) {
        receiptFingerprintRef.current = null;
        setProfiles([]);
        setReceipts([]);
        setOperations([]);
      }
      acceptedProjectIdRef.current = acceptedId;
      setAcceptedProjectId(acceptedId);
      setReady(true);
      updateDegraded(true);
    },
    [updateDegraded],
  );

  const refresh = useCallback(async () => {
    const generation = projectGenerationRef.current;
    if (!projectId) {
      receiptFingerprintRef.current = null;
      setProfiles([]);
      setReceipts([]);
      setOperations([]);
      acceptedProjectIdRef.current = null;
      setAcceptedProjectId(null);
      setReady(true);
      updateDegraded(false);
      return;
    }
    const abort = new AbortController();
    refreshAbortRef.current?.abort();
    refreshAbortRef.current = abort;
    try {
      const response = await fetch(
        `/api/verifications?projectId=${encodeURIComponent(projectId)}`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: abort.signal,
        },
      );
      const body: unknown = await response.json();
      if (abort.signal.aborted || generation !== projectGenerationRef.current) {
        return;
      }
      if (!response.ok || !acceptSnapshot(decodeSnapshot(body), projectId)) {
        acceptDegradedRead(projectId);
      }
    } catch (error) {
      if (
        abort.signal.aborted ||
        generation !== projectGenerationRef.current ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      acceptDegradedRead(projectId);
    } finally {
      if (refreshAbortRef.current === abort) refreshAbortRef.current = null;
    }
  }, [acceptDegradedRead, acceptSnapshot, projectId, updateDegraded]);

  useEffect(() => {
    projectGenerationRef.current += 1;
    refreshAbortRef.current?.abort();
    receiptFingerprintRef.current = null;
    degradedRef.current = false;
    acceptedProjectIdRef.current = null;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      refreshAbortRef.current?.abort();
    };
  }, [projectId, refresh]);

  const currentProjectAccepted = acceptedProjectId === projectId;
  const currentProfiles = currentProjectAccepted ? profiles : EMPTY_PROFILES;
  const currentReceipts = currentProjectAccepted ? receipts : EMPTY_RECEIPTS;
  const currentOperations = currentProjectAccepted
    ? operations
    : EMPTY_OPERATIONS;
  const hasActive =
    currentOperations.length > 0 ||
    currentReceipts.some((receipt) => ACTIVE_STATES.has(receipt.state));
  useEffect(() => {
    if (!projectId || (!hasActive && !degraded)) return;
    let cancelled = false;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(
        async () => {
          await refresh();
          if (!cancelled) schedule();
        },
        degraded ? DEGRADED_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
      );
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [degraded, hasActive, projectId, refresh]);

  const post = useCallback(
    async (
      body: StructuralRecord,
      receiptId: string | null,
      action: "run" | "cancel",
      expected?: {
        target: VerificationTarget;
        profile: Pick<VerificationProfileView, "id" | "version">;
      },
    ): Promise<VerificationActionResult> => {
      const generation = projectGenerationRef.current;
      setBusyState({
        generation,
        projectId,
        receiptId: receiptId ?? "starting",
      });
      const markConfirmationLost = () => {
        if (generation !== projectGenerationRef.current) return;
        updateDegraded(true);
        void onReceiptChangedRef.current?.();
      };
      try {
        const response = await fetch("/api/verifications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        });
        const raw: unknown = await response.json();
        if (generation !== projectGenerationRef.current) {
          void onReceiptChangedRef.current?.();
          return { ok: false, reason: "confirmation_lost" };
        }
        const source = record(raw);
        if (!response.ok) {
          if (response.status >= 500) {
            markConfirmationLost();
            return { ok: false, reason: "confirmation_lost" };
          }
          return { ok: false, reason: "rejected" };
        }
        if (
          !source ||
          !exactKeys(source, ["receipt", "replayed"], ["operation"]) ||
          typeof source.replayed !== "boolean"
        ) {
          markConfirmationLost();
          return { ok: false, reason: "confirmation_lost" };
        }
        const receipt = decodeReceipt(source.receipt);
        const operation =
          source.operation === undefined
            ? null
            : decodeOperation(source.operation);
        if (!receipt || (source.operation !== undefined && !operation)) {
          markConfirmationLost();
          return { ok: false, reason: "confirmation_lost" };
        }
        if (
          (action === "run" &&
            (!expected ||
              !sameTarget(receipt.target, expected.target) ||
              receipt.profile.id !== expected.profile.id ||
              receipt.profile.version !== expected.profile.version)) ||
          (action === "cancel" && receipt.id !== receiptId) ||
          (operation && operation.receiptId !== receipt.id)
        ) {
          markConfirmationLost();
          return { ok: false, reason: "confirmation_lost" };
        }
        setReceipts((current) => {
          const next = current.filter((item) => item.id !== receipt.id);
          next.push(receipt);
          receiptFingerprintRef.current = receiptFingerprint(next);
          return next;
        });
        if (operation) {
          setOperations((current) => [
            ...current.filter((item) => item.receiptId !== operation.receiptId),
            operation,
          ]);
        }
        updateDegraded(false);
        void onReceiptChangedRef.current?.();
        return { ok: true, receipt, replayed: source.replayed };
      } catch {
        if (generation === projectGenerationRef.current) {
          markConfirmationLost();
        }
        return { ok: false, reason: "confirmation_lost" };
      } finally {
        setBusyState((current) =>
          current?.generation === generation ? null : current,
        );
      }
    },
    [projectId, updateDegraded],
  );

  const run = useCallback(
    (
      target: VerificationTarget,
      profile: Pick<VerificationProfileView, "id" | "version">,
    ) => {
      if (
        !projectId ||
        target.projectId !== projectId ||
        acceptedProjectIdRef.current !== projectId ||
        degradedRef.current
      ) {
        return Promise.resolve({
          ok: false as const,
          reason: "unavailable" as const,
        });
      }
      return post(
        {
          action: "run",
          profileId: profile.id,
          profileVersion: profile.version,
          projectId: target.projectId,
          objectiveId: target.objectiveId,
          workItemId: target.workItemId,
          attemptId: target.attemptId,
          resultKey: target.resultKey,
          idempotencyKey: `verification-${localId()}`,
          confirmed: true,
          confirmationToken: CONFIRM_RUN,
        },
        null,
        "run",
        { target, profile },
      );
    },
    [post, projectId],
  );

  const cancel = useCallback(
    (receiptId: string) =>
      post(
        {
          action: "cancel",
          receiptId,
          confirmed: true,
          confirmationToken: CONFIRM_CANCEL,
        },
        receiptId,
        "cancel",
      ),
    [post],
  );

  const receiptForTarget = useCallback(
    (target: VerificationTarget) => {
      for (let index = currentReceipts.length - 1; index >= 0; index -= 1) {
        const receipt = currentReceipts[index];
        if (sameTarget(receipt.target, target)) return receipt;
      }
      return null;
    },
    [currentReceipts],
  );

  const busyReceiptId =
    busyState?.projectId === projectId ? busyState.receiptId : null;

  return useMemo(
    () => ({
      ready: projectId === null || (currentProjectAccepted && ready),
      available: Boolean(
        projectId && currentProfiles.some((profile) => profile.eligible),
      ),
      degraded: currentProjectAccepted && degraded,
      profiles: currentProfiles,
      receipts: currentReceipts,
      operations: currentOperations,
      busyReceiptId,
      receiptForTarget,
      run,
      cancel,
      refresh,
    }),
    [
      busyReceiptId,
      cancel,
      currentOperations,
      currentProfiles,
      currentProjectAccepted,
      currentReceipts,
      degraded,
      projectId,
      ready,
      receiptForTarget,
      refresh,
      run,
    ],
  );
}
