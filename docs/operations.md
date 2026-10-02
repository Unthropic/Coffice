# Operating Coffice

Coffice 1.0.0-rc.2 is an experimental Windows desktop companion, with its source
available for development. It is not published to npm.

## Windows application

Download the Windows x64 executable from the project's GitHub Releases page
and double-click it. The app bundles its own Node runtime and local web service;
users do not need to install Node or type commands. The build is unsigned.

Coffice opens a normal window and runs only on `127.0.0.1:3003`. Closing the
application stops its own service. A second launch focuses the existing window.
It never stops or restarts Codex. If another process already occupies port 3003,
Coffice shows the conflict without terminating that process.

The home screen is the playful companion. `/workbench` opens the earlier
planning and review interface. Demo occupants are simulated, and scene
interactions do not send instructions to real Codex agents.

## Supported environment

Building from source requires:

- Node.js 24 or newer and its bundled npm;
- Git;
- a locally installed Codex CLI with App Server support;
- Codex desktop data belonging to the same operating-system account; and
- current Chrome or Edge for release acceptance checks.

The downloadable desktop package targets Windows x64. The source runtime and
storage model also support macOS and Linux, but desktop packages for those
platforms have not been tested. The full August acceptance record applies to
the earlier Workbench; the new companion and desktop wrapper have separate
focused launch, status, interaction, and visual checks.

## Install and run

From the Coffice source directory, install exactly the dependency versions in
`package-lock.json`:

```powershell
npm.cmd ci
```

For development with live reload:

```powershell
npm.cmd run dev
```

For a production-style local run:

```powershell
npm.cmd run build
npm.cmd run start
```

To package a desktop build:

```powershell
npm.cmd run desktop:build
```

This builds the production web app, copies its standalone runtime, and packages
the Windows executable under `desktop-release/`. `npm.cmd run desktop` launches
the prepared desktop app for development after `npm.cmd run desktop:prepare`.

Open <http://127.0.0.1:3003>. Both scripts bind to that loopback address and
port. Do not expose the process through a public interface, reverse proxy, or
port-forwarding service; the action boundary is designed for the local user.

Before accepting a release from a clean checkout, run the complete production
gate after `npm.cmd ci`:

```powershell
npm.cmd run verify:release
```

The gate audits dependencies, checks types, lint and formatting, runs all tests,
builds the production application, verifies assets and the public boundary,
then starts the production server on `127.0.0.1:3003` for synthetic pointer and
responsive browser acceptance. It refuses a dirty checkout.

## Configuration

Two optional environment variables control local discovery and storage:

- `COFFICE_CODEX_EXECUTABLE` sets the absolute path to the Codex CLI executable
  when `codex` is not discoverable on `PATH`.
- `COFFICE_DATA_DIR` replaces the default directory for Coffice-owned workspace
  files. Set it before the first run, or move the existing data while Coffice is
  stopped before changing it.

Do not point `COFFICE_DATA_DIR` at `.codex`, a project checkout, a synchronized
shared folder, or another application's directory. Coffice owns and atomically
replaces files in this directory.

## Local data and privacy boundary

Coffice's current workspace is `workspace-v1.json`; its last-known-good backup
is `workspace-v1.json.bak`. The filename remains stable while the schema inside
it is migrated. The default Coffice-owned directory is:

| Platform | Default directory                          |
| -------- | ------------------------------------------ |
| Windows  | `%LOCALAPPDATA%\Coffice`                   |
| macOS    | `~/Library/Application Support/Coffice`    |
| Linux    | `${XDG_DATA_HOME:-~/.local/share}/Coffice` |

Coffice reads Codex-owned storage through read-only adapters. It never writes
Codex files or databases. User-authored plans, decisions, receipts, and review
state are written only to the Coffice-owned directory. Supported task and
verification actions cross the local Codex App Server boundary only after the
user confirms the exact action. Coffice does not ingest or retain credentials,
prompts, responses, transcripts, message previews, tool bodies, or command
output. See [Privacy and local data](privacy.md) for the complete contract.

## Back up and restore

To back up Coffice state:

