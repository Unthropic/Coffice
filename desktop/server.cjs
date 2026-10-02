/* eslint-disable @typescript-eslint/no-require-imports -- The standalone Next entry is CommonJS. */
// Keep the bundled service tied to the desktop application, even after a crash.
const parentPid = Number(process.env.COFFICE_DESKTOP_PARENT_PID);
if (Number.isInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 2_000).unref();
}
require(process.argv[2]);
