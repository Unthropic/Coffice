import { execFile } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  AvailableRepositoryEvidence,
  RepositoryChangeArea,
  RepositoryDiffStats,
  RepositoryEvidence,
} from "./domain";

export const REPOSITORY_CHANGE_PATH_LIMIT = 200;
const MAX_BRANCH_LENGTH = 96;
const GIT_TIMEOUT_MS = 2_000;
const GIT_MAX_BUFFER_BYTES = 512 * 1024;
const MAX_TRACKED_ATTRIBUTE_PATHS = 8_192;
const MAX_TRACKED_ATTRIBUTE_BYTES = 192 * 1024;
const MAX_REPOSITORY_METADATA_FILE_BYTES = 64 * 1024;
const MAX_HEAD_FILE_BYTES = 4 * 1024;
const TEMPORARY_GIT_PREFIX = "coffice-git-evidence-";
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

const CHANGE_AREA_ORDER: readonly RepositoryChangeArea[] = [
  "Source",
  "Tests",
  "Docs",
  "Config",
  "Assets",
  "Other",
];

const SAFE_GIT_ENVIRONMENT_KEYS = [
  "PATH",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "ComSpec",
  "PATHEXT",
] as const;

export interface GitCommandOptions {
  encoding: "utf8";
  timeout: number;
  windowsHide: true;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
  input?: string;
}

export type GitCommandRunner = (
  arguments_: readonly string[],
  options: GitCommandOptions,
) => Promise<{ stdout: string }>;

function environmentValue(
  source: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const exact = source[key];
  if (typeof exact === "string") return exact;
  const normalizedKey = key.toLowerCase();
  const matchedKey = Object.keys(source).find(
    (candidate) => candidate.toLowerCase() === normalizedKey,
  );
  const value = matchedKey ? source[matchedKey] : undefined;
  return typeof value === "string" ? value : undefined;
}

export function buildGitEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv {
  const sourceNodeEnv = environmentValue(source, "NODE_ENV");
  const nodeEnv =
    sourceNodeEnv === "development" ||
    sourceNodeEnv === "test" ||
    sourceNodeEnv === "production"
      ? sourceNodeEnv
      : "production";
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: nodeEnv,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: NULL_DEVICE,
    GIT_CONFIG_COUNT: "0",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_LITERAL_PATHSPECS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_PAGER: "cat",
    PAGER: "cat",
    LC_ALL: "C",
    LANG: "C",
  };
  for (const key of SAFE_GIT_ENVIRONMENT_KEYS) {
    const value = environmentValue(source, key);
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}

const SAFE_GIT_CONFIG_ARGUMENTS = [
  "--no-optional-locks",
  "-c",
  "core.quotepath=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "color.ui=false",
  "-c",
  "diff.external=",
  "-c",
  "diff.renames=false",
  "-c",
  "status.renames=false",
  "-c",
  "status.relativePaths=true",
  "-c",
  "submodule.recurse=false",
  "-c",
  "status.submoduleSummary=false",
  "-c",
  `core.attributesFile=${NULL_DEVICE}`,
  "-c",
  `core.excludesFile=${NULL_DEVICE}`,
  "-c",
  `diff.orderFile=${NULL_DEVICE}`,
] as const;

const GIT_COMPARISON_CONFIG_VARIANTS = [
  "core.autocrlf=true",
  `core.filemode=${process.platform === "win32" ? "true" : "false"}`,
  `core.symlinks=${process.platform === "win32" ? "true" : "false"}`,
  `core.ignorecase=${process.platform === "win32" ? "false" : "true"}`,
] as const;

function comparisonConfigArguments(overrides: readonly string[]): string[] {
  return overrides.flatMap((override) => ["-c", override]);
}

export function buildGitStatusArguments(
  rootPath: string,
  comparisonOverrides: readonly string[] = [],
): string[] {
  return [
    ...SAFE_GIT_CONFIG_ARGUMENTS,
    ...comparisonConfigArguments(comparisonOverrides),
    "-C",
    rootPath,
    "status",
    "--porcelain=v2",
    "--branch",
    "--untracked-files=all",
    "--ignore-submodules=all",
    "--no-renames",
    "-z",
    "--",
    ".",
  ];
}

export function buildGitDiffArguments(
  rootPath: string,
  comparisonOverrides: readonly string[] = [],
): string[] {
  return [
    ...SAFE_GIT_CONFIG_ARGUMENTS,
    ...comparisonConfigArguments(comparisonOverrides),
    "-C",
    rootPath,
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--ignore-submodules=all",
    "--numstat",
    "-z",
    "HEAD",
    "--",
    ".",
  ];
}

