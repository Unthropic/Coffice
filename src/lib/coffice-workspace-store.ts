import { constants } from "node:fs";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  createEmptyCofficeWorkspace,
  createVerificationReceipt,
  MAX_COFFICE_WORKSPACE_BYTES,
  parseCofficeWorkspace,
  parseSerializedCofficeWorkspace,
  parseVerificationStartRequest,
  reduceCofficeWorkspace,
  serializeCofficeWorkspace,
  serializeVerificationStartRequest,
  serializeWorkspaceMutation,
  transitionVerificationReceipt,
  type CofficeWorkspace,
  type VerificationCheckTransition,
  type VerificationReceipt,
  type VerificationStartRequest,
  type WorkspaceMutation,
} from "./coffice-workspace";

export const COFFICE_WORKSPACE_FILENAME = "workspace-v1.json";

export type WorkspaceRecovery =
  | { kind: "none" }
  | { kind: "created" }
  | { kind: "backup"; reason: "primary-corrupt" | "primary-missing" };

export interface LoadedCofficeWorkspace {
  workspace: CofficeWorkspace;
  recovery: WorkspaceRecovery;
}

export class CofficeWorkspaceConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`Workspace revision conflict: expected ${expected}, found ${actual}`);
    this.name = "CofficeWorkspaceConflictError";
  }
}

export class CofficeWorkspaceMutationIdError extends Error {
  constructor(mutationId: string) {
    super(`Mutation id ${mutationId} was already used for different content`);
    this.name = "CofficeWorkspaceMutationIdError";
  }
}

export class CofficeVerificationIdempotencyError extends Error {
  constructor(idempotencyKey: string) {
    super(
      `Verification idempotency key ${idempotencyKey} was already used for different content`,
    );
    this.name = "CofficeVerificationIdempotencyError";
  }
}

export class CofficeVerificationCapacityError extends Error {
  constructor() {
    super("Verification receipt capacity is occupied by active runs");
    this.name = "CofficeVerificationCapacityError";
  }
}

export class CofficeWorkspaceCorruptionError extends Error {
  readonly primaryError?: unknown;
  readonly backupError?: unknown;

  constructor(message: string, primaryError?: unknown, backupError?: unknown) {
    super(message);
    this.name = "CofficeWorkspaceCorruptionError";
    this.primaryError = primaryError;
    this.backupError = backupError;
  }
}

const MAX_VERIFICATION_RECEIPTS = 1_024;

function retainVerificationHistoryForInsert(
  receipts: VerificationReceipt[],
): VerificationReceipt[] {
  if (receipts.length < MAX_VERIFICATION_RECEIPTS) return receipts;
  const terminalPriority: Partial<
    Record<VerificationReceipt["state"], number>
  > = {
    passed: 0,
    unknown: 1,
    failed: 2,
  };
  const removable = receipts
    .filter((receipt) => terminalPriority[receipt.state] !== undefined)
    .sort((left, right) => {
      const priority =
        terminalPriority[left.state]! - terminalPriority[right.state]!;
      if (priority !== 0) return priority;
      const age = Date.parse(left.queuedAt) - Date.parse(right.queuedAt);
      return age !== 0 ? age : left.id.localeCompare(right.id);
    })[0];
  if (!removable) throw new CofficeVerificationCapacityError();
  return receipts.filter((receipt) => receipt.id !== removable.id);
}

export function defaultCofficeDataDirectory(
  platform = process.platform,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  home = os.homedir(),
): string {
  if (environment.COFFICE_DATA_DIR) return environment.COFFICE_DATA_DIR;
  if (platform === "win32") {
    return path.join(
      environment.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "Coffice",
    );
  }
  if (platform === "darwin")
    return path.join(home, "Library", "Application Support", "Coffice");
  return path.join(
    environment.XDG_DATA_HOME || path.join(home, ".local", "share"),
    "Coffice",
  );
}

const operationTails = new Map<string, Promise<void>>();

async function serialized<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = operationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  operationTails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (operationTails.get(key) === tail) operationTails.delete(key);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readValid(filePath: string): Promise<CofficeWorkspace> {
  const metadata = await stat(filePath);
  if (metadata.size > MAX_COFFICE_WORKSPACE_BYTES) {
    throw new CofficeWorkspaceCorruptionError(
      "Coffice workspace exceeds the maximum supported file size.",
    );
  }
  return parseSerializedCofficeWorkspace(await readFile(filePath, "utf8"));
}

