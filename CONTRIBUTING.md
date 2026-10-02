# Contributing to Coffice

Coffice is local-first. Contributions must preserve its privacy model: Codex-
owned storage is read-only, Coffice writes only its own bounded local workspace,
and any supported control action crosses a narrow Codex App Server adapter only
after explicit user confirmation.

## Development

```powershell
npm.cmd ci
npm.cmd run dev
```

Before submitting a change, run:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format
npm.cmd test
npm.cmd run build
npm.cmd run verify:assets
npm.cmd run verify:boundary
```

Run `npm.cmd run verify:ui` for changes affecting layout, animation, interaction,
assets, or responsive behavior.

## Required boundaries

- Never access or modify `.codex/auth.json`.
- Never add credentials, cookies, access tokens, prompt bodies, response bodies,
  transcripts, or private Codex data to code, tests, fixtures, logs, screenshots,
  or issues.
- Keep Codex-owned source parsing behind a read-only adapter.
- Mark inferred state as inferred and preserve evidence provenance.
- Add a Codex control operation only when the installed App Server provides a
  documented method, the adapter projects a privacy-safe structural result,
  the UI requires explicit confirmation for the exact target and action, and
  missing or lost capability fails closed without automatic retry. Never write
  Codex-owned files or databases directly.
- Keep user-authored plan, review, and receipt data inside the versioned Coffice
  workspace and its documented bounds.
- Do not contribute copied game art, third-party screenshots, raw AI prompts,
  rejected generations, or unlicensed assets.
- New production assets require dimensions, SHA-256, broad provenance, and
  licensing review in `docs/pixel-assets.md`.

## Tests

Prefer deterministic tests with synthetic metadata. Tests must not depend on a
user's real Codex files, current time, network access, randomness, or private
local configuration.

## Commit scope

Keep changes focused and explain user-visible behavior, safety implications, and
verification performed. Do not include development transcripts or unrelated
workspace files.

Code and documentation contributions are accepted under the Apache License 2.0.
Files in `public/assets/` are excluded and require the separate provenance and
licensing review described above.
