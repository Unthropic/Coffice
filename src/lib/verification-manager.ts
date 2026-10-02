import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { readCodexSource, type CodexSourceSnapshot } from "./codex-source";
import {
  type CofficeWorkspace,
  type CodexResultKey,
  type VerificationCheckTransition,
  type VerificationReceipt,
  type VerificationStartRequest,
  type VerificationTarget,
} from "./coffice-workspace";
import {
  CofficeVerificationCapacityError,
  CofficeVerificationIdempotencyError,
  CofficeWorkspaceStore,
  type LoadedCofficeWorkspace,
} from "./coffice-workspace-store";
import {
  getVerificationAppServerExecutor,
  listVerificationProfiles,
  type VerificationAppServerExecutor,
  type VerificationExecutionProgress,
  type VerificationExecutionResult,
  type VerificationProfile,
  type VerificationProfileId,
} from "./verification-execution";

const MAX_PUBLIC_RECEIPTS = 128;

const PROFILE_DESCRIPTIONS: Readonly<Record<VerificationProfileId, string>> = {
  test: "Run the project's automated tests.",
  typecheck: "Check the project's types.",
  lint: "Check the project's code quality rules.",
  build: "Create a production build.",
};

export type VerificationManagerErrorCode =
  | "INVALID_REQUEST"
  | "IDEMPOTENCY_CONFLICT"
  | "TARGET_NOT_FOUND"
  | "TARGET_STALE"
  | "PROJECT_UNAVAILABLE"
  | "ROOT_BUSY"
  | "RECEIPT_NOT_ACTIVE"
  | "CAPACITY"
  | "UNAVAILABLE";

export class VerificationManagerError extends Error {
  constructor(readonly code: VerificationManagerErrorCode) {
    super(code);
    this.name = "VerificationManagerError";
  }
}

export interface VerificationRunRequest {
  profileId: VerificationProfileId;
  profileVersion: string;
  idempotencyKey: string;
  target: VerificationTarget;
}

export interface PublicVerificationProfile {
  id: VerificationProfileId;
  version: string;
  label: string;
  description: string;
  eligible: boolean;
}

