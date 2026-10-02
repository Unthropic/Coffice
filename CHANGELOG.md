# Changelog

All notable user-visible changes to Coffice are recorded here. Coffice follows
[Semantic Versioning](https://semver.org/).

## 1.0.0-rc.2 - 2026-10-03

- Made the playful agent office the default experience, with a separate
  Workbench for the existing planning and review tools.
- Added a Windows desktop wrapper that starts and stops its own bundled local
  runtime, with single-instance handling and clear port-conflict messages.
- Added a lightweight companion status feed, explicit demo occupants, and
  presentation-only office interactions.
- Updated the local Codex lifecycle adapter for current structural item events.
- Updated vulnerable runtime dependencies before packaging.

This is an unsigned experimental Windows x64 desktop candidate.

## 1.0.0-rc.1 - 2026-08-20

First source-distributed release candidate, pending final acceptance.

- Added the local-first campus and true top-down project offices with one live
  desk per admitted top-level Codex task.
- Added privacy-safe Attention, Digest, plan, review, decision-request, evidence,
  and fixed-profile verification workflows.
- Added privacy-reduced, exact Codex goal-block evidence with stale-safe
  continuity through transient App Server failures.
- Added explicit, separately confirmed supported Codex App Server actions with
  fail-closed capability, concurrency, and lost-outcome handling.
- Added bounded, versioned Coffice-owned storage with atomic writes, backup
  recovery, and strict separation from read-only Codex-owned data.
- Added responsive desktop and mobile layouts, keyboard-accessible controls,
  production-asset integrity checks, and release acceptance tooling.
- Documented source installation, production operation, backup, restore,
  upgrade, removal, privacy, security, and licensing boundaries.

This candidate is not published to npm and is not the stable 1.0.0 release.
