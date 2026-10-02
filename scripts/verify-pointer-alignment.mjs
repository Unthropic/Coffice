import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright-core";

const BASE_URL = new URL(
  "/workbench",
  process.env.COFFICE_URL ?? "http://127.0.0.1:3003",
).href;
const OUTPUT_DIRECTORY = path.resolve(
  process.env.COFFICE_POINTER_ALIGNMENT_DIR ??
    "tmp/browser-acceptance/topdown-pointer",
);
const FIXTURE_ID = "synthetic-topdown-pointer-v1";
const TASK_COUNT = 6;
// Chromium dispatches pointer coordinates on whole CSS pixels. At the minimum
// supported 0.84 world scale, one rounded client pixel spans about 1.19 world
// units; the diagonal worst case is about 1.68 world units.
const WORLD_TOLERANCE = 1.75;
const MAPPED_POINT_TOLERANCE = 0.05;

function assertLocalAcceptanceUrl(value) {
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "3003") {
    throw new Error(
      `Pointer acceptance must run on http://127.0.0.1:3003 (received ${url.origin})`,
    );
  }
  return url.toString();
}

function syntheticFixture() {
  const observedAt = new Date().toISOString();
  const statuses = [
    "coding",
    "waiting_for_user",
    "reviewing",
    "idle",
    "completed",
    "planning",
  ];
  const tasks = statuses.map((value, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: `Pointer Agent ${String(index + 1).padStart(2, "0")}`,
    projectId: "pointer-office",
    kind: "temporary_worker",
    model: "acceptance-model",
    updatedAt: observedAt,
    status: {
      value,
      provenance: "observed",
      source: `acceptance:pointer:${value}`,
      timestamp: observedAt,
      stale: false,
      confidence: 1,
    },
  }));
  return {
    schemaVersion: "1.0",
    generatedAt: observedAt,
    source: {
      kind: "codex-local",
      health: "connected",
      lastReadAt: observedAt,
      pollIntervalMs: 60_000,
      freshness: "fresh",
      refreshState: "fresh",
      cacheAgeMs: 0,
      lastRefreshSuccessAt: observedAt,
    },
    projects: [
      {
        id: "pointer-office",
        name: "Pointer Office",
        order: 0,
        taskCount: tasks.length,
        activeTaskCount: 4,
        status: tasks[0].status,
      },
    ],
    tasks,
    diagnostics: [],
  };
}

function syntheticWorkspaceFixture(observedAt) {
  return {
    schemaVersion: 12,
    revision: 1,
    createdAt: observedAt,
    updatedAt: observedAt,
    projects: [],
    attentionReview: {
      version: 2,
      initializedAt: new Date(Date.parse(observedAt) - 60_000).toISOString(),
      dispositions: {},
      snoozedUntil: {},
    },
    reviewAssessments: [],
    decisionRequests: [],
    projectDecisionEvents: [],
    evidence: [],
    migrations: { attentionReviewV2ImportedAt: observedAt },
    mutationReceipts: [],
    verificationReceipts: [],
  };
}