export interface PublicVerificationReceipt {
  id: string;
  target: VerificationTarget;
  profile: VerificationReceipt["profile"];
  checks: VerificationReceipt["checks"];
  state: VerificationReceipt["state"];
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PublicVerificationOperation {
  receiptId: string;
  state: "running" | "cancelling";
}

export interface VerificationManagerSnapshot {
  profiles: PublicVerificationProfile[];
  receipts: PublicVerificationReceipt[];
  operations: PublicVerificationOperation[];
}

export interface VerificationManagerRunResult {
  receipt: PublicVerificationReceipt;
  operation?: PublicVerificationOperation;
  replayed: boolean;
}

interface VerificationWorkspaceStore {
  load(): Promise<LoadedCofficeWorkspace>;
  startVerification(
    request: VerificationStartRequest,
  ): Promise<LoadedCofficeWorkspace>;
  transitionVerification(
    receiptId: string,
    transition: VerificationCheckTransition,
  ): Promise<LoadedCofficeWorkspace>;
  reconcileActiveVerifications(): Promise<LoadedCofficeWorkspace>;
}

interface VerificationExecutor {
  isRootBlocked(root: string): boolean;
  execute(
    request: Parameters<VerificationAppServerExecutor["execute"]>[0],
  ): Promise<VerificationExecutionResult>;
}

interface ActiveVerification {
  receiptId: string;
  rootKey: string;
  controller: AbortController;
  state: "running" | "cancelling";
  persistence: Promise<void>;
  completion: Promise<void>;
  persistenceFailed: boolean;
}

export interface VerificationManagerOptions {
  store?: VerificationWorkspaceStore;
  executor?: VerificationExecutor;
  readSource?: () => Promise<CodexSourceSnapshot>;
  idFactory?: () => string;
}

function sameResultKey(left: CodexResultKey, right: CodexResultKey): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function sameTarget(left: VerificationTarget, right: VerificationTarget) {
  return (
    left.projectId === right.projectId &&
    left.objectiveId === right.objectiveId &&
    left.workItemId === right.workItemId &&
    left.attemptId === right.attemptId &&
    sameResultKey(left.resultKey, right.resultKey)
  );
}

function matchesRequest(
  receipt: VerificationReceipt,
  request: VerificationRunRequest,
): boolean {
  return (
    receipt.profile.id === request.profileId &&
    receipt.profile.version === request.profileVersion &&
    receipt.checks.length === 1 &&
    receipt.checks[0].id === request.profileId &&
    receipt.checks[0].version === request.profileVersion &&
    sameTarget(receipt.target, request.target)
  );
}

function findExactResult(
  workspace: CofficeWorkspace,
  target: VerificationTarget,
): "current" | "stale" | "missing" {
  const projects = workspace.projects.filter(
    (project) => project.id === target.projectId,
  );
  if (projects.length !== 1) return "missing";
  const objectives = projects[0].objectives.filter(
    (objective) => objective.id === target.objectiveId,
  );
  if (objectives.length !== 1) return "missing";
  const workItems = objectives[0].workItems.filter(
    (workItem) => workItem.id === target.workItemId,
  );
  if (workItems.length !== 1) return "missing";
  const attempts = workItems[0].attempts.filter(
    (attempt) => attempt.id === target.attemptId,
  );
  if (attempts.length !== 1) return "missing";
  const results = attempts[0].resultCycles;
  const matches = results.filter((result) =>
    sameResultKey(result.key, target.resultKey),
  );
  if (matches.length !== 1) return "missing";
  const newest = results.at(-1);
  return newest && sameResultKey(newest.key, target.resultKey)
    ? "current"
    : "stale";
}

function canonicalRoot(root: string): { root: string; key: string } {
  if (!isAbsolute(root))
    throw new VerificationManagerError("PROJECT_UNAVAILABLE");
  const normalized = resolve(root);
  return {
    root: normalized,
    key: process.platform === "win32" ? normalized.toLowerCase() : normalized,
  };
}

function publicProfile(
  profile: VerificationProfile,
): PublicVerificationProfile {
  return {
    id: profile.id,
    version: profile.version,
    label: profile.label,
    description: PROFILE_DESCRIPTIONS[profile.id],
    eligible: profile.eligible,
  };
}

export function publicVerificationReceipt(
  receipt: VerificationReceipt,
): PublicVerificationReceipt {
  return {
    id: receipt.id,
    target: {
      ...receipt.target,
      resultKey: { ...receipt.target.resultKey },
    },
    profile: { ...receipt.profile },
    checks: receipt.checks.map((check) => ({ ...check })),
    state: receipt.state,
    queuedAt: receipt.queuedAt,
    ...(receipt.startedAt ? { startedAt: receipt.startedAt } : {}),
    ...(receipt.completedAt ? { completedAt: receipt.completedAt } : {}),
  };
}

function publicOperation(
  active: ActiveVerification | undefined,
): PublicVerificationOperation | undefined {
  return active
    ? { receiptId: active.receiptId, state: active.state }
    : undefined;
}

function resultTransition(
  result: VerificationExecutionResult,
  check: { id: string; version: string },
): VerificationCheckTransition {
  if (
    result.state === "completed" &&
    result.exitCode === 0 &&
    result.reason === undefined
  ) {
    return { check, state: "passed" };
  }
  if (result.state === "failed") {
    if (
      result.reason === "exit_nonzero" &&
      Number.isInteger(result.exitCode) &&
      result.exitCode !== 0 &&
      (result.exitCode as number) >= -2_147_483_648 &&
      (result.exitCode as number) <= 2_147_483_647
    ) {
      return {
        check,
        state: "failed",
        failureKind: "exit",
        exitCode: result.exitCode,
      };
    }
    if (result.reason === "deadline") {
      return { check, state: "failed", failureKind: "timeout" };
    }
    if (result.reason === "launch_failed") {
      return { check, state: "failed", failureKind: "launch" };
    }
  }
  return { check, state: "unknown" };
}

function progressTransition(
  progress: VerificationExecutionProgress,
): VerificationCheckTransition | undefined {
  const check = { id: progress.checkId, version: progress.checkVersion };
  if (progress.state === "queued") return undefined;
  if (progress.state === "running") return { check, state: "running" };
  if (progress.state === "passed") return { check, state: "passed" };
  if (progress.state === "unknown") return { check, state: "unknown" };
  if (progress.failureKind === "exit" && progress.exitCode !== undefined) {
    return {
      check,
      state: "failed",
      failureKind: "exit",
      exitCode: progress.exitCode,
    };
  }
  if (progress.failureKind === "timeout") {
    return { check, state: "failed", failureKind: "timeout" };
  }
  if (progress.failureKind === "launch") {
    return { check, state: "failed", failureKind: "launch" };
  }
  return { check, state: "unknown" };
}

export class VerificationManager {
  private readonly store: VerificationWorkspaceStore;
  private readonly executor: VerificationExecutor;
  private readonly readSource: () => Promise<CodexSourceSnapshot>;
  private readonly idFactory: () => string;
  private initialized: Promise<void> | undefined;
  private admissionTail: Promise<void> = Promise.resolve();
  private readonly activeByReceipt = new Map<string, ActiveVerification>();
  private readonly receiptByRoot = new Map<string, string>();

