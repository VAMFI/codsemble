# Architecture

Codesemble is a configuration compiler for Codex, not a second agent runtime.

## Flow

```text
workspace
  -> local Codex capability probe and supported-version adapter
  -> bounded deterministic audit
  -> typed evidence report
  -> user intake
  -> deterministic role ranking
  -> Lean / Balanced / Full proposals
  -> exact generated-file and configuration preview
  -> confirmed, locked no-clobber transaction
  -> doctor and fresh-session validation
```

## Plugin shape

The distributable plugin is skills-only and offline-first. Skills guide Codex
through initialization, updates, diagnostics, and rollback. A bundled Node.js
CLI performs deterministic filesystem inspection and configuration generation.
The CLI is built into one ESM file and does not download or execute dependencies
at runtime.

## Native Codex outputs

- `.codex/agents/<role>.toml`: specialist agent definitions.
- `AGENTS.md`: one bounded managed orchestration section.
- `.codex/config.toml`: optional project concurrency default.
- `.codex/codsemble/manifest.json`: selected roles, evidence, ownership, and schema versions.
- `.codex/codsemble/transactions/*.json`: content-free hashes, backup and
  retained-quarantine paths, and rollback metadata.

## Trust boundaries

- Workspace content is untrusted input.
- Ordinary Git-untracked files and fixture/example trees are excluded from
  product inference by default.
- Audit is read-only and secret-aware.
- Recommendation consumes typed signals, not arbitrary repository prose.
- Preview has no side effects.
- Apply requires a content-bound confirmation id and unchanged preimage hashes.
- Plan binds answer-file claims to a live local capability probe; apply
  independently re-probes the requirements encoded in the confirmed plan.
- Mutations use a cooperative lock, durable pending record, quarantine, and
  exclusive per-file publication. They do not claim atomic multi-file
  visibility or automatic crash recovery.
- Source quarantines from successful updates/deletes remain receipt-owned so
  late writes through an already-open inode are preserved and diagnosable.
- Global Codex configuration, project trust, credentials, external systems, and
  publication are outside the automatic transaction boundary.

## Model routing

Catalog entries use capability profiles such as `deep`, `balanced`, `fast`, and
`inherit`. Concrete model ids are written only when verified in the active
Codex environment. Otherwise the generated agent inherits Codex's active model.

## Concurrency

Installed roles and live workers are separate. Codesemble recommends a spawned
worker ceiling from the peak independent workflow width, user budget, and
detected runtime support. The primary thread is excluded from
`max_concurrent_threads_per_session`.