async function syncDirectory(directory: string) {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is unavailable on some Windows filesystems. File fsync
    // and same-directory rename still provide the strongest portable path.
  }
}

async function atomicWrite(target: string, contents: string) {
  const directory = path.dirname(target);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
    try {
      await unlink(temporary);
    } catch {}
    throw error;
  }
}

export interface CofficeWorkspaceStoreOptions {
  directory?: string;
  now?: () => string;
}

export class CofficeWorkspaceStore {
  readonly directory: string;
  readonly primaryPath: string;
  readonly backupPath: string;
  private readonly now: () => string;

  constructor(options: CofficeWorkspaceStoreOptions = {}) {
    this.directory = path.resolve(
      /* turbopackIgnore: true */
      options.directory ?? defaultCofficeDataDirectory(),
    );
    this.primaryPath = path.join(this.directory, COFFICE_WORKSPACE_FILENAME);
    this.backupPath = `${this.primaryPath}.bak`;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  load(): Promise<LoadedCofficeWorkspace> {
    return serialized(this.primaryPath, () => this.loadUnlocked());
  }

  mutate(
    expectedRevision: number,
    mutationId: string,
    mutation: WorkspaceMutation,
  ): Promise<LoadedCofficeWorkspace> {
    return serialized(this.primaryPath, async () => {
      const loaded = await this.loadUnlocked();
      if (!mutationId || mutationId.length > 160) {
        throw new TypeError("mutationId must contain 1-160 characters");
      }
      const hash = createHash("sha256")
        .update(serializeWorkspaceMutation(mutation))
        .digest("hex");
      const receipt = loaded.workspace.mutationReceipts.find(
        (candidate) => candidate.id === mutationId,
      );
      if (receipt) {
        if (receipt.hash !== hash)
          throw new CofficeWorkspaceMutationIdError(mutationId);
        return loaded;
      }
      if (loaded.workspace.revision !== expectedRevision) {
        throw new CofficeWorkspaceConflictError(
          expectedRevision,
          loaded.workspace.revision,
        );
      }
      const appliedAt = this.now();
      const reduced = reduceCofficeWorkspace(
        loaded.workspace,
        mutation,
        appliedAt,
      );
      const next: CofficeWorkspace = {
        ...reduced,
        mutationReceipts: [
          ...reduced.mutationReceipts,
          { id: mutationId, hash, revision: reduced.revision, appliedAt },
        ].slice(-1_024),
      };
      await this.persistUnlocked(next, loaded.workspace);
      return { workspace: next, recovery: loaded.recovery };
    });
  }

  startVerification(
    request: VerificationStartRequest,
  ): Promise<LoadedCofficeWorkspace> {
    return serialized(this.primaryPath, async () => {
      const loaded = await this.loadUnlocked();
      const parsed = parseVerificationStartRequest(request);
      const hash = createHash("sha256")
        .update(serializeVerificationStartRequest(parsed))
        .digest("hex");
      const replay = loaded.workspace.verificationReceipts.find(
        (receipt) => receipt.idempotencyKey === parsed.idempotencyKey,
      );
      if (replay) {
        if (replay.requestHash !== hash) {
          throw new CofficeVerificationIdempotencyError(parsed.idempotencyKey);
        }
        return loaded;
      }
      if (
        loaded.workspace.verificationReceipts.some(
          (receipt) => receipt.id === parsed.id,
        )
      ) {
        throw new CofficeVerificationIdempotencyError(parsed.idempotencyKey);
      }
      const at = this.now();
      const retainedReceipts = retainVerificationHistoryForInsert(
        loaded.workspace.verificationReceipts,
      );
      const next = parseCofficeWorkspace({
        ...loaded.workspace,
        revision: loaded.workspace.revision + 1,
        updatedAt: at,
        verificationReceipts: [
          ...retainedReceipts,
          createVerificationReceipt(parsed, hash, at),
        ],
      });
      await this.persistUnlocked(next, loaded.workspace);
      return { workspace: next, recovery: loaded.recovery };
    });
  }

  transitionVerification(
    receiptId: string,
    transition: VerificationCheckTransition,
  ): Promise<LoadedCofficeWorkspace> {
    return serialized(this.primaryPath, async () => {
      const loaded = await this.loadUnlocked();
      const receipt = loaded.workspace.verificationReceipts.find(
        (candidate) => candidate.id === receiptId,
      );
      if (!receipt)
        throw new TypeError(`Unknown verification receipt ${receiptId}`);
      const at = this.now();
      const transitioned = transitionVerificationReceipt(
        receipt,
        transition,
        at,
      );
      if (transitioned === receipt) return loaded;
      const next = parseCofficeWorkspace({
        ...loaded.workspace,
        revision: loaded.workspace.revision + 1,
        updatedAt: at,
        verificationReceipts: loaded.workspace.verificationReceipts.map(
          (candidate) =>
            candidate.id === receiptId ? transitioned : candidate,
        ),
      });
      await this.persistUnlocked(next, loaded.workspace);
      return { workspace: next, recovery: loaded.recovery };
    });
  }

  reconcileActiveVerifications(): Promise<LoadedCofficeWorkspace> {
    return serialized(this.primaryPath, async () => {
      const loaded = await this.loadUnlocked();
      const active = loaded.workspace.verificationReceipts.filter(
        (receipt) => receipt.state === "queued" || receipt.state === "running",
      );
      if (active.length === 0) return loaded;
      const at = this.now();
      const activeIds = new Set(active.map((receipt) => receipt.id));
      const next = parseCofficeWorkspace({
        ...loaded.workspace,
        revision: loaded.workspace.revision + 1,
        updatedAt: at,
        verificationReceipts: loaded.workspace.verificationReceipts.map(
          (receipt) => {
            if (!activeIds.has(receipt.id)) return receipt;
            const check = receipt.checks.find(
              (candidate) =>
                candidate.state === "queued" || candidate.state === "running",
            )!;
            return transitionVerificationReceipt(
              receipt,
              {
                check: { id: check.id, version: check.version },
                state: "unknown",
              },
              at,
            );
          },
        ),
      });
      await this.persistUnlocked(next, loaded.workspace);
      return { workspace: next, recovery: loaded.recovery };
    });
  }

  private async loadUnlocked(): Promise<LoadedCofficeWorkspace> {
    await mkdir(this.directory, { recursive: true });
    const primaryExists = await exists(this.primaryPath);
    const backupExists = await exists(this.backupPath);
    if (!primaryExists && !backupExists) {
      const workspace = createEmptyCofficeWorkspace(this.now());
      await atomicWrite(this.primaryPath, serializeCofficeWorkspace(workspace));
      return { workspace, recovery: { kind: "created" } };
    }

    let primaryError: unknown;
    if (primaryExists) {
      try {
        return {
          workspace: await readValid(this.primaryPath),
          recovery: { kind: "none" },
        };
      } catch (error) {
        primaryError = error;
      }
    }

    let backupError: unknown;
    if (backupExists) {
      try {
        return {
          workspace: await readValid(this.backupPath),
          recovery: {
            kind: "backup",
            reason: primaryExists ? "primary-corrupt" : "primary-missing",
          },
        };
      } catch (error) {
        backupError = error;
      }
    }

    throw new CofficeWorkspaceCorruptionError(
      "No valid Coffice workspace copy is available; existing files were preserved.",
      primaryError,
      backupError,
    );
  }

  private async persistUnlocked(
    next: CofficeWorkspace,
    previous: CofficeWorkspace,
  ) {
    await mkdir(this.directory, { recursive: true });
    let primaryIsPrevious = false;
    try {
      const primary = await readValid(this.primaryPath);
      primaryIsPrevious = primary.revision === previous.revision;
    } catch {}
    if (primaryIsPrevious) {
      await atomicWrite(this.backupPath, serializeCofficeWorkspace(previous));
    } else if (!(await exists(this.backupPath))) {
      await atomicWrite(this.backupPath, serializeCofficeWorkspace(previous));
    }
    await atomicWrite(this.primaryPath, serializeCofficeWorkspace(next));
  }
}
