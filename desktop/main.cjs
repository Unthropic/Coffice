/* eslint-disable @typescript-eslint/no-require-imports -- Electron's main entry uses CommonJS. */
const { app, BrowserWindow, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const net = require("node:net");
const path = require("node:path");
const { existsSync } = require("node:fs");

const origin = "http://127.0.0.1:3003";
let window;
let server;
let quitting = false;

async function showFailure(message) {
  if (!window || window.isDestroyed()) return;
  await window.loadFile(path.join(__dirname, "error.html"), {
    query: { message },
  });
  window.show();
}

function portAvailable() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ port: 3003, host: "127.0.0.1", exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

function openAllowedExternal(url) {
  try {
    const target = new URL(url);
    if (target.username || target.password || target.port) return;
    const github =
      target.protocol === "https:" && target.hostname === "github.com";
    const codex =
      target.protocol === "codex:" &&
      target.hostname === "threads" &&
      /^\/[a-zA-Z0-9-]+$/.test(target.pathname) &&
      !target.search &&
      !target.hash;
    if (github || codex) void shell.openExternal(url).catch(() => {});
  } catch {
    // Invalid destinations never leave the app.
  }
}

async function startServer() {
  if (!(await portAvailable())) {
    throw new Error(
      "Port 3003 is already in use. Close the other Coffice window or the Coffice web server, then open Coffice again. No running process has been stopped.",
    );
  }
  const serverRoot = app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "..", ".desktop-build", "server");
  const entry = path.join(serverRoot, "server.js");
  if (!existsSync(entry)) {
    throw new Error(
      "The bundled office is missing. Download a fresh copy of Coffice. Developers can run npm run desktop:prepare first.",
    );
  }
  const readinessProof = randomBytes(32).toString("hex");
  const environment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: "3003",
    NEXT_TELEMETRY_DISABLED: "1",
    COFFICE_DESKTOP: "1",
    COFFICE_DESKTOP_READY_TOKEN: readinessProof,
    COFFICE_DESKTOP_PARENT_PID: String(process.pid),
  };
  // The application runtime must not inherit developer-specific Node injection.
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  server = spawn(
    process.execPath,
    [path.join(__dirname, "server.cjs"), entry],
    {
      cwd: serverRoot,
      env: environment,
      windowsHide: true,
      stdio: "ignore",
    },
  );
  let startupFailure;
  server.once("error", () => {
    startupFailure = new Error(
      "Coffice could not start its local office service. Try reopening the application.",
    );
  });
  server.once("exit", () => {
    startupFailure = new Error(
      "Coffice’s local office service stopped. Try reopening the application.",
    );
    if (!quitting && window && window.webContents.getURL().startsWith(origin)) {
      void showFailure(startupFailure.message);
    }
  });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (startupFailure) throw startupFailure;
    try {
      const response = await fetch(`${origin}/api/desktop-ready`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (
        response.ok &&
        (await response.text()) === readinessProof &&
        !startupFailure
      )
        return;
    } catch {
      // The bundled server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    "Coffice took too long to open. Close the app and try again.",
  );
}

async function createWindow() {
  window = new BrowserWindow({
    title: "Coffice",
    width: 1440,
    height: 940,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#f5f4ec",
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  Menu.setApplicationMenu(null);
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      openAllowedExternal(url);
    }
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("before-input-event", (_event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === "q")
      app.quit();
  });
  window.once("ready-to-show", () => window.show());
  await window.loadFile(path.join(__dirname, "loading.html"));
  await startServer();
  await window.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("com.orangepropeller.coffice");
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    if (server && server.exitCode === null) server.kill();
  });
  app
    .whenReady()
    .then(createWindow)
    .catch(async (error) => {
      if (server && server.exitCode === null) server.kill();
      await showFailure(error.message);
    });
}
