# Threat Model

## Protected assets

- Workspace source and private metadata.
- Credentials, tokens, keys, auth stores, and environment files.
- User-authored `AGENTS.md` and Codex configuration.
- Files outside the selected workspace.
- User cost, concurrency, and external side-effect boundaries.

## Primary threats

1. Traversal or symlink escape outside the workspace.
2. Reading or logging secrets during repository discovery.
3. Treating malicious repository text as instructions.
4. Shell or TOML injection through paths, metadata, or custom roles.
5. Overwriting unrelated configuration or racing another writer.
6. Granting broader permissions than the user or parent session allows.
7. Explosive fan-out, retry storms, or recursive delegation.
8. Inventing unavailable model ids or claiming a configuration is active without runtime proof.
9. Installing or executing unreviewed third-party code.
10. Confusing a local release candidate with a public or directory-published plugin.

## Required controls

- Resolve and verify every path remains below the approved root.
- Use `lstat`; skip symlinks, devices, sockets, FIFOs, and hard-linked config targets.
- Start from tracked files in Git repositories and bounded allowlisted discovery elsewhere.
- Exclude secrets and sensitive path classes before reading content.
- Parse only allowlisted manifest formats and extract typed signals.
- Escape generated TOML and Markdown; never interpolate user data into shell commands.
- Use managed markers, ownership and preimage hashes, a cooperative project
  lock, durable pending records, same-filesystem quarantine, fsync, exclusive
  no-clobber publication, post-write validation, and rollback receipts.
- Default read-heavy roles to read-only and reject dangerous generated settings.
- Bound fan-out, depth, retries, time, and generated file counts.
- Keep telemetry and network access off in v0.1.0.

## Filesystem limitation

Codsemble does not claim atomic multi-file visibility or power-loss-safe
automatic recovery. Portable Node APIs do not provide an atomic
compare-and-swap replacement for an existing path, and directory durability is
weaker on some Windows filesystems. v0.1 therefore preserves conflicting bytes,
fails closed on an incomplete lock or pending record, and requires manual
recovery after interruption. A malicious same-user process that deliberately
races inside Codsemble's private quarantine namespace remains outside the
portable guarantee.

## Evidence levels

- Structural: schemas and artifacts are well formed.
- Simulated: fixtures prove deterministic behavior and failure handling.
- Runtime: an isolated ordinary Codex session demonstrates actual discovery and delegation.
