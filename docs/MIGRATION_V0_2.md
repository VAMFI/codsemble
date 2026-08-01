# Migrating from v0.1 to v0.2

Codesemble v0.2 changes recommendation semantics without replacing the native
transaction engine.

## What changes

- Lean, Balanced, and Full become Focused, Recommended, and Extended.
- Legacy CLI names remain aliases during migration.
- The bundled catalog becomes a primitive library; project agents may have new
  generated ids and project-specific missions.
- Manifest schema v2 adds Team Design and evidence provenance.
- The complete typed capability-evidence fingerprint is rechecked before approval
  and apply, including relevant additions and truncation.
- The worker safety ceiling is independent from catalog and installed-role counts.

## What remains compatible

- Saved TeamPlan and transaction receipt schema stays at version 1.
- Strict v1 manifests with ownership hashes and an active canonical apply receipt
  remain readable by doctor and can be migrated through a reviewed v2 update.
- Hashless legacy manifests remain migration-needed and never gain deletion
  authority by inference.
- Rollback restores byte-exact v1 manifest and agent preimages when their current
  v2 postimages still match.
- User-owned agents, unrelated `AGENTS.md` content, sufficient project config,
  and later edits remain protected.

## Safe migration workflow

1. Run `team-doctor` and resolve any mutation journal or ownership drift.
2. Re-audit and inspect the Capability Map, Work Packages, and generated roles.
3. Compare Focused, Recommended, and Extended coverage; do not preserve an old
   role merely to maintain a count.
4. Review every create, update, delete, verify, sandbox, model, and concurrency
   decision.
5. Use an apply-capable plan and provide its exact current confirmation.
6. Run doctor and start a fresh Codex session.
7. Verify native discovery and one bounded delegation before removing rollback evidence.

Codesemble refuses automatic ownership adoption when a hashed v1 or v2 manifest
is not bound to an active canonical apply receipt. The reviewed plan binds the
receipt bytes and absence of its rollback marker through apply. Preserve the
workspace and use an explicit recovery or adoption process instead of forging metadata.