1. Stop the Coffice process.
2. Copy the entire Coffice-owned data directory to a private location protected
   by your operating-system account.
3. Keep `workspace-v1.json` and `workspace-v1.json.bak` together.

The files may contain user-authored project plans, decisions, review notes, and
other private local context. Treat a backup as private data; Coffice does not
encrypt it separately from the filesystem.

To restore:

1. Stop Coffice and make a safety copy of the current data directory.
2. Replace the Coffice-owned directory with the complete saved copy.
3. Start Coffice and review the recovery message before making new changes.

If the primary file is invalid but the last-known-good backup is valid, Coffice
loads the backup and blocks new workspace writes until the user acknowledges
the recovery in the interface. Do not edit either JSON file by hand.

## Upgrade

Before changing versions, stop Coffice and back up its data directory. Then:

1. Obtain the intended tagged source revision or release archive in a clean
   source directory.
2. Run `npm.cmd ci` in that directory.
3. Run `npm.cmd run build`.
4. Start Coffice and confirm the workspace opens, any recovery notice is
   understood, and the current project/task roster is correct.

Coffice migrates older supported workspace schemas when it loads them. Keep the
pre-upgrade backup until the new version has been reviewed. Do not copy an old
`node_modules` or `.next` directory into a new source tree.

## Action availability and degradation

The office, plans, and saved review context remain local. Actions that contact
Codex depend on compatible local App Server methods and fresh authoritative task
state. A control is unavailable when Coffice cannot prove those conditions.

Coffice fails closed: it does not edit Codex storage as a fallback, weaken a
sandbox, infer permission, or automatically repeat an action whose result was
lost. Unknown means the outcome could not be proved; inspect the task in Codex
before deciding what to do next. Browser notification delivery also requires
Coffice to remain open and uses browser-owned permission.

## Troubleshooting

### The page does not open

- Confirm the terminal says the server is listening on `127.0.0.1:3003`.
- Check that another process is not already using port 3003.
- Use the exact loopback URL rather than a machine name or network address.
- Run `npm.cmd ci` again if dependencies are incomplete, then rebuild for a
  production-style run.

### Projects or tasks are missing

- Confirm Codex and Coffice run as the same operating-system user.
- Confirm the task is a current visible top-level Codex task and has the
  expected explicit local-project assignment. Coffice does not infer an
  assignment from a working directory.
- Restart Coffice after updating Codex. Missing or stale source evidence is
  shown as unavailable rather than converted into a stronger claim.

### Codex actions are unavailable

- Confirm a current Codex CLI with App Server support is installed and
  discoverable on `PATH`, or set `COFFICE_CODEX_EXECUTABLE` before starting.
- Check the task still exists and is in the lifecycle state required by the
  action.
- Review the exact availability message. Coffice deliberately does not bypass a
  missing capability or retry an unknown result.

### The workspace is unavailable or recovered

- Verify the current user can read and write the Coffice-owned data directory.
- If `COFFICE_DATA_DIR` is set, confirm it points to the intended private local
  directory.
- When Coffice reports backup recovery, review and acknowledge it in the UI
  before writing again.
- Restore a known-good complete backup only while Coffice is stopped.

### Browser acceptance checks fail

- Use a current Chrome or Edge installation.
- Start the product on `127.0.0.1:3003` before running browser verification.
- Do not run acceptance against a public host or a different port.

Never post real workspace files, Codex storage, credentials, prompts, responses,
transcripts, or private filesystem paths in a public issue. Follow
[SECURITY.md](../SECURITY.md) for a possible security concern.

## Remove Coffice

For a downloaded desktop app, close Coffice and delete its executable (or the
extracted application folder). For a source installation, stop the process,
then delete the source directory and its generated
`node_modules` and `.next` directories using your normal file manager. That
does not remove Coffice-owned user data.

If you also intend to erase local Coffice plans, decisions, receipts, and
review state, first keep any backup you need, then deliberately remove the exact
Coffice-owned data directory listed above (or the exact `COFFICE_DATA_DIR` you
configured). Removing Coffice does not delete or modify Codex-owned data.