function browserExecutable() {
  const candidates = [process.env.CHROME_PATH, process.env.EDGE_PATH];
  if (process.platform === "win32") {
    for (const root of [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ]) {
      if (!root) continue;
      candidates.push(
        path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  }
  const executable = candidates.filter(Boolean).find(existsSync);
  if (!executable) {
    throw new Error(
      "Chrome or Edge was not found. Set CHROME_PATH or EDGE_PATH to a Chromium executable.",
    );
  }
  return executable;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function attachErrorCapture(page) {
  const evidence = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    responseFailures: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") return;
    evidence.requestFailures.push({
      method: request.method(),
      url: request.url(),
      error: failure?.errorText ?? "unknown request failure",
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    evidence.responseFailures.push({
      status: response.status(),
      url: response.url(),
    });
  });
  return evidence;
}

async function installFixture(page) {
  const fixture = syntheticFixture();
  const fixtureState = { workspaceWriteCount: 0, codexMutationCount: 0 };
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/codex-actions" &&
      request.method() !== "GET" &&
      request.method() !== "HEAD"
    ) {
      fixtureState.codexMutationCount += 1;
    }
  });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "coffice.attention-review.v2",
      JSON.stringify({
        version: 2,
        initializedAt: "1970-01-01T00:00:00.000Z",
        dispositions: {},
        snoozedUntil: {},
      }),
    );
  });
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.route("**/api/workspace", (route) => {
    if (route.request().method() !== "GET") {
      fixtureState.workspaceWriteCount += 1;
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Unexpected synthetic workspace write.",
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: syntheticWorkspaceFixture(fixture.generatedAt),
        recovery: { kind: "none" },
        persistence: { persistent: true },
      }),
    });
  });
  return fixtureState;
}

async function enterOffice(page) {
  await page.goto(assertLocalAcceptanceUrl(BASE_URL), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForSelector("main", { timeout: 30_000 });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-product-office-renderer="topdown"]') ||
        document.querySelector(".project-building"),
      ),
    undefined,
    { timeout: 30_000 },
  );
  const door = page
    .locator(".project-building")
    .filter({ hasText: "Pointer Office" })
    .first();
  if (
    (await page.locator('[data-product-office-renderer="topdown"]').count()) ===
      0 &&
    (await door.count())
  ) {
    await door.click();
  }
  await page.waitForSelector('[data-product-office-renderer="topdown"]', {
    state: "visible",
    timeout: 30_000,
  });
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll("[data-desk-state]").length === expected &&
      document.querySelectorAll("[data-agent-state]").length === expected,
    TASK_COUNT,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(80);
}

async function selectMovableActor(page) {
  const actor = page.locator("[data-agent-state]").first();
  await actor.click();
  const inspector = page.locator('[data-review-act-inspector="true"]');
  if (await inspector.isVisible({ timeout: 300 }).catch(() => false)) {
    throw new Error(
      "Selecting a world actor opened Review & Act and blocked direct click-to-move",
    );
  }
  const selectionRetained =
    (await actor.getAttribute("aria-pressed")) === "true";
  if (!selectionRetained) {
    throw new Error(
      "The world actor did not remain selected for click-to-move",
    );
  }
  return { actor, selectionRetained };
}

async function waitForWorldLayout(page) {
  await page.waitForFunction(() => {
    const stage = document.querySelector("[data-world-scale]");
    const room = document.querySelector('[data-topdown-room="true"]');
    if (!stage || !room) return false;
    const scale = Number(stage.getAttribute("data-world-scale"));
    const width = Number(stage.getAttribute("data-world-width"));
    const height = Number(stage.getAttribute("data-world-height"));
    const bounds = room.getBoundingClientRect();
    return (
      Number.isFinite(scale) &&
      scale > 0 &&
      Math.abs(bounds.width / width - scale) <= 0.002 &&
      Math.abs(bounds.height / height - scale) <= 0.002
    );
  });
}

