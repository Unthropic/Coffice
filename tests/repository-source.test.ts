import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  buildGitDiffArguments,
  buildGitEnvironment,
  buildGitStatusArguments,
  parseGitDiffNumstat,
  parseGitStatusV2,
  readRepositoryEvidence,
  REPOSITORY_CHANGE_PATH_LIMIT,
  type GitCommandRunner,
} from "../src/lib/repository-source";

const OBSERVED_AT = "2026-08-12T00:00:00.000Z";
const HEAD_OID = "0123456789abcdef0123456789abcdef01234567";
const execFileAsync = promisify(execFile);

async function git(root: string, ...arguments_: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_NO_LAZY_FETCH: "1",
    },
  });
  return stdout;
}

async function createRepository(): Promise<{
  base: string;
  root: string;
  cleanup: () => Promise<void>;
}> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "coffice-repo-test-"));
  const root = path.join(base, "repository");
  await fs.mkdir(root);
  await git(root, "init", "-b", "main");
  return {
    base,
    root,
    cleanup: async () => {
      await fs.rm(base, { recursive: true, force: true, maxRetries: 2 });
    },
  };
}

async function commitAll(root: string, message: string): Promise<void> {
  await git(root, "add", "--all");
  await git(
    root,
    "-c",
    "user.name=Coffice Test",
    "-c",
    "user.email=coffice@example.invalid",
    "commit",
    "-m",
    message,
  );
}

const delegateGit: GitCommandRunner = async (arguments_, options) =>
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
    if (input !== undefined) child.stdin?.end(input, "utf8");
  });

function statusHeader(
  branch = "feature/office",
  oid: string = HEAD_OID,
): string {
  return [`# branch.oid ${oid}`, `# branch.head ${branch}`].join("\0");
}

