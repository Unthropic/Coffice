import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { inflateSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const disallowedPngChunks = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "iCCP"]);

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : [absolute];
  });
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function parseProductionAssetRows(contents) {
  const rows = new Map();
  const failures = [];
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(
      /^\|\s*`(public\/assets\/[^`]+)`\s*\|\s*([^|]+?)\s*\|\s*`([0-9a-f]{64})`\s*\|/u,
    );
    if (!match) continue;
    const [, relative, dimensionText, digest] = match;
    const dimensions = dimensionText.match(/(\d+)\s*[×x]\s*(\d+)/u);
    if (!dimensions) {
      failures.push(`asset manifest dimensions are invalid: ${relative}`);
      continue;
    }
    if (rows.has(relative)) {
      failures.push(`duplicate asset manifest row: ${relative}`);
      continue;
    }
    rows.set(relative, {
      width: Number.parseInt(dimensions[1], 10),
      height: Number.parseInt(dimensions[2], 10),
      digest,
    });
  }
  return { rows, failures };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Structurally parses and inflates the released RGBA PNG rather than trusting
 * only its signature/IHDR. This rejects truncation, corrupt chunks, trailing
 * payloads, unsupported encodings, and malformed scanline data. */
export function inspectPng(buffer, relative, expected, failures) {
  if (
    buffer.length < 33 ||
    buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  ) {
    failures.push(`invalid PNG signature or structure: ${relative}`);
    return;
  }

  let offset = 8;
  let chunkIndex = 0;
  let width = 0;
  let height = 0;
  let sawIdat = false;
  let sawIend = false;
  const idat = [];
  const knownCritical = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      failures.push(`truncated PNG chunk header: ${relative}`);
      break;
    }
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) {
      failures.push(`truncated PNG chunk payload: ${relative}`);
      break;
    }
    const typeBuffer = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const storedCrc = buffer.readUInt32BE(dataEnd);
    const computedCrc = crc32(buffer.subarray(offset + 4, dataEnd));
    if (storedCrc !== computedCrc) {
      failures.push(`PNG chunk CRC mismatch (${type}): ${relative}`);
    }
    if (!/^[A-Za-z]{4}$/u.test(type)) {
      failures.push(`invalid PNG chunk type: ${relative}`);
    }
    if (type[0] === type[0]?.toUpperCase() && !knownCritical.has(type)) {
      failures.push(`unsupported critical PNG chunk ${type}: ${relative}`);
    }
    if (disallowedPngChunks.has(type)) {
      failures.push(`disallowed PNG metadata chunk ${type}: ${relative}`);
    }

    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) {
      failures.push(`PNG must begin with a 13-byte IHDR: ${relative}`);
    }
    if (type === "IHDR") {
      if (chunkIndex !== 0 || length !== 13) {
        failures.push(`invalid PNG IHDR placement: ${relative}`);
      } else {
        width = buffer.readUInt32BE(dataStart);
        height = buffer.readUInt32BE(dataStart + 4);
        const bitDepth = buffer[dataStart + 8];
        const colorType = buffer[dataStart + 9];
        const compression = buffer[dataStart + 10];
        const filter = buffer[dataStart + 11];
        const interlace = buffer[dataStart + 12];
        if (
          width === 0 ||
          height === 0 ||
          bitDepth !== 8 ||
          colorType !== 6 ||
          compression !== 0 ||
          filter !== 0 ||
          interlace !== 0
        ) {
          failures.push(
            `unsupported PNG encoding (expected RGBA8): ${relative}`,
          );
        }
        if (width !== expected.width || height !== expected.height) {
          failures.push(
            `asset dimensions mismatch: ${relative} expected ${expected.width}x${expected.height}, received ${width}x${height}`,
          );
        }
      }
    } else if (type === "IDAT") {
      if (sawIend) failures.push(`PNG IDAT follows IEND: ${relative}`);
      sawIdat = true;
      idat.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      if (length !== 0) failures.push(`PNG IEND must be empty: ${relative}`);
      sawIend = true;
      offset = dataEnd + 4;
      break;
    }

    offset = dataEnd + 4;
    chunkIndex += 1;
  }

  if (!sawIdat) failures.push(`PNG has no IDAT data: ${relative}`);
  if (!sawIend) failures.push(`PNG has no IEND chunk: ${relative}`);
  if (sawIend && offset !== buffer.length) {
    failures.push(`PNG has trailing data after IEND: ${relative}`);
  }
  if (!width || !height || !sawIdat) return;

  try {
    const decoded = inflateSync(Buffer.concat(idat));
    const rowBytes = width * 4;
    const expectedBytes = height * (rowBytes + 1);
    if (decoded.length !== expectedBytes) {
      failures.push(
        `PNG decoded byte length mismatch: ${relative} expected ${expectedBytes}, received ${decoded.length}`,
      );
      return;
    }
    for (let row = 0; row < height; row += 1) {
      const filter = decoded[row * (rowBytes + 1)];
      if (filter > 4) {
        failures.push(`PNG scanline has invalid filter ${filter}: ${relative}`);
        break;
      }
    }
  } catch {
    failures.push(`PNG IDAT data cannot be decoded: ${relative}`);
  }
}

export function inspectSvg(buffer, relative, expected, failures) {
  const contents = buffer.toString("utf8");
  if (
    /<script\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|data:)/iu.test(
      contents,
    )
  ) {
    failures.push(`unsafe SVG content: ${relative}`);
  }
  const viewBox = contents.match(
    /viewBox\s*=\s*["']\s*0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)["']/u,
  );
  if (
    !viewBox ||
    Number(viewBox[1]) !== expected.width ||
    Number(viewBox[2]) !== expected.height
  ) {
    failures.push(`SVG viewBox dimensions mismatch: ${relative}`);
  }
}

export function verifyProductionAssets() {
  const failures = [];
  const manifestText = readFileSync(
    path.join(root, "docs", "pixel-assets.md"),
    "utf8",
  );
  const manifest = parseProductionAssetRows(manifestText);
  failures.push(...manifest.failures);
  const assetRoot = path.join(root, "public", "assets");
  const assetFiles = walkFiles(assetRoot)
    .map((absolute) => path.relative(root, absolute).replaceAll("\\", "/"))
    .sort();
  const consumerText = walkFiles(path.join(root, "src"))
    .concat(walkFiles(path.join(root, "tests")))
    .filter((file) => !statSync(file).isDirectory())
    .map((file) => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");

  for (const relative of assetFiles) {
    const expected = manifest.rows.get(relative);
    if (!expected) {
      failures.push(`asset missing from production manifest: ${relative}`);
      continue;
    }
    const absolute = path.join(root, relative);
    const buffer = readFileSync(absolute);
    if (sha256(absolute) !== expected.digest) {
      failures.push(`asset hash mismatch: ${relative}`);
    }
    if (relative.endsWith(".png")) {
      inspectPng(buffer, relative, expected, failures);
    } else if (relative.endsWith(".svg")) {
      inspectSvg(buffer, relative, expected, failures);
    } else {
      failures.push(`unsupported production asset type: ${relative}`);
    }
    const filename = path.basename(relative);
    if (!consumerText.includes(filename)) {
      failures.push(`asset has no source or test consumer: ${relative}`);
    }
  }
  for (const relative of manifest.rows.keys()) {
    if (!assetFiles.includes(relative)) {
      failures.push(`manifest asset is missing: ${relative}`);
    }
  }

  return { failures, assetCount: assetFiles.length };
}

function main() {
  const result = verifyProductionAssets();
  if (result.failures.length) {
    console.error("Production asset verification failed:");
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Production asset verification passed: ${result.assetCount} assets with exact hashes, dimensions, metadata policy, and consumers`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
