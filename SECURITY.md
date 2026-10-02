# Security policy

Coffice 1.0.0-rc.2 is an experimental release candidate. Send security reports privately to
the repository owner through GitHub's private vulnerability reporting feature
when available. If that feature is unavailable, contact the repository owner
privately before sharing details. Do not open a public issue containing
sensitive information.

## Include

- affected version or commit;
- reproduction steps using synthetic data;
- expected and observed behavior;
- impact assessment;
- a minimal patch suggestion when appropriate.

## Never include

- authentication files or databases;
- access tokens, cookies, or credentials;
- prompt or response content;
- private Codex session data;
- environment secrets;
- private filesystem paths not required to explain the issue.

Coffice reads Codex-owned storage only through narrowly scoped, read-only
adapters and writes only its own local workspace. Explicitly confirmed task and
verification actions use supported Codex App Server methods; they never write
Codex-owned files or databases directly. Any behavior that reads authentication
material, exposes prompt or response bodies, writes to Codex-owned storage,
bypasses confirmation, retries an outcome that cannot be proved, or sends an
unintended control action should be treated as a security issue.

The supported release and reporting expectations are documented in
[Operations](docs/operations.md). Security fixes may be released without prior
public detail when disclosure would put users at risk.
