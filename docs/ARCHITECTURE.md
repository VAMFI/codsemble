# Architecture

Codesemble is a configuration compiler for Codex, not a second agent runtime.

## Flow

```text
workspace
  -> local Codex capability probe and supported-version adapter
  -> bounded deterministic audit
  -> atomic typed EvidenceRefs
  -> explicit user goals
  -> Project Capability Map
  -> bounded Work Packages
  -> generated role candidates
  -> strict deterministic admission
  -> Team IR v2
  -> Focused / Recommended / Extended coverage proposals
  -> exact generated-file and configuration preview
  -> full-digest or strictly matched voice-alias confirmation
  -> locked no-clobber transaction
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
- Capability compilation consumes typed signals and validated paths, not arbitrary
  repository prose. Passive files can specialize explicit goals but do not create
  licensing, community, documentation, or marketing work by themselves.
- Evidence is atomic and content-addressed. Capability, Work Package, role, design,
  plan, manifest, and confirmation bindings are deterministic.
- Generated role candidates cannot choose executable instructions, concrete model
  ids, output paths, arbitrary TOML, global settings, connectors, or external writes.
  Deterministic policy compiles admitted structured fields into native instructions.
- Preview has no side effects.
- Apply requires a content-bound confirmation id and unchanged preimage hashes.
- Voice approval is a derived presentation alias for that unchanged digest, not
  a shorter replacement, secret, or speaker-authentication mechanism.
- Preview-only plans never expose a voice challenge and must be regenerated in
  an apply-capable mode before confirmation.
- Plan binds answer-file claims to a live local capability probe; apply
  independently re-probes the requirements encoded in the confirmed plan.
- Approval and apply re-audit referenced repository evidence. Unrelated new files
  do not invalidate a plan, while a missing or changed referenced leaf does.
- Mutations use a cooperative lock, durable pending record, quarantine, and
  exclusive per-file publication. They do not claim atomic multi-file
  visibility or automatic crash recovery.
- Source quarantines from successful updates/deletes remain receipt-owned so
  late writes through an already-open inode are preserved and diagnosable.
- Global Codex configuration, project trust, credentials, external systems, and
  publication are outside the automatic transaction boundary.

## Project Capability Compiler

`ProjectCapabilityMap` distinguishes observed repository facets from required
human goals. A repository facet can specialize a goal, but only explicit intent
or a closed safety/lifecycle rule activates required work.

Manifest-path evidence defines deterministic project units. The root unit is
`.`; nested evidence attaches to the deepest containing manifest root. Unit IDs
participate in capability and Work Package identity, and generated roles are
grouped by both capability kind and unit so monorepo ownership stays bounded.

`WorkPackage` records the outcome, capability coverage, evidence and goal refs,
risk, advisory paths, and validation boundary. `GeneratedRoleSpec` groups
compatible packages under one owner. Admission rejects dangling references,
cross-package evidence or paths, unknown runtime fields, unsafe paths,
unsupported tools, permission widening, and external effects.

Focused covers every required capability without count padding. Recommended adds
an independent validator only for evidenced high-risk work. Extended may equal
Recommended when no additional capability is justified.

The current 111-entry catalog remains a reusable, replaceable primitive library.
Its cardinality is neither an output constraint nor a worker limit.

## Model routing

Generated roles request capability profiles such as `deep`, `balanced`, `fast`,
and `inherit`. Concrete model ids are written only when verified in the active
Codex environment and are rechecked before apply. Otherwise the preview must
explicitly show inherited model behavior.

## Concurrency

Installed roles and live workers are separate. Codesemble recommends a spawned
worker ceiling from the peak independent workflow width, user budget, and
detected runtime support. The primary thread is excluded from
`max_concurrent_threads_per_session`.

The implementation safety ceiling is 256 workers and is independent from the
primitive library. Values above 16 require explicit high-concurrency acknowledgement;
syntax acceptance does not prove that a host can usefully sustain that fan-out.

## Compatibility

Team plans and transaction receipts remain schema v1 so existing confirmation,
apply, and rollback machinery stays byte-oriented. A v2 plan adds confirmation-bound
design and evidence preconditions. Generated manifests accept strict v1 and v2
forms; v2 adds compact design provenance while retaining the same ownership hashes.
