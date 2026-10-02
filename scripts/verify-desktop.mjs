import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { _electron as electron } from "playwright-core";

const root = path.resolve(import.meta.dirname, "..");
const executablePath = path.join(
  root,
  "desktop-release",
  "win-unpacked",
  "Coffice.exe",
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const resultDirectory = path.join(root, "tmp", "desktop-verification");
await mkdir(resultDirectory, { recursive: true });

function portIsFree() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(3003, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

assert(
  await portIsFree(),
  "Port 3003 must be free before the desktop smoke check.",
);
let application;
try {
  application = await electron.launch({
    executablePath,
    env: environment,
    timeout: 60_000,
  });
  const page = await application.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.waitForURL("http://127.0.0.1:3003/", { timeout: 60_000 });
  await page.locator("main").waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => document.body.innerText.trim().length > 50);
  const security = await application.evaluate(({ BrowserWindow }) => {
    const preferences =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      nodeIntegration: preferences.nodeIntegration,
      contextIsolation: preferences.contextIsolation,
      sandbox: preferences.sandbox,
      windows: BrowserWindow.getAllWindows().length,
    };
  });
  assert.equal(security.nodeIntegration, false);
  assert.equal(security.contextIsolation, true);
  assert.equal(security.sandbox, true);
  assert.equal(security.windows, 1);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(
    (await page.request.get("http://127.0.0.1:3003/api/companion")).status(),
    200,
  );
  assert.equal(
    pageErrors.length,
    0,
    "The desktop renderer should not report application errors.",
  );
  await page.screenshot({ path: path.join(resultDirectory, "desktop.png") });

  const second = spawn(executablePath, [], {
    env: environment,
    windowsHide: true,
    stdio: "ignore",
  });
  const secondExit = await Promise.race([
    new Promise((resolve, reject) => {
      second.once("exit", resolve);
      second.once("error", reject);
    }),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Second instance did not exit.")),
        10_000,
      ).unref(),
    ),
  ]);
  assert.equal(
    secondExit,
    0,
    "The second launch should focus the existing app and exit.",
  );
  assert.equal(
    await application.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
    1,
  );
  console.log(
    "PASS: packaged app launched its own service, rendered the office, isolated its renderer, and kept one window.",
  );
} finally {
  if (application) await application.close();
}
const deadline = Date.now() + 8_000;
while (!(await portIsFree()) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert(
  await portIsFree(),
  "The bundled service must stop when Coffice closes.",
);
console.log("PASS: closing Coffice stopped its own local service.");

// A foreign listener must remain untouched, and its page must never be loaded.
const occupied = net.createServer((socket) => socket.end());
await new Promise((resolve, reject) => {
  occupied.once("error", reject);
  occupied.listen(3003, "127.0.0.1", resolve);
});
let conflictApplication;
try {
  conflictApplication = await electron.launch({
    executablePath,
    env: environment,
    timeout: 30_000,
  });
  const page = await conflictApplication.firstWindow();
  await page.getByRole("alert").waitFor({ timeout: 15_000 });
  assert.match(
    await page.getByRole("alert").innerText(),
    /Port 3003 is already in use/,
  );
  assert.match(page.url(), /^file:/);
  assert(occupied.listening, "The existing listener must stay running.");
  console.log(
    "PASS: occupied port produces a clear error without touching the existing listener.",
  );
} finally {
  if (conflictApplication) await conflictApplication.close();
  await new Promise((resolve) => occupied.close(resolve));
}