export function buildGitMetadataArguments(rootPath: string): string[] {
  return [
    ...SAFE_GIT_CONFIG_ARGUMENTS,
    "-C",
    rootPath,
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--absolute-git-dir",
    "--git-common-dir",
    "--git-path",
    "index",
    "--git-path",
    "objects",
    "--git-path",
    "info/attributes",
    "--git-path",
    "info/exclude",
    "--show-object-format",
    "HEAD",
  ];
}

function buildGitUnbornMetadataArguments(rootPath: string): string[] {
  return [
    ...SAFE_GIT_CONFIG_ARGUMENTS,
    "-C",
    rootPath,
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--absolute-git-dir",
    "--git-common-dir",
    "--git-path",
    "index",
    "--git-path",
    "objects",
    "--git-path",
    "info/attributes",
    "--git-path",
    "info/exclude",
    "--show-object-format",
  ];
}

function buildGitLocalConfigAuditArguments(rootPath: string): string[] {
  return [
    ...SAFE_GIT_CONFIG_ARGUMENTS,
    "-C",
    rootPath,
    "config",
    "--local",
    "--no-includes",
    "--name-only",
    "--null",
    "--get-regexp",
    "^(include\\.path|includeif\\..*\\.path|filter\\..*\\.(clean|process)|extensions\\.worktreeconfig)$",
  ];
}

function buildGitTrackedPathsArguments(rootPath: string): string[] {
  return [
    ...SAFE_GIT_CONFIG_ARGUMENTS,
    "-C",
    rootPath,
    "ls-files",
    "--cached",
    "-z",
    "--",
    ".",
  ];
}

function buildGitFilterAttributeArguments(rootPath: string): string[] {
  return [
    ...SAFE_GIT_CONFIG_ARGUMENTS,
    "-C",
    rootPath,
    "check-attr",
    "--stdin",
    "-z",
    "filter",
  ];
}

function buildGitDivergenceArguments(
  rootPath: string,
  reference: string,
): string[] {
  return [
    ...SAFE_GIT_CONFIG_ARGUMENTS,
    "-C",
    rootPath,
    "for-each-ref",
    "--format=%(upstream:track)",
    "--count=1",
    "--",
    reference,
  ];
}

function buildGitHeadOidArguments(rootPath: string): string[] {
  return [
    ...SAFE_GIT_CONFIG_ARGUMENTS,
    "-C",
    rootPath,
    "rev-parse",
    "--verify",
    "HEAD",
  ];
}

function splitPorcelainRecords(input: string): string[] {
  return input.includes("\0") ? input.split("\0") : input.split(/\r?\n/);
}

function contentAfterSpaces(record: string, separatorCount: number): string {
  let offset = 0;
  for (let index = 0; index < separatorCount; index += 1) {
    const separator = record.indexOf(" ", offset);
    if (separator < 0) return "";
    offset = separator + 1;
  }
  return record.slice(offset);
}

function sanitizeBranch(value: string): string {
  const branch = value
    .replace(/[\u0000-\u001f\u007f]/g, "-")
    .replace(/\p{Cf}/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_BRANCH_LENGTH);
  return branch || "unknown";
}

function validHeadReference(reference: string): boolean {
  if (!reference.startsWith("refs/heads/") || /\p{Cf}/u.test(reference)) {
    return false;
  }
  if (
    reference.length > 1_024 ||
    reference.endsWith("/") ||
    reference.endsWith(".") ||
    reference.includes("..") ||
    reference.includes("@{") ||
    /[\u0000-\u0020\u007f~^:?*[\\]/.test(reference)
  ) {
    return false;
  }
  return reference
    .split("/")
    .every(
      (component) =>
        component.length > 0 &&
        !component.startsWith(".") &&
        !component.endsWith(".lock"),
    );
}

function safeCount(value: string): number {
  if (!/^\d+$/.test(value)) return 0;
  return Math.min(Number(value), Number.MAX_SAFE_INTEGER);
}

function addSafe(left: number, right: number): number {
  return Math.min(left + right, Number.MAX_SAFE_INTEGER);
}

function classifyChangePath(filePath: string): RepositoryChangeArea {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const lower = normalized.toLowerCase();
  const segments = lower.split("/");
  const basename = segments.at(-1) ?? "";

  if (
    segments.some((segment) =>
      ["test", "tests", "__tests__", "spec", "specs"].includes(segment),
    ) ||
    /(?:^|\.)((?:test)|(?:spec))\.[^.]+$/.test(basename)
  ) {
    return "Tests";
  }
  if (
    segments[0] === "docs" ||
    /^(?:readme|changelog|contributing|license)(?:\.|$)/.test(basename) ||
    /\.(?:md|mdx|rst|adoc)$/.test(basename)
  ) {
    return "Docs";
  }
  if (
    ["assets", "public", "static", "images", "fonts", "icons"].some(
      (directory) => segments.includes(directory),
    ) ||
    /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|mp[34]|wav|ogg)$/.test(
      basename,
    )
  ) {
    return "Assets";
  }
  if (
    [".github", ".vscode", ".devcontainer", "config", "configs"].some(
      (directory) => segments.includes(directory),
    ) ||
    basename.startsWith(".") ||
    /^(?:package(?:-lock)?|pnpm-lock|yarn\.lock|bun\.lockb?|tsconfig(?:\..+)?|jsconfig(?:\..+)?|vite\.config|next\.config|vitest\.config|eslint\.config|prettier\.config|dockerfile)(?:\.|$)/.test(
      basename,
    ) ||
    /\.(?:json|ya?ml|toml|ini|lock)$/.test(basename)
  ) {
    return "Config";
  }
  if (
    [
      "src",
      "app",
      "lib",
      "server",
      "client",
      "components",
      "packages",
      "scripts",
    ].some((directory) => segments.includes(directory)) ||
    /\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|sh|ps1|css|scss|sass|less|html|vue|svelte)$/.test(
      basename,
    )
  ) {
    return "Source";
  }
  return "Other";
}

