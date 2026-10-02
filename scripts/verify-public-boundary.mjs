import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import { verifyProductionAssets } from "./verify-assets.mjs";

const root = path.resolve(import.meta.dirname, "..");
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SECRET_SCAN_BYTES = 2 * 1024 * 1024;
const forbiddenParts = new Set([
  ".agents",
  ".pi",
  ".pi-subagents",
  ".tmp",
  "concepts",
  "internal",
  "prompts",
  "raw-assets",
  "references",
  "tmp",
  "temp",
]);
const forbiddenNames = new Set(["agents.md", "claude.md", ".env"]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/u,
  /\bsk-[A-Za-z0-9]{20,}\b/u,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"']{8,}["']/iu,
];

function gitFiles() {
  return execFileSync(
    "git",
    ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  )
    .split(/\r?\n/u)
    .map((file) => file.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .filter((file) => existsSync(path.join(root, file)))
    .sort();
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function containsSecretLikeContent(buffer) {
  if (buffer.length > MAX_SECRET_SCAN_BYTES || buffer.includes(0)) return false;
  const contents = buffer.toString("utf8");
  const replacementCharacters = contents.match(/\uFFFD/gu)?.length ?? 0;
  if (replacementCharacters > Math.max(1, contents.length / 1_000))
    return false;
  return secretPatterns.some((pattern) => pattern.test(contents));
}

export function hasForbiddenProductPath(relative) {
  const parts = relative.replaceAll("\\", "/").split("/");
  const normalizedParts = parts.map((part) => part.toLocaleLowerCase("en-US"));
  return (
    normalizedParts.some((part) => forbiddenParts.has(part)) ||
    forbiddenNames.has(normalizedParts.at(-1))
  );
}

export function parseAssetManifest(contents) {
  const rows = new Map();
  const failures = [];
  for (const line of contents.split(/\r?\n/u)) {
    const pathMatch = line.match(/`(public\/assets\/[^`]+)`/u);
    if (!pathMatch) continue;
    const relative = pathMatch[1];
    const digestMatch = line.match(/`([0-9a-f]{64})`/u);
    if (!digestMatch) {
      failures.push(`manifest row has no SHA-256: ${relative}`);
      continue;
    }
    if (rows.has(relative)) {
      failures.push(`duplicate manifest asset: ${relative}`);
      continue;
    }
    rows.set(relative, digestMatch[1]);
  }
  return { rows, failures };
}

export function releaseDocumentationFailures({
  packageJson,
  readme,
  security,
  contributing,
  assetLicense,
  availableFiles,
}) {
  const failures = [];
  const requiredFiles = ["CHANGELOG.md", "LICENSE", "docs/operations.md"];
  for (const required of requiredFiles) {
    if (!availableFiles.includes(required))
      failures.push(`required release file missing: ${required}`);
  }
  let metadata;
  try {
    metadata = JSON.parse(packageJson);
  } catch {
    failures.push("package.json is not valid JSON");
    return failures;
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(metadata.version ?? "")) {
    failures.push("package version is not a release-shaped semantic version");
  }
  if (metadata.license !== "Apache-2.0") {
    failures.push("package license is not Apache-2.0");
  }
  if (typeof metadata.author !== "string" || !metadata.author.trim()) {
    failures.push("package author identity is missing");
  }
  if (metadata.private !== true) {
    failures.push("source-distributed package must remain private on npm");
  }
  const stalePhrases = [
    "not yet ready for a public release",
    "a code license still needs to be selected",
    "no code license is granted",
  ];
  const publicPolicy = `${readme}\n${security}\n${contributing}`.toLowerCase();
  for (const phrase of stalePhrases) {
    if (publicPolicy.includes(phrase))
      failures.push(`stale release policy phrase: ${phrase}`);
  }
  if (!readme.includes("Apache License 2.0"))
    failures.push(
      "README does not identify the code and documentation license",
    );
  if (!/source-distributed release\s+candidate/u.test(readme))
    failures.push("README does not state the release distribution model");
  if (!security.includes("Codex App Server"))
    failures.push(
      "SECURITY.md does not describe the supported action boundary",
    );
  if (!contributing.includes("explicit user confirmation"))
    failures.push("CONTRIBUTING.md does not require confirmation for controls");
  const normalizedAssetLicense = assetLicense.toLowerCase();
  if (
    !normalizedAssetLicense.includes("apache license 2.0") ||
    (!normalizedAssetLicense.includes("excluded from the apache license 2.0") &&
      !/does not apply to these excluded\s+assets/u.test(
        normalizedAssetLicense,
      ))
  ) {
    failures.push("artwork license does not state its Apache-2.0 exclusion");
  }
  if (normalizedAssetLicense.includes("coffice project owner")) {
    failures.push("artwork copyright holder is still generic");
  }
  return failures;
}

export function verifyPublicBoundary() {
  const failures = [];
  const files = gitFiles();
  for (const relative of files) {
    if (hasForbiddenProductPath(relative)) {
      failures.push(`forbidden path or filename: ${relative}`);
    }
    const absolute = path.join(root, relative);
    const size = statSync(absolute).size;
    if (size > MAX_FILE_BYTES)
      failures.push(`file exceeds 10 MiB: ${relative}`);
    if (
      size <= MAX_SECRET_SCAN_BYTES &&
      containsSecretLikeContent(readFileSync(absolute))
    ) {
      failures.push(`secret-like content: ${relative}`);
    }
  }

  const assetManifest = readFileSync(
    path.join(root, "docs", "pixel-assets.md"),
    "utf8",
  );
  const manifest = parseAssetManifest(assetManifest);
  failures.push(...manifest.failures);
  const assets = files.filter((file) => file.startsWith("public/assets/"));
  for (const relative of assets) {
    const expectedDigest = manifest.rows.get(relative);
    if (!expectedDigest) {
      failures.push(`asset missing from manifest: ${relative}`);
      continue;
    }
    if (sha256(path.join(root, relative)) !== expectedDigest) {
      failures.push(`asset hash mismatch: ${relative}`);
    }
  }
  for (const relative of manifest.rows.keys()) {
    if (!assets.includes(relative))
      failures.push(`manifest asset missing: ${relative}`);
  }
  const productionAssets = verifyProductionAssets();
  failures.push(
    ...productionAssets.failures.map((failure) => `asset policy: ${failure}`),
  );
  failures.push(
    ...releaseDocumentationFailures({
      packageJson: readFileSync(path.join(root, "package.json"), "utf8"),
      readme: readFileSync(path.join(root, "README.md"), "utf8"),
      security: readFileSync(path.join(root, "SECURITY.md"), "utf8"),
      contributing: readFileSync(path.join(root, "CONTRIBUTING.md"), "utf8"),
      assetLicense: readFileSync(path.join(root, "ASSET-LICENSE.md"), "utf8"),
      availableFiles: files,
    }),
  );

  return { failures, fileCount: files.length, assetCount: assets.length };
}

function main() {
  const result = verifyPublicBoundary();
  if (result.failures.length) {
    console.error("Public-boundary verification failed:");
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Public-boundary verification passed: ${result.fileCount} candidate files, ${result.assetCount} manifested assets`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
