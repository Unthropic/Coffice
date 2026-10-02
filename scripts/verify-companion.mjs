import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";

const origin = "http://127.0.0.1:3003";
const output = path.resolve("tmp/companion-acceptance");
const executablePath = [
  process.env.CHROME_PATH,
  process.env.EDGE_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((candidate) => candidate && existsSync(candidate));
assert(executablePath, "Chrome or Edge is required for browser verification.");

const timestamp = new Date().toISOString();
const fixture = {
  schemaVersion: "1.0",
  generatedAt: timestamp,
  source: {
    kind: "codex-local",
    health: "connected",
    freshness: "fresh",
    refreshState: "fresh",
    cacheAgeMs: 0,
    lastReadAt: timestamp,
    lastRefreshSuccessAt: timestamp,
    pollIntervalMs: 3000,
  },
  projects: [
    { id: "garden", name: "The little garden", order: 0 },
    { id: "empty", name: "A new beginning", order: 1 },
  ],
  tasks: [
    "coding",
    "thinking",
    "completed",
    "waiting_for_user",
    "idle",
    "researching",
  ].map((value, i) => ({
    id: `companion-test-${i}`,
    title: [
      "Plant a small idea",
      "Find a lovely name",
      "Finish the morning sketch",
      "Choose a shade of green",
      "Keep the kettle company",
      "Explore a new path",
    ][i],
    projectId: "garden",
    assignmentEvidence: "explicit_project",
    kind: "temporary_worker",
    updatedAt: timestamp,
    status: {
      value,
      provenance: "observed",
      source: "test:lifecycle",
      timestamp,
      stale: false,
      confidence: 1,
    },
  })),
  diagnostics: [],
};

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 700 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    const writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith("/api/") &&
        !["GET", "HEAD"].includes(request.method())
      )
        writes.push(request.url());
    });
    await page.route("**/api/companion", (route) =>
      route.fulfill({ json: fixture }),
    );
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "The little garden", exact: true })
      .waitFor();
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollY,
    }));
    assert(
      bounds.scrollWidth <= bounds.width + 1,
      "Companion causes horizontal page overflow.",
    );
    assert(
      bounds.scrollHeight <= bounds.height + 1,
      "Companion causes vertical page overflow.",
    );
    await page.getByRole("button", { name: "Visit the demo" }).click();
    await page
      .getByRole("heading", { name: "The Sunday studio", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Pet the office cat" }).click();
    await page
      .getByText("The office cat approves.", { exact: true })
      .waitFor({ state: "attached" });
    await page.getByRole("button", { name: "Switch to evening" }).click();
    await page.getByRole("button", { name: "Switch to daylight" }).waitFor();
    await page.screenshot({
      path: path.join(output, `${viewport.width}-evening.png`),
    });
    await page.getByRole("button", { name: "Switch to daylight" }).click();
    await page
      .getByRole("button", { name: "Juniper: Coding", exact: true })
      .click();
    await page
      .getByRole("complementary", { name: "Selected companion" })
      .waitFor();
    await page.getByRole("button", { name: "Close companion details" }).click();
    await page
      .getByRole("button", { name: "Brew a round", exact: true })
      .click();
    await page.screenshot({
      path: path.join(output, `${viewport.width}-demo.png`),
    });
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const violations = accessibility.violations.map((item) => ({
      id: item.id,
      impact: item.impact,
      count: item.nodes.length,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    }));
    assert.equal(errors.length, 0, "Unexpected browser error.");
    assert.equal(writes.length, 0, "Companion sent a write request.");
    results.push({
      viewport,
      bounds,
      violations,
      errors,
      writeCount: writes.length,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  path.join(output, "report.json"),
  JSON.stringify(results, null, 2),
);
const violations = results.flatMap((result) => result.violations);
console.log(JSON.stringify(results, null, 2));
assert.equal(violations.length, 0, "Accessibility violations need review.");
console.log(
  "Companion passed viewport, interaction, privacy, and accessibility checks.",
);
