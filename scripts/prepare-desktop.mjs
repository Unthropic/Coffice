import { cp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".desktop-build");
const server = path.join(output, "server");
await mkdir(output, { recursive: true });
// This directory contains generated build output only.
await rm(server, { recursive: true, force: true });
const standalone = path.join(root, ".next", "standalone");
await mkdir(server, { recursive: true });
// Dynamic filesystem access can cause Next tracing to include local fixtures.
// Copy only the runtime roots; never copy the whole traced directory blindly.
for (const entry of [".next", "node_modules", "package.json", "server.js"]) {
  await cp(path.join(standalone, entry), path.join(server, entry), {
    recursive: true,
  });
}
await cp(
  path.join(root, ".next", "static"),
  path.join(server, ".next", "static"),
  { recursive: true },
);
await cp(path.join(root, "public"), path.join(server, "public"), {
  recursive: true,
});

async function cleanBuildMetadata(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") await cleanBuildMetadata(file);
    } else if (
      entry.name.endsWith(".map") ||
      entry.name.endsWith(".nft.json")
    ) {
      await rm(file);
    } else if (/\.(?:json|js|html)$/.test(entry.name)) {
      const original = await readFile(file, "utf8");
      const normalized = original
        .replaceAll(JSON.stringify(root).slice(1, -1), ".")
        .replaceAll(root.replaceAll("\\", "/"), ".");
      if (normalized !== original) await writeFile(file, normalized);
    }
  }
}
await cleanBuildMetadata(server);

const svg = await readFile(path.join(root, "src", "app", "icon.svg"));
const png = await sharp(svg).resize(256, 256).png().toBuffer();
await writeFile(path.join(root, "desktop", "icon.png"), png);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile(path.join(output, "icon.ico"), Buffer.concat([header, png]));
console.log("Desktop server and native icon prepared.");