interface StatusAccumulator {
  branch?: string;
  headOid?: string | null;
  headState?: "commit" | "unborn";
  ahead: number;
  behind: number;
  changedFiles: number;
  stagedFiles: number;
  untrackedFiles: number;
  conflictedFiles: number;
  summarizedFiles: number;
  areaCounts: Map<RepositoryChangeArea, number>;
}

function observeChangedPath(
  accumulator: StatusAccumulator,
  filePath: string,
): void {
  accumulator.changedFiles += 1;
  if (accumulator.summarizedFiles >= REPOSITORY_CHANGE_PATH_LIMIT) return;
  const area = classifyChangePath(filePath);
  accumulator.areaCounts.set(area, (accumulator.areaCounts.get(area) ?? 0) + 1);
  accumulator.summarizedFiles += 1;
}

export function parseGitStatusV2(
  input: string,
  observedAt: string,
): AvailableRepositoryEvidence | undefined {
  const accumulator: StatusAccumulator = {
    ahead: 0,
    behind: 0,
    changedFiles: 0,
    stagedFiles: 0,
    untrackedFiles: 0,
    conflictedFiles: 0,
    summarizedFiles: 0,
    areaCounts: new Map(),
  };
  const records = splitPorcelainRecords(input);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.startsWith("# branch.oid ")) {
      const oid = record.slice("# branch.oid ".length).trim();
      if (oid === "(initial)") {
        accumulator.headOid = null;
        accumulator.headState = "unborn";
      } else if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(oid)) {
        accumulator.headOid = oid.toLowerCase();
        accumulator.headState = "commit";
      }
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      const observedBranch = record.slice("# branch.head ".length).trim();
      accumulator.branch =
        observedBranch === "(detached)"
          ? "detached"
          : sanitizeBranch(observedBranch);
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (match) {
        accumulator.ahead = safeCount(match[1]);
        accumulator.behind = safeCount(match[2]);
      }
      continue;
    }
    if (record.startsWith("? ")) {
      observeChangedPath(accumulator, record.slice(2));
      accumulator.untrackedFiles += 1;
      continue;
    }
    if (record.startsWith("u ")) {
      observeChangedPath(accumulator, contentAfterSpaces(record, 10));
      accumulator.conflictedFiles += 1;
      continue;
    }
    if (record.startsWith("1 ") || record.startsWith("2 ")) {
      const isRenameOrCopy = record.startsWith("2 ");
      const filePath = contentAfterSpaces(record, isRenameOrCopy ? 9 : 8);
      observeChangedPath(accumulator, filePath);
      const status = record.slice(2, 4);
      if (status[0] && status[0] !== ".") accumulator.stagedFiles += 1;
      if (isRenameOrCopy && input.includes("\0")) index += 1;
    }
  }

  if (
    accumulator.branch === undefined ||
    accumulator.headState === undefined ||
    accumulator.headOid === undefined
  ) {
    return undefined;
  }

  return {
    availability: "available",
    branch: accumulator.branch,
    headOid: accumulator.headOid,
    headState: accumulator.headState,
    changedFiles: accumulator.changedFiles,
    stagedFiles: accumulator.stagedFiles,
    untrackedFiles: accumulator.untrackedFiles,
    conflictedFiles: accumulator.conflictedFiles,
    ahead: accumulator.ahead,
    behind: accumulator.behind,
    clean: accumulator.changedFiles === 0,
    changeAreas: {
      totalFiles: accumulator.changedFiles,
      summarizedFiles: accumulator.summarizedFiles,
      omittedFiles: accumulator.changedFiles - accumulator.summarizedFiles,
      areas: CHANGE_AREA_ORDER.flatMap((area) => {
        const files = accumulator.areaCounts.get(area) ?? 0;
        return files > 0 ? [{ area, files }] : [];
      }),
    },
    source: "git:status-porcelain-v2",
    observedAt,
  };
}