async function inspectWorkflowAreas(page) {
  const expected = {
    "Pointer Agent 01": "desk",
    "Pointer Agent 02": "meeting",
    "Pointer Agent 03": "desk",
    "Pointer Agent 04": "desk",
    "Pointer Agent 05": "review",
    "Pointer Agent 06": "desk",
  };
  await page.waitForFunction(
    (assignments) => {
      const actors = Array.from(
        document.querySelectorAll("[data-agent-state]"),
      );
      return Object.entries(assignments).every(([name, area]) => {
        const actor = actors.find((candidate) =>
          candidate.getAttribute("aria-label")?.startsWith(`${name}, `),
        );
        return (
          actor?.getAttribute("data-desired-area") === area &&
          actor.getAttribute("data-settled-area") === area &&
          !actor.hasAttribute("data-heading-area") &&
          actor.getAttribute("data-motion-phase") !== "walking"
        );
      });
    },
    expected,
    { timeout: 12_000 },
  );
  return page.evaluate((assignments) => {
    const room = document.querySelector('[data-topdown-room="true"]');
    const roomBounds = room?.getBoundingClientRect();
    const actors = Array.from(document.querySelectorAll("[data-agent-state]"));
    const actual = Object.fromEntries(
      Object.keys(assignments).map((name) => {
        const actor = actors.find((candidate) =>
          candidate.getAttribute("aria-label")?.startsWith(`${name}, `),
        );
        return [
          name,
          actor
            ? {
                desired: actor.getAttribute("data-desired-area"),
                heading: actor.getAttribute("data-heading-area"),
                settled: actor.getAttribute("data-settled-area"),
                motion: actor.getAttribute("data-motion-phase"),
              }
            : null,
        ];
      }),
    );
    const zones = Object.fromEntries(
      ["meeting", "review"].map((area) => {
        const element = document.querySelector(
          `[data-workflow-area="${area}"]`,
        );
        const bounds = element?.getBoundingClientRect();
        return [
          area,
          {
            title: element?.children[0]?.textContent?.trim() ?? null,
            purpose: element?.children[1]?.textContent?.trim() ?? null,
            count: element?.getAttribute("data-workflow-assigned-count"),
            withinRoom: Boolean(
              bounds &&
              roomBounds &&
              bounds.left >= roomBounds.left - 1 &&
              bounds.top >= roomBounds.top - 1 &&
              bounds.right <= roomBounds.right + 1 &&
              bounds.bottom <= roomBounds.bottom + 1,
            ),
          },
        ];
      }),
    );
    return { expected: assignments, actual, zones };
  }, expected);
}

async function scrollWorldPointIntoView(page, target) {
  return page.evaluate(({ x, y }) => {
    const room = document.querySelector('[data-topdown-room="true"]');
    const stage = room?.parentElement;
    const viewport = stage?.parentElement;
    if (!room || !stage || !viewport) {
      throw new Error("top-down room viewport is unavailable");
    }
    const worldWidth = Number(stage.getAttribute("data-world-width"));
    const worldHeight = Number(stage.getAttribute("data-world-height"));
    const roomBounds = room.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    const targetClient = {
      x: roomBounds.left + (x / worldWidth) * roomBounds.width,
      y: roomBounds.top + (y / worldHeight) * roomBounds.height,
    };
    viewport.scrollLeft +=
      targetClient.x - (viewportBounds.left + viewportBounds.width / 2);
    viewport.scrollTop +=
      targetClient.y - (viewportBounds.top + viewportBounds.height / 2);
    const scrolledRoomBounds = room.getBoundingClientRect();
    const scrolledTargetX =
      scrolledRoomBounds.left + (x / worldWidth) * scrolledRoomBounds.width;
    const visibleTargetY =
      scrolledRoomBounds.top + (y / worldHeight) * scrolledRoomBounds.height;
    return {
      requested: { x, y },
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      maxScrollLeft: viewport.scrollWidth - viewport.clientWidth,
      maxScrollTop: viewport.scrollHeight - viewport.clientHeight,
      targetWithinRoomViewport:
        scrolledTargetX >= viewportBounds.left + 1 &&
        scrolledTargetX <= viewportBounds.right - 1 &&
        visibleTargetY >= viewportBounds.top + 1 &&
        visibleTargetY <= viewportBounds.bottom - 1,
      documentScrollY: window.scrollY,
    };
  }, target);
}

