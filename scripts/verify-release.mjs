import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const releaseUrl = "http://127.0.0.1:3003";
const checks = [
  ["dependency audit", ["audit", "--audit-level=high"]],
  ["type checking", ["run", "typecheck"]],
  ["lint", ["run", "lint"]],
  ["format", ["run", "format"]],
  ["tests", ["test"]],
  ["production build", ["run", "build"]],
  ["asset boundary", ["run", "verify:assets"]],
  ["public boundary", ["run", "verify:boundary"]],
];

function assertCleanCheckout() {
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (status) {
    throw new Error(
      "Release verification must run from a clean checkout. Commit or remove the listed changes first.",
    );
  }
}

function npmInvocation(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return { command: process.execPath, args: [npmExecPath, ...args] };
  }
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args,
  };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${options.label ?? command} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}.`,
          ),
        );
      }
    });
  });
}

async function runNpm(args, options = {}) {
  const invocation = npmInvocation(args);
  await runProcess(invocation.command, invocation.args, options);
}

function startProductionServer(workspaceDirectory) {
  const nextCli = path.join(
    root,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const child = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", "3003"],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "production",
        COFFICE_DATA_DIR: workspaceDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  const remember = (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);
  return {
    child,
    output: () => output,
    ready: () => /(?:^|\s)Ready in\s/.test(output),
  };
}

async function assertReleasePortAvailable() {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: 3003 });
    socket.setTimeout(2_000);
    socket.once("connect", () => {
      socket.destroy();
      reject(
        new Error(
          "Release verification requires 127.0.0.1:3003 to be free. Stop the existing process and run the gate again.",
        ),
      );
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(
        new Error(
          "Could not prove that 127.0.0.1:3003 is free before release verification.",
        ),
      );
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve();
      else
        reject(
          new Error(
            `Could not probe 127.0.0.1:3003 before release verification (${error.code ?? "unknown error"}).`,
          ),
        );
    });
  });
}

async function waitForServer(server) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Production server exited before it became ready.\n${server.output()}`,
      );
    }
    if (!server.ready()) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    try {
      const response = await fetch(releaseUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok && server.child.exitCode === null) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Production server did not become ready within 45 seconds.\n${server.output()}`,
  );
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  const stopped = new Promise((resolve) => server.child.once("exit", resolve));
  server.child.kill();
  await Promise.race([
    stopped,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.child.exitCode === null) {
    server.child.kill("SIGKILL");
    await stopped;
  }
}

async function main() {
  assertCleanCheckout();
  await assertReleasePortAvailable();
  for (const [label, args] of checks) {
    console.log(`\nRelease check: ${label}`);
    await runNpm(args, { label });
  }

  const workspaceDirectory = await mkdtemp(
    path.join(os.tmpdir(), "coffice-release-workspace-"),
  );
  await assertReleasePortAvailable();
  const server = startProductionServer(workspaceDirectory);
  try {
    await waitForServer(server);
    const browserEnvironment = {
      COFFICE_URL: releaseUrl,
      COFFICE_ACCEPTANCE_DIR: path.join(
        root,
        "tmp",
        "browser-acceptance",
        "release-ui",
      ),
      COFFICE_POINTER_ALIGNMENT_DIR: path.join(
        root,
        "tmp",
        "browser-acceptance",
        "release-pointer",
      ),
    };
    console.log("\nRelease check: pointer alignment");
    await runNpm(["run", "verify:companion"], {
      env: browserEnvironment,
      label: "companion experience",
    });
    await runNpm(["run", "verify:pointer-alignment"], {
      env: browserEnvironment,
      label: "pointer alignment",
    });
    console.log("\nRelease check: browser acceptance");
    await runNpm(["run", "verify:ui"], {
      env: browserEnvironment,
      label: "browser acceptance",
    });
  } catch (error) {
    const serverOutput = server.output();
    if (serverOutput)
      console.error(`\nProduction server output:\n${serverOutput}`);
    throw error;
  } finally {
    await stopServer(server);
    const resolvedTemporaryRoot = path.resolve(os.tmpdir());
    const resolvedWorkspace = path.resolve(workspaceDirectory);
    if (
      resolvedWorkspace.startsWith(`${resolvedTemporaryRoot}${path.sep}`) &&
      path.basename(resolvedWorkspace).startsWith("coffice-release-workspace-")
    ) {
      await rm(resolvedWorkspace, { recursive: true, force: true });
    }
  }

  console.log(
    "\nCoffice release verification passed from a clean checkout, including the production browser gate on 127.0.0.1:3003.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