export function parseGitDiffNumstat(
  input: string,
): RepositoryDiffStats | undefined {
  let trackedFiles = 0;
  let additions = 0;
  let deletions = 0;
  let binaryFiles = 0;

  for (const record of splitPorcelainRecords(input)) {
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab <= 0 || secondTab <= firstTab) return undefined;
    const added = record.slice(0, firstTab);
    const deleted = record.slice(firstTab + 1, secondTab);
    if (added === "-" && deleted === "-") {
      binaryFiles += 1;
    } else if (/^\d+$/.test(added) && /^\d+$/.test(deleted)) {
      additions = addSafe(additions, safeCount(added));
      deletions = addSafe(deletions, safeCount(deleted));
    } else {
      return undefined;
    }
    trackedFiles += 1;
  }

  return {
    trackedFiles,
    additions,
    deletions,
    binaryFiles,
    source: "git:diff-numstat",
  };
}

const runGit: GitCommandRunner = async (arguments_, options) =>
  await new Promise((resolve, reject) => {
    const { input, ...execOptions } = options;
    const child = execFile(
      "git",
      [...arguments_],
      execOptions,
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout });
      },
    );
    if (input !== undefined && child.stdin) {
      child.stdin.on("error", () => {
        // The child callback owns the command verdict if Git closes stdin.
      });
      child.stdin.end(input, "utf8");
    }
  });

function commandOptions(
  environment: NodeJS.ProcessEnv = buildGitEnvironment(),
  input?: string,
): GitCommandOptions {
  return {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    env: environment,
    ...(input === undefined ? {} : { input }),
  };
}

interface RepositoryMetadata {
  workTree: string;
  gitDirectory: string;
  commonDirectory: string;
  indexPath: string;
  objectDirectory: string;
  infoAttributesPath: string;
  infoExcludePath: string;
  objectFormat: "sha1" | "sha256";
  headOid: string | null;
}

interface RepositorySandbox {
  directory: string;
  environment: NodeJS.ProcessEnv;
  branch: string;
  headOid: string | null;
  headState: "commit" | "unborn";
  headReference?: string;
  headContent: string;
  metadata: RepositoryMetadata;
}