describe("parseGitStatusV2", () => {
  it("summarizes a committed branch and coarse areas without file names", () => {
    const summary = parseGitStatusV2(
      [
        statusHeader(),
        "# branch.upstream origin/feature/office",
        "# branch.ab +2 -1",
        "1 M. N... 100644 100644 100644 aaa bbb src/staged.ts",
        "1 .M N... 100644 100644 100644 aaa bbb docs/changed.md",
        "? tests/new-file.test.ts",
        "u UU N... 100644 100644 100644 100644 aaa bbb ccc package.json",
      ].join("\0") + "\0",
      OBSERVED_AT,
    );

    expect(summary).toMatchObject({
      availability: "available",
      branch: "feature/office",
      headOid: HEAD_OID,
      headState: "commit",
      changedFiles: 4,
      stagedFiles: 1,
      untrackedFiles: 1,
      conflictedFiles: 1,
      ahead: 2,
      behind: 1,
      clean: false,
      changeAreas: {
        totalFiles: 4,
        summarizedFiles: 4,
        omittedFiles: 0,
        areas: [
          { area: "Source", files: 1 },
          { area: "Tests", files: 1 },
          { area: "Docs", files: 1 },
          { area: "Config", files: 1 },
        ],
      },
      source: "git:status-porcelain-v2",
      observedAt: OBSERVED_AT,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("staged.ts");
    expect(serialized).not.toContain("changed.md");
    expect(serialized).not.toContain("new-file.test.ts");
    expect(serialized).not.toContain("origin/feature/office");
  });

  it("represents an unborn repository without inventing a head commit", () => {
    expect(
      parseGitStatusV2(
        `${statusHeader("main", "(initial)")}\0? README.md\0`,
        OBSERVED_AT,
      ),
    ).toMatchObject({
      branch: "main",
      headOid: null,
      headState: "unborn",
      changedFiles: 1,
    });
  });

  it("labels detached HEAD while retaining the observed commit id", () => {
    expect(
      parseGitStatusV2(statusHeader("(detached)"), OBSERVED_AT),
    ).toMatchObject({
      branch: "detached",
      headOid: HEAD_OID,
      headState: "commit",
    });
  });

  it("sanitizes and bounds an unexpected branch label", () => {
    const branch = `${"feature/very-long-".repeat(8)}\nunsafe\u202ehidden`;
    const summary = parseGitStatusV2(statusHeader(branch), OBSERVED_AT);

    expect(summary?.branch.length).toBeLessThanOrEqual(96);
    expect(summary?.branch).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(summary?.branch).not.toMatch(/\p{Cf}/u);
  });

  it("counts a rename once, consumes its origin record, and emits neither path", () => {
    const destination = "tests/new name.test.ts";
    const origin = "src/old-secret-name.ts";
    const summary = parseGitStatusV2(
      `${statusHeader()}\0` +
        `2 R. N... 100644 100644 100644 aaa bbb R100 ${destination}\0` +
        `${origin}\0`,
      OBSERVED_AT,
    );

    expect(summary).toMatchObject({
      changedFiles: 1,
      stagedFiles: 1,
      changeAreas: {
        totalFiles: 1,
        summarizedFiles: 1,
        omittedFiles: 0,
        areas: [{ area: "Tests", files: 1 }],
      },
    });
    expect(JSON.stringify(summary)).not.toContain(destination);
    expect(JSON.stringify(summary)).not.toContain(origin);
  });

  it("handles whitespace, control characters, and sensitive-looking paths only in memory", () => {
    const sensitivePaths = [
      ".env.production",
      "src/customer-secret-api-key.ts",
      "docs/read\nme.md",
      "assets/private\tportrait.png",
      "opaque folder/no-extension",
    ];
    const input = `${statusHeader()}\0${sensitivePaths
      .map((filePath) => `? ${filePath}\0`)
      .join("")}`;
    const summary = parseGitStatusV2(input, OBSERVED_AT);

    expect(summary?.changeAreas).toEqual({
      totalFiles: 5,
      summarizedFiles: 5,
      omittedFiles: 0,
      areas: [
        { area: "Source", files: 1 },
        { area: "Docs", files: 1 },
        { area: "Config", files: 1 },
        { area: "Assets", files: 1 },
        { area: "Other", files: 1 },
      ],
    });
    for (const filePath of sensitivePaths) {
      expect(JSON.stringify(summary)).not.toContain(filePath);
    }
  });

  it("bounds path classification while preserving total and omitted counts", () => {
    const total = REPOSITORY_CHANGE_PATH_LIMIT + 7;
    const changes = Array.from(
      { length: total },
      (_, index) => `? src/private-${index}.ts`,
    );
    const summary = parseGitStatusV2(
      `${statusHeader()}\0${changes.join("\0")}\0`,
      OBSERVED_AT,
    );

    expect(summary).toMatchObject({
      changedFiles: total,
      changeAreas: {
        totalFiles: total,
        summarizedFiles: REPOSITORY_CHANGE_PATH_LIMIT,
        omittedFiles: 7,
        areas: [{ area: "Source", files: REPOSITORY_CHANGE_PATH_LIMIT }],
      },
    });
  });

  it("rejects output that lacks authoritative branch or head metadata", () => {
    expect(parseGitStatusV2("", OBSERVED_AT)).toBeUndefined();
    expect(
      parseGitStatusV2("# branch.head main\0", OBSERVED_AT),
    ).toBeUndefined();
    expect(
      parseGitStatusV2(`# branch.oid ${HEAD_OID}\0`, OBSERVED_AT),
    ).toBeUndefined();
  });
});

describe("parseGitDiffNumstat", () => {
  it("aggregates tracked text and binary changes without retaining paths", () => {
    const sensitiveTextPath = "src/private-client-name.ts";
    const sensitiveBinaryPath = "assets/customer-portrait.png";
    const summary = parseGitDiffNumstat(
      `12\t4\t${sensitiveTextPath}\0-\t-\t${sensitiveBinaryPath}\0`,
    );

    expect(summary).toEqual({
      trackedFiles: 2,
      additions: 12,
      deletions: 4,
      binaryFiles: 1,
      source: "git:diff-numstat",
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(sensitiveTextPath);
    expect(serialized).not.toContain(sensitiveBinaryPath);
  });

  it("fails closed instead of returning a partial malformed aggregate", () => {
    expect(
      parseGitDiffNumstat("4\t2\tsrc/valid.ts\0not-numstat\0"),
    ).toBeUndefined();
  });
});

describe("Git command boundary", () => {
  it("disables optional locks and global configuration without forwarding secrets", () => {
    const environment = buildGitEnvironment({
      Path: "C:\\Synthetic\\Git",
      SystemRoot: "C:\\Synthetic\\Windows",
      TEMP: "C:\\Synthetic\\Temp",
      NODE_ENV: "test",
      SECRET_TOKEN: "must-not-reach-git",
      GIT_EXTERNAL_DIFF: "must-not-run",
    });

    expect(environment).toMatchObject({
      NODE_ENV: "test",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_ATTR_NOSYSTEM: "1",
      GIT_LITERAL_PATHSPECS: "1",
      GIT_NO_LAZY_FETCH: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_PAGER: "cat",
      LC_ALL: "C",
      PATH: "C:\\Synthetic\\Git",
      SystemRoot: "C:\\Synthetic\\Windows",
      TEMP: "C:\\Synthetic\\Temp",
    });
    expect(environment).not.toHaveProperty("SECRET_TOKEN");
    expect(environment).not.toHaveProperty("GIT_EXTERNAL_DIFF");
  });

  it("builds status and diff commands with privacy and side-effect guards", () => {
    const root = "C:\\private-root";
    const status = buildGitStatusArguments(root);
    const diff = buildGitDiffArguments(root);

    expect(status).toEqual(
      expect.arrayContaining([
        "-C",
        root,
        "core.fsmonitor=false",
        "diff.external=",
        "status.renames=false",
        "submodule.recurse=false",
        "status",
        "--porcelain=v2",
        "--branch",
        "--untracked-files=all",
        "--ignore-submodules=all",
        "--no-renames",
        "-z",
        "--no-optional-locks",
      ]),
    );
    expect(status.slice(-2)).toEqual(["--", "."]);
    expect(diff).toEqual(
      expect.arrayContaining([
        "-C",
        root,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--ignore-submodules=all",
        "--numstat",
        "-z",
        "HEAD",
        "--",
        "--no-optional-locks",
      ]),
    );
    expect(diff.slice(-2)).toEqual(["--", "."]);
  });

  it("retains real status evidence when the optional diff command fails", async () => {
    const repository = await createRepository();
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      await fs.writeFile(
        path.join(repository.root, "tracked.txt"),
        "base\nchanged\n",
      );
      const runner = vi.fn<GitCommandRunner>(async (arguments_, options) => {
        expect(options).toMatchObject({
          encoding: "utf8",
          timeout: 2_000,
          windowsHide: true,
          maxBuffer: 512 * 1024,
        });
        expect(options.env).not.toHaveProperty("GIT_EXTERNAL_DIFF");
        if (arguments_.includes("diff")) {
          throw new Error("private diff failure details");
        }
        return await delegateGit(arguments_, options);
      });

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
        runner,
      );

      expect(evidence).toMatchObject({
        availability: "available",
        headState: "commit",
        changedFiles: 1,
      });
      expect(evidence).not.toHaveProperty("diffStats");
      const serialized = JSON.stringify(evidence);
      expect(serialized).not.toContain(repository.root);
      expect(serialized).not.toContain("tracked.txt");
      expect(serialized).not.toContain("private diff failure details");
    } finally {
      await repository.cleanup();
    }
  });

  it("returns an explicit minimal unavailable result when real status fails", async () => {
    const repository = await createRepository();
    const fixtureContent = "TOP_SECRET_FILE_BODY_MUST_NEVER_ESCAPE";
    let sandboxDirectory: string | undefined;
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      const runner = vi.fn<GitCommandRunner>(async (arguments_, options) => {
        if (arguments_.includes("status")) {
          sandboxDirectory = options.env.GIT_DIR;
          throw new Error(
            `${repository.root}\\customer-secret-filename.ts: ${fixtureContent}`,
          );
        }
        return await delegateGit(arguments_, options);
      });

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
        runner,
      );

      expect(evidence).toEqual({
        availability: "unavailable",
        source: "git",
        observedAt: OBSERVED_AT,
      });
      const serialized = JSON.stringify(evidence);
      expect(serialized).not.toContain(repository.root);
      expect(serialized).not.toContain("customer-secret-filename.ts");
      expect(serialized).not.toContain(fixtureContent);
      expect(sandboxDirectory).toBeTruthy();
      await expect(fs.access(sandboxDirectory!)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await repository.cleanup();
    }
  });

  it("reads real unborn HEAD metadata without requesting diff statistics", async () => {
    const repository = await createRepository();
    try {
      await fs.writeFile(path.join(repository.root, "README.md"), "private\n");
      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
      );

      expect(evidence).toMatchObject({
        availability: "available",
        branch: "main",
        headState: "unborn",
        headOid: null,
        changedFiles: 1,
      });
      expect(evidence).not.toHaveProperty("diffStats");
      expect(JSON.stringify(evidence)).not.toContain("README.md");
    } finally {
      await repository.cleanup();
    }
  });

  it("reads HEAD from a valid linked worktree", async () => {
    const repository = await createRepository();
    const linkedRoot = path.join(repository.base, "linked-worktree");
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      await git(repository.root, "worktree", "add", "-b", "linked", linkedRoot);

      const evidence = await readRepositoryEvidence(linkedRoot, OBSERVED_AT);

      expect(evidence).toMatchObject({
        availability: "available",
        branch: "linked",
        headState: "commit",
        clean: true,
      });
    } finally {
      await repository.cleanup();
    }
  });

  it("fails closed when HEAD changes between bounded observations", async () => {
    const repository = await createRepository();
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      await git(repository.root, "branch", "other");
      let headVerifications = 0;
      const runner: GitCommandRunner = async (arguments_, options) => {
        if (
          arguments_.includes("rev-parse") &&
          arguments_.includes("--verify") &&
          arguments_.at(-1) === "HEAD"
        ) {
          headVerifications += 1;
          if (headVerifications === 2) {
            await git(repository.root, "switch", "other");
          }
        }
        return await delegateGit(arguments_, options);
      };

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
        runner,
      );

      expect(headVerifications).toBe(2);
      expect(evidence).toEqual({
        availability: "unavailable",
        source: "git",
        observedAt: OBSERVED_AT,
      });
    } finally {
      await repository.cleanup();
    }
  });

  it("rejects a symbolic HEAD containing Unicode direction controls", async () => {
    const repository = await createRepository();
    const unsafeReference = "refs/heads/feature-\u202ereversed";
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      const oid = (await git(repository.root, "rev-parse", "HEAD")).trim();
      await git(repository.root, "update-ref", unsafeReference, oid);
      await fs.writeFile(
        path.join(repository.root, ".git", "HEAD"),
        `ref: ${unsafeReference}\n`,
      );

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
      );

      expect(evidence.availability).toBe("unavailable");
      expect(JSON.stringify(evidence)).not.toContain("reversed");
    } finally {
      await repository.cleanup();
    }
  });

  it("rejects a malformed heads reference instead of treating it as unborn", async () => {
    const repository = await createRepository();
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      await fs.writeFile(
        path.join(repository.root, ".git", "HEAD"),
        "ref: refs/heads/../../attacker\n",
      );

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
      );

      expect(evidence.availability).toBe("unavailable");
    } finally {
      await repository.cleanup();
    }
  });

  it("fails closed when an info metadata ancestor is a junction or symlink", async () => {
    const repository = await createRepository();
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      const infoDirectory = path.join(repository.root, ".git", "info");
      const externalInfo = path.join(repository.base, "external-info");
      await fs.mkdir(externalInfo);
      await fs.writeFile(path.join(externalInfo, "attributes"), "# blank\n");
      await fs.writeFile(path.join(externalInfo, "exclude"), "# blank\n");
      await fs.rm(infoDirectory, { recursive: true, force: true });
      await fs.symlink(
        externalInfo,
        infoDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
      );

      expect(evidence.availability).toBe("unavailable");
    } finally {
      await repository.cleanup();
    }
  });

  it("fails closed when a linked-worktree Git directory resolves outside the common directory", async () => {
    const repository = await createRepository();
    const linkedRoot = path.join(repository.base, "linked-worktree");
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      await git(repository.root, "worktree", "add", "-b", "linked", linkedRoot);
      const gitDirectory = (
        await git(linkedRoot, "rev-parse", "--absolute-git-dir")
      ).trim();
      const commonDirectory = path.join(repository.root, ".git");
      const externalGitDirectory = path.join(
        repository.base,
        "external-git-dir",
      );
      await fs.rename(gitDirectory, externalGitDirectory);
      await fs.writeFile(
        path.join(externalGitDirectory, "commondir"),
        `${commonDirectory.replaceAll("\\", "/")}\n`,
      );
      await fs.symlink(
        externalGitDirectory,
        gitDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );

      expect((await git(linkedRoot, "rev-parse", "HEAD")).trim()).toMatch(
        /^[0-9a-f]{40}$/,
      );
      const evidence = await readRepositoryEvidence(linkedRoot, OBSERVED_AT);

      expect(evidence.availability).toBe("unavailable");
    } finally {
      await repository.cleanup();
    }
  });

  it.skipIf(process.platform === "win32")(
    "fails closed when linked-worktree HEAD is a symlink",
    async () => {
      const repository = await createRepository();
      const linkedRoot = path.join(repository.base, "linked-worktree");
      try {
        await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
        await commitAll(repository.root, "initial");
        await git(
          repository.root,
          "worktree",
          "add",
          "-b",
          "linked",
          linkedRoot,
        );
        const gitDirectory = (
          await git(linkedRoot, "rev-parse", "--absolute-git-dir")
        ).trim();
        const headPath = path.join(gitDirectory, "HEAD");
        const originalHeadPath = path.join(gitDirectory, "HEAD.original");
        await fs.rename(headPath, originalHeadPath);
        await fs.symlink(originalHeadPath, headPath, "file");

        const evidence = await readRepositoryEvidence(linkedRoot, OBSERVED_AT);

        expect(evidence.availability).toBe("unavailable");
      } finally {
        await repository.cleanup();
      }
    },
  );

  it("returns real diff aggregates without serializing the root or path", async () => {
    const repository = await createRepository();
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      await fs.writeFile(
        path.join(repository.root, "tracked.txt"),
        "base\nchanged\n",
      );

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
      );

      expect(evidence).toMatchObject({
        availability: "available",
        changedFiles: 1,
        diffStats: {
          trackedFiles: 1,
          additions: 1,
          deletions: 0,
          binaryFiles: 0,
          source: "git:diff-numstat",
        },
      });
      const serialized = JSON.stringify(evidence);
      expect(serialized).not.toContain(repository.root);
      expect(serialized).not.toContain("tracked.txt");
    } finally {
      await repository.cleanup();
    }
  });

  it.each(["clean", "process"] as const)(
    "does not execute a repository-local %s filter",
    async (filterKind) => {
      const repository = await createRepository();
      const sentinel = path.join(repository.base, `${filterKind}-executed.txt`);
      const script = path.join(repository.base, `${filterKind}-filter.cjs`);
      try {
        await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
        await commitAll(repository.root, "initial");
        await fs.writeFile(
          path.join(repository.root, ".gitattributes"),
          "*.txt filter=sentinel\n",
        );
        await commitAll(repository.root, "attributes");
        const scriptBody =
          filterKind === "clean"
            ? 'const fs=require("node:fs");fs.writeFileSync(process.argv[2],"executed");process.stdin.pipe(process.stdout);\n'
            : 'const fs=require("node:fs");fs.writeFileSync(process.argv[2],"executed");process.exit(1);\n';
        await fs.writeFile(script, scriptBody);
        const command = `node "${script.replaceAll("\\", "/")}" "${sentinel.replaceAll("\\", "/")}"`;
        await git(
          repository.root,
          "config",
          `filter.sentinel.${filterKind}`,
          command,
        );
        await git(
          repository.root,
          "config",
          "filter.sentinel.required",
          "true",
        );
        await fs.writeFile(
          path.join(repository.root, "tracked.txt"),
          "base\nchanged\n",
        );

        const evidence = await readRepositoryEvidence(
          repository.root,
          OBSERVED_AT,
        );

        expect(evidence).toEqual({
          availability: "unavailable",
          source: "git",
          observedAt: OBSERVED_AT,
        });
        await expect(fs.access(sentinel)).rejects.toMatchObject({
          code: "ENOENT",
        });
        const serialized = JSON.stringify(evidence);
        expect(serialized).not.toContain("tracked.txt");
        expect(serialized).not.toContain(scriptBody.trim());
        expect(serialized).not.toContain(repository.root);
      } finally {
        await repository.cleanup();
      }
    },
  );

  it("rejects a repository config include before following the external file", async () => {
    const repository = await createRepository();
    const externalConfig = path.join(
      repository.base,
      "external-private.config",
    );
    try {
      await fs.writeFile(
        externalConfig,
        "this would be invalid if an include followed it\n[",
      );
      await git(repository.root, "config", "include.path", externalConfig);
      const calls: string[][] = [];
      const runner: GitCommandRunner = async (arguments_, options) => {
        calls.push([...arguments_]);
        return await delegateGit(arguments_, options);
      };

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
        runner,
      );

      expect(evidence).toEqual({
        availability: "unavailable",
        source: "git",
        observedAt: OBSERVED_AT,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(
        expect.arrayContaining([
          "config",
          "--local",
          "--no-includes",
          "--name-only",
          "--get-regexp",
        ]),
      );
      expect(JSON.stringify(evidence)).not.toContain(externalConfig);
    } finally {
      await repository.cleanup();
    }
  });

  it("rejects worktree-local configuration before repository enrichment", async () => {
    const repository = await createRepository();
    try {
      await git(repository.root, "config", "extensions.worktreeConfig", "true");
      const calls: string[][] = [];
      const runner: GitCommandRunner = async (arguments_, options) => {
        calls.push([...arguments_]);
        return await delegateGit(arguments_, options);
      };

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
        runner,
      );

      expect(evidence.availability).toBe("unavailable");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("--no-includes");
    } finally {
      await repository.cleanup();
    }
  });

  it("rejects an active filter attribute without loading a global driver", async () => {
    const repository = await createRepository();
    const sentinel = path.join(repository.base, "global-filter-executed.txt");
    const script = path.join(repository.base, "global-filter.cjs");
    const globalConfig = path.join(repository.base, "global.config");
    const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await fs.writeFile(
        path.join(repository.root, ".gitattributes"),
        "*.txt filter=sentinel\n",
      );
      await commitAll(repository.root, "filtered attributes");
      await fs.writeFile(
        script,
        `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "executed");process.stdin.pipe(process.stdout);\n`,
      );
      const filterCommand = `node "${script.replaceAll("\\", "/")}"`;
      await fs.writeFile(
        globalConfig,
        `[filter "sentinel"]\n\tclean = ${filterCommand}\n\tprocess = ${filterCommand}\n\trequired = true\n`,
      );
      process.env.GIT_CONFIG_GLOBAL = globalConfig;
      await fs.writeFile(
        path.join(repository.root, "tracked.txt"),
        "base\nchanged\n",
      );
      const calls: string[][] = [];
      const runner: GitCommandRunner = async (arguments_, options) => {
        calls.push([...arguments_]);
        expect(options.env.GIT_CONFIG_GLOBAL).not.toBe(globalConfig);
        return await delegateGit(arguments_, options);
      };

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
        runner,
      );

      expect(evidence.availability).toBe("unavailable");
      expect(
        calls.some((arguments_) => arguments_.includes("check-attr")),
      ).toBe(true);
      expect(calls.some((arguments_) => arguments_.includes("status"))).toBe(
        false,
      );
      expect(calls.some((arguments_) => arguments_.includes("diff"))).toBe(
        false,
      );
      await expect(fs.access(sentinel)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      if (previousGlobalConfig === undefined) {
        delete process.env.GIT_CONFIG_GLOBAL;
      } else {
        process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
      }
      await repository.cleanup();
    }
  });

  it.each(["info/attributes", "info/exclude"])(
    "fails closed when repository-local %s metadata is active",
    async (relativeMetadataPath) => {
      const repository = await createRepository();
      try {
        await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
        await commitAll(repository.root, "initial");
        const metadataPath = (
          await git(
            repository.root,
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            relativeMetadataPath,
          )
        ).trim();
        await fs.mkdir(path.dirname(metadataPath), { recursive: true });
        await fs.writeFile(
          metadataPath,
          relativeMetadataPath.endsWith("attributes")
            ? "*.txt filter=private\n"
            : "private-pattern-*\n",
        );

        const evidence = await readRepositoryEvidence(
          repository.root,
          OBSERVED_AT,
        );

        expect(evidence.availability).toBe("unavailable");
        expect(JSON.stringify(evidence)).not.toContain("private-pattern");
      } finally {
        await repository.cleanup();
      }
    },
  );

  it("fails closed when repository metadata is replaced between lstat and open", async () => {
    const repository = await createRepository();
    let openSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      const metadataPath = (
        await git(
          repository.root,
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "info/attributes",
        )
      ).trim();
      await fs.mkdir(path.dirname(metadataPath), { recursive: true });
      await fs.writeFile(metadataPath, "#\n");
      const originalPath = `${metadataPath}.original`;
      const replacementPath = `${metadataPath}.replacement`;
      await fs.writeFile(replacementPath, "#\n");
      const originalOpen = fs.open.bind(fs);
      let replaced = false;
      openSpy = vi
        .spyOn(fs, "open")
        .mockImplementation(async (...arguments_) => {
          if (
            !replaced &&
            path.resolve(String(arguments_[0])) === path.resolve(metadataPath)
          ) {
            replaced = true;
            await fs.rename(metadataPath, originalPath);
            await fs.rename(replacementPath, metadataPath);
          }
          return await originalOpen(...arguments_);
        });

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
      );

      expect(replaced).toBe(true);
      expect(evidence.availability).toBe("unavailable");
    } finally {
      openSpy?.mockRestore();
      await repository.cleanup();
    }
  });

  it.skipIf(process.platform === "win32")(
    "fails closed without blocking on a repository metadata FIFO",
    async () => {
      const repository = await createRepository();
      try {
        await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
        await commitAll(repository.root, "initial");
        const metadataPath = (
          await git(
            repository.root,
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "info/attributes",
          )
        ).trim();
        await fs.mkdir(path.dirname(metadataPath), { recursive: true });
        await execFileAsync("mkfifo", [metadataPath], {
          timeout: 2_000,
          windowsHide: true,
        });

        const evidence = await readRepositoryEvidence(
          repository.root,
          OBSERVED_AT,
        );

        expect(evidence.availability).toBe("unavailable");
      } finally {
        await repository.cleanup();
      }
    },
    5_000,
  );

  it.skipIf(process.platform === "win32")(
    "fails closed when repository metadata is a symlink",
    async () => {
      const repository = await createRepository();
      try {
        await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
        await commitAll(repository.root, "initial");
        const metadataPath = (
          await git(
            repository.root,
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "info/exclude",
          )
        ).trim();
        const externalPath = path.join(repository.base, "external-exclude");
        await fs.mkdir(path.dirname(metadataPath), { recursive: true });
        await fs.writeFile(externalPath, "#\n");
        await fs.rm(metadataPath, { force: true });
        await fs.symlink(externalPath, metadataPath, "file");

        const evidence = await readRepositoryEvidence(
          repository.root,
          OBSERVED_AT,
        );

        expect(evidence.availability).toBe("unavailable");
      } finally {
        await repository.cleanup();
      }
    },
  );

  it("fails closed when the tracked-path attribute audit exceeds its count bound", async () => {
    const repository = await createRepository();
    let sandboxDirectory: string | undefined;
    const calls: string[][] = [];
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      const oversizedPaths =
        Array.from({ length: 8_193 }, (_, index) => `p${index}`).join("\0") +
        "\0";
      const runner: GitCommandRunner = async (arguments_, options) => {
        calls.push([...arguments_]);
        if (arguments_.includes("ls-files")) {
          sandboxDirectory = options.env.GIT_DIR;
          return { stdout: oversizedPaths };
        }
        return await delegateGit(arguments_, options);
      };

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
        runner,
      );

      expect(evidence.availability).toBe("unavailable");
      expect(
        calls.some((arguments_) => arguments_.includes("check-attr")),
      ).toBe(false);
      expect(calls.some((arguments_) => arguments_.includes("status"))).toBe(
        false,
      );
      expect(sandboxDirectory).toBeTruthy();
      await expect(fs.access(sandboxDirectory!)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await repository.cleanup();
    }
  });

  it("fails closed on malformed filter-attribute output", async () => {
    const repository = await createRepository();
    const calls: string[][] = [];
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      const runner: GitCommandRunner = async (arguments_, options) => {
        calls.push([...arguments_]);
        if (arguments_.includes("check-attr")) {
          expect(options.input).toContain("tracked.txt\0");
          return { stdout: "tracked.txt\0filter\0unspecified" };
        }
        return await delegateGit(arguments_, options);
      };

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
        runner,
      );

      expect(evidence.availability).toBe("unavailable");
      expect(calls.some((arguments_) => arguments_.includes("status"))).toBe(
        false,
      );
    } finally {
      await repository.cleanup();
    }
  });

  it("does not publish a false dirty state when autocrlf semantics disagree", async () => {
    const repository = await createRepository();
    try {
      await git(repository.root, "config", "core.autocrlf", "true");
      const trackedPath = path.join(repository.root, "tracked.txt");
      await fs.writeFile(trackedPath, "base\r\n");
      await commitAll(repository.root, "normalized line endings");
      await fs.writeFile(trackedPath, "base\r\n");
      const changedTimestamp = new Date(Date.now() + 2_000);
      await fs.utimes(trackedPath, changedTimestamp, changedTimestamp);

      expect(await git(repository.root, "status", "--porcelain")).toBe("");

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
      );

      expect(evidence).toEqual({
        availability: "unavailable",
        source: "git",
        observedAt: OBSERVED_AT,
      });
    } finally {
      await repository.cleanup();
    }
  });

  it("limits status and diff to a saved root nested inside a parent repository", async () => {
    const repository = await createRepository();
    const nestedRoot = path.join(repository.root, "inside");
    try {
      await fs.mkdir(nestedRoot);
      await fs.writeFile(path.join(nestedRoot, "inside.txt"), "base\n");
      await fs.writeFile(path.join(repository.root, "outside.txt"), "base\n");
      await commitAll(repository.root, "initial");
      await fs.writeFile(path.join(nestedRoot, "inside.txt"), "base\nin\n");
      await fs.writeFile(
        path.join(repository.root, "outside.txt"),
        "base\nout\n",
      );

      const evidence = await readRepositoryEvidence(nestedRoot, OBSERVED_AT);

      expect(evidence).toMatchObject({
        availability: "available",
        changedFiles: 1,
        diffStats: { trackedFiles: 1, additions: 1, deletions: 0 },
      });
      const serialized = JSON.stringify(evidence);
      expect(serialized).not.toContain("inside.txt");
      expect(serialized).not.toContain("outside.txt");
      expect(serialized).not.toContain(repository.root);
    } finally {
      await repository.cleanup();
    }
  });

  it("preserves real ahead and behind counts outside the detached sandbox", async () => {
    const repository = await createRepository();
    try {
      await fs.writeFile(path.join(repository.root, "base.txt"), "base\n");
      await commitAll(repository.root, "base");
      const baseOid = (await git(repository.root, "rev-parse", "HEAD")).trim();
      await fs.writeFile(path.join(repository.root, "local.txt"), "local\n");
      await commitAll(repository.root, "local");
      await git(repository.root, "switch", "--detach", baseOid);
      await fs.writeFile(path.join(repository.root, "remote.txt"), "remote\n");
      await commitAll(repository.root, "remote");
      const remoteOid = (
        await git(repository.root, "rev-parse", "HEAD")
      ).trim();
      await git(
        repository.root,
        "update-ref",
        "refs/remotes/origin/main",
        remoteOid,
      );
      await git(repository.root, "switch", "main");
      await git(repository.root, "config", "remote.origin.url", ".");
      await git(
        repository.root,
        "config",
        "remote.origin.fetch",
        "+refs/heads/*:refs/remotes/origin/*",
      );
      await git(repository.root, "config", "branch.main.remote", "origin");
      await git(
        repository.root,
        "config",
        "branch.main.merge",
        "refs/heads/main",
      );

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
      );

      expect(evidence).toMatchObject({
        availability: "available",
        branch: "main",
        ahead: 1,
        behind: 1,
      });
    } finally {
      await repository.cleanup();
    }
  });

  it("removes its path-free temporary Git control directory", async () => {
    const repository = await createRepository();
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      let sandboxDirectory: string | undefined;
      const runner: GitCommandRunner = async (arguments_, options) => {
        if (arguments_.includes("status")) {
          sandboxDirectory = options.env.GIT_DIR;
        }
        return await delegateGit(arguments_, options);
      };

      await readRepositoryEvidence(repository.root, OBSERVED_AT, runner);

      expect(sandboxDirectory).toBeTruthy();
      await expect(fs.access(sandboxDirectory!)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await repository.cleanup();
    }
  });

  it("references the original index read-only without copying or refreshing it", async () => {
    const repository = await createRepository();
    try {
      await fs.writeFile(path.join(repository.root, "tracked.txt"), "base\n");
      await commitAll(repository.root, "initial");
      const indexPath = (
        await git(
          repository.root,
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "index",
        )
      ).trim();
      const before = await fs.stat(indexPath);
      let observedSandbox: string | undefined;
      const runner: GitCommandRunner = async (arguments_, options) => {
        if (arguments_.includes("status")) {
          observedSandbox = options.env.GIT_DIR;
          expect(options.env.GIT_INDEX_FILE).toBe(indexPath);
          expect(options.env.GIT_OPTIONAL_LOCKS).toBe("0");
          expect(arguments_).toContain("--no-optional-locks");
          const sandboxEntries = await fs.readdir(observedSandbox!);
          expect(sandboxEntries).not.toContain("index");
          expect(
            sandboxEntries.some((entry) => entry.startsWith("sharedindex.")),
          ).toBe(false);
        }
        return await delegateGit(arguments_, options);
      };

      const evidence = await readRepositoryEvidence(
        repository.root,
        OBSERVED_AT,
        runner,
      );
      const after = await fs.stat(indexPath);

      expect(evidence.availability).toBe("available");
      expect(after.size).toBe(before.size);
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(observedSandbox).toBeTruthy();
      await expect(fs.access(observedSandbox!)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await repository.cleanup();
    }
  });
});