  constructor(options: VerificationManagerOptions = {}) {
    this.store = options.store ?? new CofficeWorkspaceStore();
    this.executor = options.executor ?? getVerificationAppServerExecutor();
    this.readSource =
      options.readSource ??
      (async () => await readCodexSource({ deferSessionMetadata: true }));
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async snapshot(projectId?: string): Promise<VerificationManagerSnapshot> {
    await this.ensureInitialized();
    const loaded = await this.store.load();
    let profiles = listVerificationProfiles("").map(publicProfile);
    if (projectId) {
      try {
        const source = await this.readSource();
        const matches = source.projects.filter(
          (project) => project.id === projectId,
        );
        if (matches.length === 1) {
          const root = canonicalRoot(matches[0].rootPath);
          const blocked =
            this.receiptByRoot.has(root.key) ||
            this.executor.isRootBlocked(root.root);
          profiles = listVerificationProfiles(root.root).map((profile) =>
            publicProfile({
              ...profile,
              eligible: profile.eligible && !blocked,
            }),
          );
        }
      } catch {
        // Availability is expressed structurally; private source errors stay local.
      }
    }
    const receipts = loaded.workspace.verificationReceipts
      .filter((receipt) => !projectId || receipt.target.projectId === projectId)
      .slice(-MAX_PUBLIC_RECEIPTS)
      .map(publicVerificationReceipt);
    const admitted = new Set(receipts.map((receipt) => receipt.id));
    const operations = [...this.activeByReceipt.values()]
      .filter((active) => admitted.has(active.receiptId))
      .map((active) => publicOperation(active)!);
    return { profiles, receipts, operations };
  }

  async run(
    request: VerificationRunRequest,
  ): Promise<VerificationManagerRunResult> {
    await this.ensureInitialized();
    return await this.withAdmissionLock(async () => {
      const loaded = await this.store.load();
      const replay = loaded.workspace.verificationReceipts.find(
        (receipt) => receipt.idempotencyKey === request.idempotencyKey,
      );
      if (replay) {
        if (!matchesRequest(replay, request)) {
          throw new VerificationManagerError("IDEMPOTENCY_CONFLICT");
        }
        return this.runProjection(replay, true);
      }

      const targetState = findExactResult(loaded.workspace, request.target);
      if (targetState === "missing") {
        throw new VerificationManagerError("TARGET_NOT_FOUND");
      }
      if (targetState === "stale") {
        throw new VerificationManagerError("TARGET_STALE");
      }

      let source: CodexSourceSnapshot;
      try {
        source = await this.readSource();
      } catch {
        throw new VerificationManagerError("PROJECT_UNAVAILABLE");
      }
      const projects = source.projects.filter(
        (project) => project.id === request.target.projectId,
      );
      if (projects.length !== 1) {
        throw new VerificationManagerError("PROJECT_UNAVAILABLE");
      }
      const root = canonicalRoot(projects[0].rootPath);
      const profile = listVerificationProfiles(root.root).find(
        (candidate) => candidate.id === request.profileId,
      );
      if (!profile?.eligible) {
        throw new VerificationManagerError("PROJECT_UNAVAILABLE");
      }
      if (profile.version !== request.profileVersion) {
        throw new VerificationManagerError("INVALID_REQUEST");
      }
      if (
        this.receiptByRoot.has(root.key) ||
        this.executor.isRootBlocked(root.root)
      ) {
        throw new VerificationManagerError("ROOT_BUSY");
      }

      const candidateId = this.idFactory();
      let started: LoadedCofficeWorkspace;
      try {
        started = await this.store.startVerification({
          id: candidateId,
          idempotencyKey: request.idempotencyKey,
          target: request.target,
          profile: { id: profile.id, version: profile.version },
          checks: [{ id: profile.id, version: profile.version }],
        });
      } catch (error) {
        if (error instanceof CofficeVerificationIdempotencyError) {
          throw new VerificationManagerError("IDEMPOTENCY_CONFLICT");
        }
        if (error instanceof CofficeVerificationCapacityError) {
          throw new VerificationManagerError("CAPACITY");
        }
        throw error;
      }
      const receipt = started.workspace.verificationReceipts.find(
        (item) => item.idempotencyKey === request.idempotencyKey,
      );
      if (!receipt) throw new VerificationManagerError("UNAVAILABLE");
      if (!matchesRequest(receipt, request)) {
        throw new VerificationManagerError("IDEMPOTENCY_CONFLICT");
      }
      if (receipt.id !== candidateId) return this.runProjection(receipt, true);

      const controller = new AbortController();
      const active: ActiveVerification = {
        receiptId: receipt.id,
        rootKey: root.key,
        controller,
        state: "running",
        persistence: Promise.resolve(),
        completion: Promise.resolve(),
        persistenceFailed: false,
      };
      this.activeByReceipt.set(receipt.id, active);
      this.receiptByRoot.set(root.key, receipt.id);
      active.completion = this.performExecution(
        active,
        root.root,
        profile.id,
        profile.version,
        request.idempotencyKey,
      );
      void active.completion.catch(() => undefined);
      return this.runProjection(receipt, false);
    });
  }

  async cancel(receiptId: string): Promise<VerificationManagerRunResult> {
    await this.ensureInitialized();
    const active = await this.withAdmissionLock(async () => {
      const current = this.activeByReceipt.get(receiptId);
      if (!current) {
        throw new VerificationManagerError("RECEIPT_NOT_ACTIVE");
      }
      current.state = "cancelling";
      current.controller.abort();
      return current;
    });
    await active.completion;
    const loaded = await this.store.load();
    const receipt = loaded.workspace.verificationReceipts.find(
      (candidate) => candidate.id === receiptId,
    );
    if (!receipt) throw new VerificationManagerError("UNAVAILABLE");
    return { receipt: publicVerificationReceipt(receipt), replayed: false };
  }

  private async ensureInitialized(): Promise<void> {
    this.initialized ??= this.store
      .reconcileActiveVerifications()
      .then(() => undefined);
    await this.initialized;
  }

  private runProjection(
    receipt: VerificationReceipt,
    replayed: boolean,
  ): VerificationManagerRunResult {
    const operation = publicOperation(this.activeByReceipt.get(receipt.id));
    return {
      receipt: publicVerificationReceipt(receipt),
      ...(operation ? { operation } : {}),
      replayed,
    };
  }

  private enqueueTransition(
    active: ActiveVerification,
    transition: VerificationCheckTransition,
  ): void {
    const prior = active.persistence.catch(() => undefined);
    active.persistence = prior.then(async () => {
      try {
        await this.persistTransition(active, transition);
        active.persistenceFailed = false;
      } catch {
        active.persistenceFailed = true;
        throw new VerificationManagerError("UNAVAILABLE");
      }
    });
    // Progress observers cannot await persistence. Handle the promise now while
    // preserving its rejection for the final authoritative write to recover.
    void active.persistence.catch(() => undefined);
  }

  private async persistTransition(
    active: ActiveVerification,
    transition: VerificationCheckTransition,
  ): Promise<void> {
    const loaded = await this.store.load();
    const receipt = loaded.workspace.verificationReceipts.find(
      (candidate) => candidate.id === active.receiptId,
    );
    const check = receipt?.checks.find(
      (candidate) =>
        candidate.id === transition.check.id &&
        candidate.version === transition.check.version,
    );
    if (!check) throw new VerificationManagerError("UNAVAILABLE");
    if (
      check.state === "passed" ||
      check.state === "failed" ||
      check.state === "unknown"
    ) {
      const matches =
        check.state === transition.state &&
        check.failureKind === transition.failureKind &&
        check.exitCode === transition.exitCode;
      if (!matches) throw new VerificationManagerError("UNAVAILABLE");
      return;
    }
    if (transition.state === "passed" && check.state === "queued") {
      await this.store.transitionVerification(active.receiptId, {
        check: transition.check,
        state: "running",
      });
    }
    await this.store.transitionVerification(active.receiptId, transition);
  }

  private async performExecution(
    active: ActiveVerification,
    root: string,
    profileId: VerificationProfileId,
    profileVersion: string,
    idempotencyKey: string,
  ): Promise<void> {
    let result: VerificationExecutionResult | undefined;
    try {
      result = await this.executor.execute({
        root,
        profileId,
        idempotencyKey,
        signal: active.controller.signal,
        onProgress: (progress) => {
          const transition = progressTransition(progress);
          if (transition) this.enqueueTransition(active, transition);
        },
      });
    } catch {
      // A thrown transport/executor error has no authoritative command outcome.
    }
    await active.persistence.catch(() => undefined);
    const terminal =
      result &&
      result.profileId === profileId &&
      result.profileVersion === profileVersion
        ? resultTransition(result, { id: profileId, version: profileVersion })
        : ({
            check: { id: profileId, version: profileVersion },
            state: "unknown",
          } satisfies VerificationCheckTransition);
    this.enqueueTransition(active, terminal);
    await active.persistence.catch(() => undefined);
    if (active.persistenceFailed) {
      try {
        await this.persistTransition(active, terminal);
        active.persistenceFailed = false;
      } catch {
        // The final bounded recovery could not prove a durable terminal state.
      }
    }
    if (active.persistenceFailed) {
      // Keep the receipt and root visibly active. Releasing them would present
      // stale durable state as a finished operation and could admit a duplicate.
      throw new VerificationManagerError("UNAVAILABLE");
    }
    this.activeByReceipt.delete(active.receiptId);
    if (this.receiptByRoot.get(active.rootKey) === active.receiptId) {
      this.receiptByRoot.delete(active.rootKey);
    }
  }

  private async withAdmissionLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.admissionTail;
    let release!: () => void;
    this.admissionTail = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

declare global {
  var __cofficeVerificationManager: VerificationManager | undefined;
}

export function getVerificationManager(): VerificationManager {
  return (globalThis.__cofficeVerificationManager ??=
    new VerificationManager());
}