function stripFinalLineEnding(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

function parseRepositoryMetadata(
  input: string,
): RepositoryMetadata | undefined {
  const lines = stripFinalLineEnding(input).split(/\r?\n/);
  if (lines.length !== 8 && lines.length !== 9) return undefined;
  const [
    workTree,
    gitDirectory,
    commonDirectory,
    indexPath,
    objectDirectory,
    infoAttributesPath,
    infoExcludePath,
  ] = lines;
  const objectFormat = lines[7];
  const headOid = lines[8] ?? null;
  if (
    ![
      workTree,
      gitDirectory,
      commonDirectory,
      indexPath,
      objectDirectory,
      infoAttributesPath,
      infoExcludePath,
    ].every((value) => path.isAbsolute(value)) ||
    (objectFormat !== "sha1" && objectFormat !== "sha256") ||
    (headOid !== null &&
      !(objectFormat === "sha256"
        ? /^[0-9a-f]{64}$/i.test(headOid)
        : /^[0-9a-f]{40}$/i.test(headOid)))
  ) {
    return undefined;
  }
  return {
    workTree,
    gitDirectory,
    commonDirectory,
    indexPath,
    objectDirectory,
    infoAttributesPath,
    infoExcludePath,
    objectFormat,
    headOid: headOid?.toLowerCase() ?? null,
  };
}

function isInsideDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function safeRepositoryConfig(objectFormat: "sha1" | "sha256"): string {
  const repositoryVersion = objectFormat === "sha256" ? 1 : 0;
  return [
    "[core]",
    `\trepositoryformatversion = ${repositoryVersion}`,
    "\tbare = false",
    `\tfilemode = ${process.platform === "win32" ? "false" : "true"}`,
    `\tsymlinks = ${process.platform === "win32" ? "false" : "true"}`,
    `\tignorecase = ${process.platform === "win32" ? "true" : "false"}`,
    "\tautocrlf = false",
    ...(objectFormat === "sha256"
      ? ["[extensions]", "\tobjectFormat = sha256"]
      : []),
    "",
  ].join("\n");
}

type FileStats = Awaited<ReturnType<typeof fs.lstat>>;

function metadataOpenFlags(): number {
  return (
    fsConstants.O_RDONLY |
    (fsConstants.O_NOFOLLOW ?? 0) |
    (fsConstants.O_NONBLOCK ?? 0)
  );
}

function sameFileIdentity(left: FileStats, right: FileStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFileState(left: FileStats, right: FileStats): boolean {
  return (
    sameFileIdentity(left, right) &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function boundedRegularFile(stats: FileStats, maximumBytes: number): boolean {
  return (
    !stats.isSymbolicLink() &&
    stats.isFile() &&
    stats.size >= 0 &&
    stats.size <= maximumBytes
  );
}

async function readStableBoundedRegularFile(
  filePath: string,
  maximumBytes: number,
): Promise<Buffer> {
  const pathBefore = await fs.lstat(filePath);
  if (!boundedRegularFile(pathBefore, maximumBytes)) {
    throw new Error("Repository metadata is not a bounded regular file.");
  }

  // O_NOFOLLOW and O_NONBLOCK close the final-component symlink and FIFO races
  // on platforms that expose them. Windows does not currently expose either
  // flag in Node, so the handle identity/type check still occurs before reads.
  const handle = await fs.open(filePath, metadataOpenFlags());
  try {
    const handleBefore = await handle.stat();
    if (
      !boundedRegularFile(handleBefore, maximumBytes) ||
      !sameStableFileState(pathBefore, handleBefore)
    ) {
      throw new Error("Repository metadata changed while it was opened.");
    }

    const buffer = Buffer.alloc(handleBefore.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }

    const [handleAfter, pathAfter] = await Promise.all([
      handle.stat(),
      fs.lstat(filePath),
    ]);
    if (
      bytesRead !== handleBefore.size ||
      !sameStableFileState(handleBefore, handleAfter) ||
      !sameStableFileState(handleAfter, pathAfter)
    ) {
      throw new Error("Repository metadata changed while it was read.");
    }
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readBoundedHead(gitDirectory: string): Promise<string> {
  const buffer = await readStableBoundedRegularFile(
    path.join(gitDirectory, "HEAD"),
    MAX_HEAD_FILE_BYTES,
  );
  const content = buffer.toString("utf8");
  const head = stripFinalLineEnding(content);
  if (
    !head ||
    content.includes("\ufffd") ||
    content.includes("\0") ||
    /[\r\n]/.test(head)
  ) {
    throw new Error("Repository HEAD is not one valid UTF-8 line.");
  }
  return head;
}

async function resolvedParentMatches(
  filePath: string,
  expectedParent: string,
): Promise<boolean> {
  const resolvedParent = await fs.realpath(path.dirname(filePath));
  return resolvedParent === path.resolve(expectedParent);
}

async function validateRepositoryMetadataPaths(
  metadata: RepositoryMetadata,
): Promise<void> {
  const [realGitDirectory, realCommonDirectory] = await Promise.all([
    fs.realpath(metadata.gitDirectory),
    fs.realpath(metadata.commonDirectory),
  ]);
  const linkedWorktreeRoot = path.join(realCommonDirectory, "worktrees");
  if (
    realGitDirectory !== realCommonDirectory &&
    !isInsideDirectory(realGitDirectory, linkedWorktreeRoot)
  ) {
    throw new Error("Repository Git directory escapes its common directory.");
  }

  const expectedAttributes = path.join(
    metadata.commonDirectory,
    "info",
    "attributes",
  );
  const expectedExclude = path.join(
    metadata.commonDirectory,
    "info",
    "exclude",
  );
  if (
    path.resolve(metadata.infoAttributesPath) !==
      path.resolve(expectedAttributes) ||
    path.resolve(metadata.infoExcludePath) !== path.resolve(expectedExclude) ||
    !(await resolvedParentMatches(
      metadata.infoAttributesPath,
      path.join(realCommonDirectory, "info"),
    )) ||
    !(await resolvedParentMatches(
      metadata.infoExcludePath,
      path.join(realCommonDirectory, "info"),
    )) ||
    !(await resolvedParentMatches(
      path.join(metadata.gitDirectory, "HEAD"),
      realGitDirectory,
    ))
  ) {
    throw new Error(
      "Repository metadata path escapes its authoritative directory.",
    );
  }
}

async function resolveRepositoryHead(
  metadata: RepositoryMetadata,
  rootPath: string,
  runner: GitCommandRunner,
): Promise<
  Pick<
    RepositorySandbox,
    "branch" | "headOid" | "headState" | "headReference" | "headContent"
  >
> {
  await validateRepositoryMetadataPaths(metadata);
  const oidPattern =
    metadata.objectFormat === "sha256" ? /^[0-9a-f]{64}$/i : /^[0-9a-f]{40}$/i;
  const head = await readBoundedHead(metadata.gitDirectory);
  const reference = head.startsWith("ref: ") ? head.slice(5) : undefined;

  let observedOid: string | null = null;
  try {
    observedOid = stripFinalLineEnding(
      (await runner(buildGitHeadOidArguments(rootPath), commandOptions()))
        .stdout,
    ).toLowerCase();
  } catch {
    observedOid = null;
  }
  const confirmedHead = await readBoundedHead(metadata.gitDirectory);
  await validateRepositoryMetadataPaths(metadata);
  if (confirmedHead !== head || observedOid !== metadata.headOid) {
    throw new Error("Repository HEAD changed while it was observed.");
  }

  if (reference && validHeadReference(reference)) {
    const branch = sanitizeBranch(reference.slice("refs/heads/".length));
    if (!metadata.headOid) {
      return {
        branch,
        headOid: null,
        headState: "unborn",
        headReference: reference,
        headContent: head,
      };
    }
    if (!oidPattern.test(metadata.headOid)) {
      throw new Error("Invalid repository head.");
    }
    return {
      branch,
      headOid: metadata.headOid,
      headState: "commit",
      headReference: reference,
      headContent: head,
    };
  }

  if (
    !metadata.headOid ||
    !oidPattern.test(head) ||
    head.toLowerCase() !== metadata.headOid
  ) {
    throw new Error("Invalid detached head.");
  }
  return {
    branch: "detached",
    headOid: metadata.headOid,
    headState: "commit",
    headContent: head,
  };
}

function sameHeadObservation(
  left: Pick<
    RepositorySandbox,
    "branch" | "headOid" | "headState" | "headReference" | "headContent"
  >,
  right: Pick<
    RepositorySandbox,
    "branch" | "headOid" | "headState" | "headReference" | "headContent"
  >,
): boolean {
  return (
    left.branch === right.branch &&
    left.headOid === right.headOid &&
    left.headState === right.headState &&
    left.headReference === right.headReference &&
    left.headContent === right.headContent
  );
}

function parseGitDivergence(
  input: string,
): { ahead: number; behind: number } | undefined {
  const value = stripFinalLineEnding(input).trim();
  if (!value) return { ahead: 0, behind: 0 };
  if (!/^\[(?:ahead \d+|behind \d+|ahead \d+, behind \d+)\]$/.test(value)) {
    return undefined;
  }
  return {
    ahead: safeCount(/(?:\[|, )ahead (\d+)/.exec(value)?.[1] ?? "0"),
    behind: safeCount(/(?:\[|, )behind (\d+)/.exec(value)?.[1] ?? "0"),
  };
}

async function readGitDivergence(
  rootPath: string,
  reference: string | undefined,
  runner: GitCommandRunner,
): Promise<{ ahead: number; behind: number } | undefined> {
  if (!reference) return { ahead: 0, behind: 0 };
  try {
    const { stdout } = await runner(
      buildGitDivergenceArguments(rootPath, reference),
      commandOptions(),
    );
    return parseGitDivergence(stdout);
  } catch {
    return undefined;
  }
}

function isNoConfigMatch(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === 1
  );
}

async function repositoryLocalConfigurationIsSafe(
  rootPath: string,
  runner: GitCommandRunner,
): Promise<boolean> {
  try {
    await runner(buildGitLocalConfigAuditArguments(rootPath), commandOptions());
    // Any matching name is a hazard. Values are never requested or returned.
    return false;
  } catch (error) {
    return isNoConfigMatch(error);
  }
}

function parseTrackedPathInput(
  input: string,
): { input: string; count: number } | undefined {
  const bytes = Buffer.byteLength(input, "utf8");
  if (
    bytes > MAX_TRACKED_ATTRIBUTE_BYTES ||
    input.includes("\ufffd") ||
    (!input.endsWith("\0") && input !== "")
  ) {
    return undefined;
  }
  const paths = input === "" ? [] : input.slice(0, -1).split("\0");
  if (paths.length > MAX_TRACKED_ATTRIBUTE_PATHS) return undefined;
  for (const filePath of paths) {
    const segments = filePath.replaceAll("\\", "/").split("/");
    if (
      !filePath ||
      path.isAbsolute(filePath) ||
      /^[a-z]:[\\/]/i.test(filePath) ||
      segments.includes("..")
    ) {
      return undefined;
    }
  }
  return { input, count: paths.length };
}

function filterAttributeOutputIsSafe(
  input: string,
  pathCount: number,
): boolean {
  if (input.includes("\ufffd") || (!input.endsWith("\0") && input !== "")) {
    return false;
  }
  const fields = input === "" ? [] : input.slice(0, -1).split("\0");
  if (fields.length !== pathCount * 3) return false;
  for (let index = 0; index < fields.length; index += 3) {
    if (
      fields[index + 1] !== "filter" ||
      (fields[index + 2] !== "unspecified" && fields[index + 2] !== "unset")
    ) {
      return false;
    }
  }
  return true;
}

async function repositoryTrackedPathsHaveNoFilter(
  rootPath: string,
  environment: NodeJS.ProcessEnv,
  runner: GitCommandRunner,
): Promise<boolean> {
  try {
    const tracked = parseTrackedPathInput(
      (
        await runner(
          buildGitTrackedPathsArguments(rootPath),
          commandOptions(environment),
        )
      ).stdout,
    );
    if (!tracked) return false;
    if (tracked.count === 0) return true;
    const { stdout } = await runner(
      buildGitFilterAttributeArguments(rootPath),
      commandOptions(environment, tracked.input),
    );
    return filterAttributeOutputIsSafe(stdout, tracked.count);
  } catch {
    return false;
  }
}

async function gitOutputIsComparisonInvariant(
  rootPath: string,
  baseline: string,
  buildArguments: (
    rootPath: string,
    comparisonOverrides?: readonly string[],
  ) => string[],
  environment: NodeJS.ProcessEnv,
  runner: GitCommandRunner,
): Promise<boolean> {
  try {
    for (const override of GIT_COMPARISON_CONFIG_VARIANTS) {
      const { stdout } = await runner(
        buildArguments(rootPath, [override]),
        commandOptions(environment),
      );
      if (stdout !== baseline) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function repositoryMetadataFileIsInactive(
  filePath: string,
): Promise<boolean> {
  try {
    const buffer = await readStableBoundedRegularFile(
      filePath,
      MAX_REPOSITORY_METADATA_FILE_BYTES,
    );
    const content = buffer.toString("utf8");
    if (content.includes("\ufffd") || content.includes("\0")) return false;
    return content
      .replace(/^\ufeff/, "")
      .split(/\r?\n/)
      .every((line) => /^\s*(?:#.*)?$/.test(line));
  } catch (error) {
    const missing =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT";
    return missing;
  }
}

async function prepareRepositorySandbox(
  rootPath: string,
  runner: GitCommandRunner,
): Promise<RepositorySandbox> {
  let metadata: RepositoryMetadata | undefined;
  try {
    metadata = parseRepositoryMetadata(
      (await runner(buildGitMetadataArguments(rootPath), commandOptions()))
        .stdout,
    );
  } catch {
    metadata = parseRepositoryMetadata(
      (
        await runner(
          buildGitUnbornMetadataArguments(rootPath),
          commandOptions(),
        )
      ).stdout,
    );
  }
  if (!metadata) throw new Error("Repository metadata is unavailable.");

  await validateRepositoryMetadataPaths(metadata);

  const [realRoot, realWorkTree] = await Promise.all([
    fs.realpath(rootPath),
    fs.realpath(metadata.workTree),
  ]);
  if (!isInsideDirectory(realRoot, realWorkTree)) {
    throw new Error("The saved root is outside the repository worktree.");
  }

  if (
    !(await repositoryMetadataFileIsInactive(metadata.infoAttributesPath)) ||
    !(await repositoryMetadataFileIsInactive(metadata.infoExcludePath))
  ) {
    throw new Error(
      "Repository-local attribute or exclude metadata is active.",
    );
  }
  await validateRepositoryMetadataPaths(metadata);

  const head = await resolveRepositoryHead(metadata, rootPath, runner);
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), TEMPORARY_GIT_PREFIX),
  );
  try {
    await Promise.all([
      fs.mkdir(path.join(directory, "objects"), { recursive: true }),
      fs.mkdir(path.join(directory, "refs", "heads"), { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(
        path.join(directory, "config"),
        safeRepositoryConfig(metadata.objectFormat),
        "utf8",
      ),
      fs.writeFile(
        path.join(directory, "HEAD"),
        head.headState === "commit"
          ? `${head.headOid}\n`
          : "ref: refs/heads/coffice-unborn\n",
        "utf8",
      ),
    ]);

    return {
      directory,
      environment: {
        ...buildGitEnvironment(),
        GIT_DIR: directory,
        GIT_WORK_TREE: metadata.workTree,
        // Status and diff are read-only, and optional index refreshes are
        // disabled. Referencing the original index avoids persisting its exact
        // path table in a temporary copy if Coffice is interrupted.
        GIT_INDEX_FILE: metadata.indexPath,
        GIT_OBJECT_DIRECTORY: metadata.objectDirectory,
      },
      ...head,
      metadata,
    };
  } catch (error) {
    await removeRepositorySandbox(directory);
    throw error;
  }
}

async function removeRepositorySandbox(directory: string): Promise<void> {
  const resolvedDirectory = path.resolve(directory);
  const resolvedTemporaryRoot = path.resolve(os.tmpdir());
  if (
    path.dirname(resolvedDirectory) !== resolvedTemporaryRoot ||
    !path.basename(resolvedDirectory).startsWith(TEMPORARY_GIT_PREFIX)
  ) {
    return;
  }
  await fs.rm(resolvedDirectory, {
    recursive: true,
    force: true,
    maxRetries: 2,
  });
}

export async function readRepositoryEvidence(
  rootPath: string,
  observedAt = new Date().toISOString(),
  runner: GitCommandRunner = runGit,
): Promise<RepositoryEvidence> {
  if (!(await repositoryLocalConfigurationIsSafe(rootPath, runner))) {
    return {
      availability: "unavailable",
      source: "git",
      observedAt,
    };
  }

  let sandbox: RepositorySandbox;
  try {
    sandbox = await prepareRepositorySandbox(rootPath, runner);
  } catch {
    return {
      availability: "unavailable",
      source: "git",
      observedAt,
    };
  }

  try {
    if (
      !(await repositoryTrackedPathsHaveNoFilter(
        rootPath,
        sandbox.environment,
        runner,
      ))
    ) {
      return {
        availability: "unavailable",
        source: "git",
        observedAt,
      };
    }

    const [statusResult, divergenceResult] = await Promise.allSettled([
      runner(
        buildGitStatusArguments(rootPath),
        commandOptions(sandbox.environment),
      ),
      readGitDivergence(rootPath, sandbox.headReference, runner),
    ]);
    let evidence =
      statusResult.status === "fulfilled"
        ? parseGitStatusV2(statusResult.value.stdout, observedAt)
        : undefined;
    const divergence =
      divergenceResult.status === "fulfilled"
        ? divergenceResult.value
        : undefined;
    if (
      !evidence ||
      !divergence ||
      statusResult.status !== "fulfilled" ||
      !(await gitOutputIsComparisonInvariant(
        rootPath,
        statusResult.value.stdout,
        buildGitStatusArguments,
        sandbox.environment,
        runner,
      ))
    ) {
      return {
        availability: "unavailable",
        source: "git",
        observedAt,
      };
    }

    if (
      evidence.headState !== sandbox.headState ||
      evidence.headOid !== sandbox.headOid
    ) {
      return {
        availability: "unavailable",
        source: "git",
        observedAt,
      };
    }
    evidence = {
      ...evidence,
      branch: sandbox.branch,
      ahead: divergence.ahead,
      behind: divergence.behind,
    };

    if (evidence.headState === "commit") {
      try {
        const { stdout } = await runner(
          buildGitDiffArguments(rootPath),
          commandOptions(sandbox.environment),
        );
        const diffStats = parseGitDiffNumstat(stdout);
        if (
          diffStats &&
          (await gitOutputIsComparisonInvariant(
            rootPath,
            stdout,
            buildGitDiffArguments,
            sandbox.environment,
            runner,
          ))
        ) {
          evidence = { ...evidence, diffStats };
        }
      } catch {
        // Status is independently useful. A bounded diff failure must not hide
        // the authoritative branch and working-tree summary.
      }
    }

    let finalHead:
      | Pick<
          RepositorySandbox,
          "branch" | "headOid" | "headState" | "headReference" | "headContent"
        >
      | undefined;
    try {
      finalHead = await resolveRepositoryHead(
        sandbox.metadata,
        rootPath,
        runner,
      );
    } catch {
      finalHead = undefined;
    }
    if (!finalHead || !sameHeadObservation(sandbox, finalHead)) {
      return {
        availability: "unavailable",
        source: "git",
        observedAt,
      };
    }

    return evidence;
  } finally {
    try {
      await removeRepositorySandbox(sandbox.directory);
    } catch {
      // The evidence remains valid if best-effort temporary cleanup fails.
    }
  }
}