async function measureTransform(page) {
  return page.evaluate(() => {
    const room = document.querySelector('[data-topdown-room="true"]');
    const stage = room?.parentElement;
    if (!room || !stage) throw new Error("top-down world is unavailable");
    const bounds = room.getBoundingClientRect();
    const worldWidth = Number(stage.getAttribute("data-world-width"));
    const worldHeight = Number(stage.getAttribute("data-world-height"));
    const declaredScale = Number(stage.getAttribute("data-world-scale"));
    const chairs = Array.from(
      document.querySelectorAll("[data-chair-state]"),
    ).map((element) => {
      const chair = element.getBoundingClientRect();
      return chair.height ? chair.width / chair.height : 0;
    });
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      worldWidth,
      worldHeight,
      declaredScale,
      widthScale: bounds.width / worldWidth,
      heightScale: bounds.height / worldHeight,
      chairRatios: chairs,
      documentScroll: { x: window.scrollX, y: window.scrollY },
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      visualViewportScale: window.visualViewport?.scale ?? 1,
    };
  });
}

async function actorWorldPoint(actor) {
  return actor.evaluate((element) => ({
    x: Number.parseFloat(element.style.getPropertyValue("--worker-x")),
    y: Number.parseFloat(element.style.getPropertyValue("--worker-y")),
    phase: element.getAttribute("data-motion-phase"),
    selected: element.getAttribute("aria-pressed") === "true",
  }));
}

async function clickWorldPoint(page, actor, target) {
  const scroll = await scrollWorldPointIntoView(page, target);
  await page.waitForTimeout(40);
  const before = await actorWorldPoint(actor);
  const transform = await measureTransform(page);
  const clientPoint = {
    x: Math.round(
      transform.left + (target.x / transform.worldWidth) * transform.width,
    ),
    y: Math.round(
      transform.top + (target.y / transform.worldHeight) * transform.height,
    ),
  };
  const inversePoint = {
    x:
      ((clientPoint.x - transform.left) / transform.width) *
      transform.worldWidth,
    y:
      ((clientPoint.y - transform.top) / transform.height) *
      transform.worldHeight,
  };
  const hitTarget = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return {
      tag: element?.tagName.toLocaleLowerCase() ?? null,
      obstacle: Boolean(element?.closest("[data-world-obstacle]")),
      button: Boolean(element?.closest("button")),
      insideRoom: Boolean(element?.closest('[data-topdown-room="true"]')),
    };
  }, clientPoint);
  if (!hitTarget.insideRoom || hitTarget.obstacle || hitTarget.button) {
    throw new Error(
      `World target ${target.x},${target.y} is not an open clickable floor point after layout: ${JSON.stringify({ hitTarget, clientPoint, scroll, viewport: transform.viewport })}`,
    );
  }
  await page.mouse.click(clientPoint.x, clientPoint.y);
  try {
    await page.waitForFunction(
      ({ x, y, tolerance }) => {
        const selected = document.querySelector(
          '[data-agent-state][aria-pressed="true"]',
        );
        if (!selected) return false;
        const actorX = Number.parseFloat(
          selected.style.getPropertyValue("--worker-x"),
        );
        const actorY = Number.parseFloat(
          selected.style.getPropertyValue("--worker-y"),
        );
        return (
          Math.hypot(actorX - x, actorY - y) <= tolerance &&
          selected.getAttribute("data-motion-phase") !== "walking"
        );
      },
      { ...inversePoint, tolerance: MAPPED_POINT_TOLERANCE },
      { timeout: 12_000 },
    );
  } catch {
    const observed = await actorWorldPoint(actor);
    throw new Error(
      `Selected actor did not settle at mapped point ${inversePoint.x},${inversePoint.y}: ${JSON.stringify(observed)}`,
    );
  }
  const after = await actorWorldPoint(actor);
  const marker = await page
    .locator("[data-marker-tone]")
    .first()
    .evaluate((element) => ({
      tone: element.getAttribute("data-marker-tone"),
      x: Number.parseFloat(element.style.getPropertyValue("--marker-x")),
      y: Number.parseFloat(element.style.getPropertyValue("--marker-y")),
    }));
  const failures = [];
  if (!hitTarget.insideRoom) failures.push("click target was outside the room");
  if (hitTarget.obstacle) failures.push("click target intersected furniture");
  if (hitTarget.button)
    failures.push("click target intersected an interactive control");
  if (!scroll.targetWithinRoomViewport) {
    failures.push("room scrolling did not bring the click target into view");
  }
  if (
    Math.abs(transform.documentScroll.x) > 1 ||
    Math.abs(transform.documentScroll.y) > 1
  ) {
    failures.push("the document scrolled while navigating the room viewport");
  }
  if (distance(inversePoint, target) > WORLD_TOLERANCE) {
    failures.push(
      `client/world inverse error was ${distance(inversePoint, target)}`,
    );
  }
  if (distance(after, inversePoint) > MAPPED_POINT_TOLERANCE) {
    failures.push(
      `actor stopped ${distance(after, inversePoint)} world units from the mapped click`,
    );
  }
  if (
    distance(marker, inversePoint) > MAPPED_POINT_TOLERANCE ||
    marker.tone !== "route"
  ) {
    failures.push(
      "destination marker did not preserve the accepted world target",
    );
  }
  if (!after.selected)
    failures.push("actor selection was lost during movement");
  if (Math.abs(transform.widthScale - transform.heightScale) > 0.002) {
    failures.push("world scale became non-uniform");
  }
  if (
    Math.max(
      Math.abs(transform.widthScale - transform.declaredScale),
      Math.abs(transform.heightScale - transform.declaredScale),
    ) > 0.002
  ) {
    failures.push("rendered world scale disagreed with its declared scale");
  }
  if (transform.chairRatios.some((ratio) => Math.abs(ratio - 1) > 0.02)) {
    failures.push("a circular chair became elliptical");
  }
  return {
    target,
    before,
    after,
    clientPoint,
    inversePoint,
    marker,
    hitTarget,
    scroll,
    transform,
    errors: {
      inverse: distance(inversePoint, target),
      actor: distance(after, inversePoint),
      actorToRequested: distance(after, target),
      marker: distance(marker, inversePoint),
    },
    failures,
  };
}

