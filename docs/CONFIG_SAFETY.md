# Configuration safety

Codsemble compiles project configuration. It does not control Codex's runtime
permission system and must not claim that a prompt can grant or enforce access.

## Roles and concurrency are different

Codsemble asks two separate questions:

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
Codsemble does not silently lower an existing sufficient ceiling.

## Project scope only

Codsemble may propose changes to `<workspace>/.codex/config.toml`. It never:

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
non-mutating. `plan` emits a plan id, exact intended files, content hashes, and
configuration changes.

Apply requires:

- the reviewed plan file;
- exact confirmation of that plan id;
- unchanged preimage hashes;
- paths confined to the selected workspace;
- valid generated TOML and JSON.

The writer uses a scoped transaction and must abort on concurrent modification.
It preserves unrelated configuration and user content outside managed
boundaries. Rollback verifies postimage hashes and refuses to overwrite later
user edits.

## Manual mode

Choose `manual` or `unchanged` during intake when project config should not be
edited. After exact plan-id confirmation, Codsemble may still apply the team
agents, managed `AGENTS.md` section, and manifest while leaving
`.codex/config.toml` untouched. `manual` also shows the exact project snippet
for separate installation; `unchanged` preserves concurrency as-is. Global
configuration remains outside Codsemble's automatic transaction boundary.

## Model and effort routing

Catalog roles use capability profiles (`deep`, `balanced`, `fast`, `inherit`).
Codsemble pins a concrete model only when it is verified for the active
environment. A catalog reasoning-effort default is emitted only alongside that
verified model; otherwise it inherits. Explicit custom-role choices remain
user-owned inputs.

## Evidence after apply

Use `$team-doctor` after apply, then start a fresh isolated Codex session for
runtime validation. Keep these evidence levels distinct:

- structural: files parse and match schemas;
- simulated: fixture transactions and failure paths pass;
- runtime: Codex discovers the project, loads roles, and delegates real work.
