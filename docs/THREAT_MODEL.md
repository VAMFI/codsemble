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
11. Treating vague, approximate, replayed, or cross-plan speech as installation approval.
12. Letting generated candidates invent tools, models, instructions, output paths,
    sandboxes, or external authority.
13. Applying a role after its referenced evidence leaf changed.
14. Executing a repository-provided Git/PATH shim or fsmonitor hook during audit.
15. Forging shallow manifest or receipt metadata to claim destructive ownership.

## Required controls

- Resolve and verify every path remains below the approved root.
- Use `lstat`; skip symlinks, devices, sockets, FIFOs, and hard-linked config targets.
- Resolve Git only from a trusted absolute directory outside the workspace,
  disable fsmonitor, strip inherited Git redirects, and otherwise use bounded
  allowlisted discovery with an explicit unverified-state warning.
- Exclude secrets and sensitive path classes before reading content.
- Parse only allowlisted manifest formats and extract typed signals.
- Escape generated TOML and Markdown; never interpolate user data into shell commands.
- Use managed markers, ownership and preimage hashes, a cooperative project
  lock, durable pending records, same-filesystem quarantine, fsync, exclusive
  no-clobber publication, post-write validation, and rollback receipts.
- Default read-heavy roles to read-only and reject dangerous generated settings.
- Bound fan-out, depth, retries, time, and generated file counts.
- Keep telemetry and network access off in deterministic v0.2.0 mode.
- Accept only structured generated role fields. Compile instructions from fixed
  templates; candidates cannot supply TOML, commands, concrete models, output
  paths, global settings, or external-write grants.
- Treat generated path scopes as advisory. They do not narrow native workspace-write.
- Bind the complete typed evidence fingerprint into the plan and re-audit it at
  approval and apply, including added or newly truncated relevant evidence.
- Require strict hashed manifest ownership, an active filename/id/plan/postimage-
  bound receipt, and unchanged receipt/rollback preconditions. Treat local
  receipts as consistency evidence rather than external authentication; keep
  hashless legacy agents preserve-only.
- Keep the full plan digest authoritative for voice approval; derive only a
  versioned spoken alias, require an exact conservative transcript match, give
  preview plans no challenge, and recheck capabilities and preimages before writes.

## Voice limitation

The CLI can prove that a transcript exactly matches the alias of the plan being
applied. It cannot prove who spoke, distinguish live speech from playback, bind
the phrase to a particular Android device or session, or hide the phrase from a
same-user process. A trusted voice broker with protected input, expiring signed
grants, rate limits, and an atomic consumption ledger is required for those
stronger guarantees. Codesemble therefore treats the phrase as explicit-intent
UX, not authentication, and retains the full digest and filesystem controls.

## Filesystem limitation

Codesemble does not claim atomic multi-file visibility or power-loss-safe
automatic recovery. Portable Node APIs do not provide an atomic
compare-and-swap replacement for an existing path, and directory durability is
weaker on some Windows filesystems. v0.2 therefore preserves conflicting bytes,
fails closed on an incomplete lock or pending record, and requires manual
recovery after interruption. A malicious same-user process that deliberately
races inside Codesemble's private quarantine namespace remains outside the
portable guarantee.

## Evidence levels

- Structural: schemas and artifacts are well formed.
- Simulated: fixtures prove deterministic behavior and failure handling.
- Runtime: an isolated ordinary Codex session demonstrates actual discovery and delegation.