async function runCase(page, actor, definition, screenshots) {
  if (definition.viewport) {
    await page.setViewportSize(definition.viewport);
  }
  if (definition.before) await definition.before();
  await waitForWorldLayout(page);
  const result = await clickWorldPoint(page, actor, definition.target);
  screenshots.set(definition.id, await page.screenshot({ fullPage: false }));
  return { id: definition.id, ...result };
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const executablePath = browserExecutable();
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--disable-software-rasterizer"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = attachErrorCapture(page);
const screenshots = new Map();
const cases = [];
let selection = null;
let fatalFailure = null;
let zoomEvidence = null;
let workflowEvidence = null;
let fixtureState = null;

try {
  fixtureState = await installFixture(page);
  await enterOffice(page);
  workflowEvidence = await inspectWorkflowAreas(page);
  selection = await selectMovableActor(page);
  cases.push(
    await runCase(
      page,
      selection.actor,
      {
        id: "desktop-scroll",
        viewport: { width: 1280, height: 720 },
        target: { x: 600, y: 850 },
      },
      screenshots,
    ),
  );
  cases.push(
    await runCase(
      page,
      selection.actor,
      {
        id: "portrait-resize-scroll",
        viewport: { width: 390, height: 844 },
        target: { x: 760, y: 720 },
      },
      screenshots,
    ),
  );
  cases.push(
    await runCase(
      page,
      selection.actor,
      {
        id: "short-landscape-room-scroll",
        viewport: { width: 844, height: 390 },
        target: { x: 520, y: 850 },
      },
      screenshots,
    ),
  );

  await page.setViewportSize({ width: 1280, height: 720 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1024,
    height: 576,
    deviceScaleFactor: 1.25,
    mobile: false,
  });
  zoomEvidence = {
    mode: "CDP Emulation.setDeviceMetricsOverride",
    requestedZoom: 1.25,
    cssViewport: { width: 1024, height: 576 },
    deviceScaleFactor: 1.25,
  };
  cases.push(
    await runCase(
      page,
      selection.actor,
      {
        id: "browser-zoom-125-scroll",
        target: { x: 780, y: 760 },
      },
      screenshots,
    ),
  );
} catch (error) {
  fatalFailure = error instanceof Error ? error.message : String(error);
  screenshots.set(
    "pointer-error",
    await page.screenshot({ fullPage: false }).catch(() => Buffer.from("")),
  );
} finally {
  await context.close();
  await browser.close();
}

await Promise.all(
  [...screenshots]
    .filter(([, contents]) => contents.length > 0)
    .map(([name, contents]) =>
      writeFile(path.join(OUTPUT_DIRECTORY, `${name}.png`), contents),
    ),
);

const failures = [
  ...(fatalFailure ? [fatalFailure] : []),
  ...cases.flatMap((entry) =>
    entry.failures.map((failure) => `${entry.id}: ${failure}`),
  ),
  ...(errors.consoleErrors.length
    ? ["browser console errors were reported"]
    : []),
  ...(errors.pageErrors.length ? ["uncaught page errors were reported"] : []),
  ...(errors.requestFailures.length ? ["network requests failed"] : []),
  ...(errors.responseFailures.length
    ? ["HTTP error responses were reported"]
    : []),
  ...(!workflowEvidence
    ? ["workflow-area evidence was unavailable"]
    : Object.entries(workflowEvidence.expected).flatMap(([name, area]) => {
        const actor = workflowEvidence.actual[name];
        return actor?.desired === area &&
          actor?.heading === null &&
          actor?.settled === area &&
          actor?.motion !== "walking"
          ? []
          : [`${name} did not settle in its exact Current Attention area`];
      })),
  ...(workflowEvidence &&
  workflowEvidence.zones.meeting.title === "Meeting area" &&
  workflowEvidence.zones.meeting.purpose ===
    "Current Attention · needs reply" &&
  workflowEvidence.zones.meeting.count === "1" &&
  workflowEvidence.zones.meeting.withinRoom &&
  workflowEvidence.zones.review.title === "Review area" &&
  workflowEvidence.zones.review.purpose ===
    "Current Attention · exact result to review" &&
  workflowEvidence.zones.review.count === "1" &&
  workflowEvidence.zones.review.withinRoom
    ? []
    : ["named workflow areas were missing, miscounted, or outside the room"]),
  ...(fixtureState?.workspaceWriteCount === 0
    ? []
    : ["workflow and pointer acceptance attempted a workspace write"]),
  ...(fixtureState?.codexMutationCount === 0
    ? []
    : ["workflow and pointer acceptance sent a Codex mutation"]),
];
const report = {
  checkedAt: new Date().toISOString(),
  url: assertLocalAcceptanceUrl(BASE_URL),
  browser: path.basename(executablePath),
  fixture: FIXTURE_ID,
  privacy:
    "Screenshots and report contain synthetic structural fixture data only.",
  tolerance: WORLD_TOLERANCE,
  selection: selection
    ? { selectionRetained: selection.selectionRetained }
    : null,
  zoomEvidence,
  workflowEvidence,
  sideEffects: fixtureState,
  cases,
  errors,
  failures,
};
await writeFile(
  path.join(OUTPUT_DIRECTORY, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

for (const entry of cases) {
  const statusLabel = entry.failures.length ? "FAIL" : "PASS";
  console.log(
    `${statusLabel} ${entry.id}: actor error ${entry.errors.actor.toFixed(3)}, inverse error ${entry.errors.inverse.toFixed(3)}`,
  );
}
for (const failure of failures) console.error(`FAIL ${failure}`);
if (failures.length) process.exitCode = 1;
else {
  console.log(
    "Top-down pointer alignment passed through live resize, room scrolling within a fixed document, and 125% browser zoom emulation.",
  );
}
