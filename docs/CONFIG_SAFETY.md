# Configuration safety

Codesemble compiles project configuration. It does not control Codex's runtime
permission system and must not claim that a prompt can grant or enforce access.

## Roles and concurrency are different

Codesemble asks two separate questions:

1. How many specialist roles should exist in this project?
2. How many spawned workers may be open simultaneously?

The worker value excludes the primary/orchestrator thread. A team with 12
installed roles may reasonably use a ceiling of 4. The 111-role catalog is a
search space, never a concurrency recommendation.

The project-scoped canonical setting is:

```toml
[agents]
max_concurrent_threads_per_session = 4
```

The setting is a ceiling, not a target. Runtime policy, command-line overrides,
capacity, model limits, cost, and the actual task can reduce live parallelism.
Codesemble does not silently lower an existing sufficient ceiling.

## Project scope only

Codesemble may propose changes to `<workspace>/.codex/config.toml`. It never:

- edits `~/.codex/config.toml`;
- marks the workspace trusted;
- edits managed enterprise policy;
- disables approvals or broadens the active sandbox;
- writes `danger-full-access`;
- configures credentials, providers, hooks, MCP servers, or third-party skills.

Codex ignores project configuration for an untrusted project. A successful file
write therefore does not prove the setting is active. Start a fresh session and
run applicable Codex diagnostics after apply.

## Preview and apply

`audit`, `recommend`, `plan`, `doctor`, `catalog`, and rollback preview are
non-mutating. `plan` emits a content-bound confirmation id, exact intended files, content hashes, and
configuration changes.

Apply requires:

- the reviewed plan file;
- exact confirmation of that confirmation id;
- unchanged preimage hashes;
- paths confined to the selected workspace;
- valid generated TOML and JSON.

The writer uses a cooperative project lock, durable pending record,
same-filesystem quarantine, and exclusive publication. It verifies the bytes
after moving them to quarantine, so a change racing the earlier preflight
cannot be silently deleted. A file recreated before publication causes a
no-clobber conflict; both the competing target and quarantined bytes are
retained. Rollback applies the same checks to confirmed postimages.

For every successful update or delete, the transaction receipt records and
retains the source quarantine. Codesemble does not automatically unlink it:
an editor may still hold the original inode open and write after pathname
replacement. `doctor` verifies the retained quarantine against its recorded
preimage hash. Pruning recovery artifacts is a separate, explicit future
workflow.

This is not an atomic multi-file snapshot, and portable Node filesystems do not
offer compare-and-swap replacement of an existing pathname. A process or power
interruption may additionally leave
`.codex/codsemble/transactions/mutation.lock`, a `*.pending.json` record,
or partially staged files. `doctor` reports incomplete mutation
state and later writes refuse to proceed. Do not delete or merge those files
blindly: preserve the project, inspect the pending record and hashes, copy both
target and any receipt-recorded quarantine to a safe location, and restore the confirmed preimage
from the transaction backup only after resolving any competing bytes. Automatic
crash recovery is deferred beyond v0.1.

## Manual mode

Choose `manual` or `unchanged` during intake when project config should not be
edited. After exact confirmation-id approval, Codesemble may still apply the team
agents, managed `AGENTS.md` section, and manifest while leaving
`.codex/config.toml` untouched. `manual` also shows the exact project snippet
for separate installation; `unchanged` preserves concurrency as-is. Global
configuration remains outside Codesemble's automatic transaction boundary.

## Model and effort routing

Catalog roles use capability profiles (`deep`, `balanced`, `fast`, `inherit`).
Codesemble pins a concrete model only when it is verified for the active
environment. A catalog reasoning-effort default is emitted only alongside that
verified model; otherwise it inherits. Explicit custom-role choices remain
user-owned inputs.

Planning runs the same live probe itself, and apply re-runs it before writing.
`codsemble capabilities` exposes the bounded report for review. The probe reads only
the installed local Codex executable and returns bounded model identifiers,
supported reasoning efforts, native multi-agent feature state, and the
compatible config adapter. It discards raw provider instructions and cannot
grant permissions. If the probe cannot confirm multi-agent support, planning
fails closed, including in `manual` and `unchanged` modes.
Pinned reasoning effort is accepted only when that model reports the effort as
supported; otherwise planning fails closed.

## Evidence after apply

Use `$team-doctor` after apply, then start a fresh isolated Codex session for
runtime validation. Keep these evidence levels distinct:

- structural: files parse and match schemas;
- simulated: fixture transactions and failure paths pass;
- runtime: Codex discovers the project, loads roles, and delegates real work.
