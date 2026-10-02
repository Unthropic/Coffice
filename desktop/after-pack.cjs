/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads a CommonJS hook. */
const { cp, access } = require("node:fs/promises");
const path = require("node:path");

module.exports = async function copyStandalone(context) {
  const source = path.join(
    context.packager.projectDir,
    ".desktop-build",
    "server",
  );
  await access(path.join(source, "node_modules", "next", "package.json"));
  // Next's traced runtime is copied intact: builder's generic resource filter
  // otherwise drops node_modules directories, including nested dependencies.
  await cp(source, path.join(context.appOutDir, "resources", "server"), {
    recursive: true,
  });
};
