# Codsemble

**Repository-aware multi-agent team setup for Codex.**

Codsemble audits a workspace, asks a short set of questions, and recommends the
smallest useful team from 111 specialist role blueprints. It then previews
native Codex project configuration and applies only the transaction the user
confirms.

> Audit the work. Build the smallest useful Codex team. Keep every change
> reviewable.

Codsemble is an independent open-source project. It configures Codex's native
agent runtime; it does not replace it.

## Why Codsemble

Large agent packs make every repository look alike. Codsemble starts from
workspace evidence and user goals:

- bounded, offline-first repository audit;
- read-only local Codex capability and model discovery;
- Lean, Balanced, and Full team proposals with reasons;
- searchable catalog of exactly 111 specialist blueprints;
- native `.codex/agents/*.toml` generation;
- a bounded managed section in `AGENTS.md`;
- optional, project-scoped concurrency configuration;
- exact preview, confirmed no-clobber apply, doctor, update, and rollback.

Codsemble keeps two numbers separate:

- **Installed roles** are specialists available to the project.
- **Concurrent workers** are spawned agent threads allowed to run at once,
  excluding the primary/orchestrator thread.

A project can define 15 roles and run only 4 workers concurrently. The catalog
size of 111 never implies 111 live workers.

## Status

Codsemble v0.1.0 is the initial public release. A passing build is structural evidence, not
proof that every Codex version, policy, model, or operating system will accept a
generated team. Real runtime claims require a fresh isolated Codex session.

## Requirements

- Node.js 20 or newer for local development.
- A Codex version that supports plugins and project-scoped custom agents.
- A trusted project if you want Codex to load `.codex/config.toml`.

Codsemble never marks a project trusted.

## Install

Install the v0.1.0 plugin from its public marketplace source:

```bash
codex plugin marketplace add VAMFI/codsemble --ref v0.1.0
codex plugin add codsemble@codsemble
```

Start a fresh Codex session after installation so project agents and skills are
reloaded.

## Install from a local checkout

```bash
npm ci
npm run build
```

Add the checkout as a local marketplace in an isolated Codex development
environment, install `codsemble@codsemble`, and start a fresh Codex session.
Use `codex plugin marketplace add --help` to confirm the local-path syntax for
your installed Codex release.

Do not test development builds against a personal Codex home containing
important configuration.

## Use

Invoke the skills from Codex:

```text
$initialize-team Set up a balanced Codex team for this workspace.
$update-team Re-audit this workspace and preview team changes.
$team-doctor Check this project's generated team and configuration.
$rollback-team Preview rollback of the latest Codsemble transaction.
```

Initialization is two-phase:

1. Codsemble audits, interviews, recommends, and writes a side-effect-free plan.
2. Codsemble shows the exact diff and applies it only after confirmation.

See [Usage](docs/USAGE.md) for the complete flow and direct CLI examples.
See [Validation evidence](docs/VALIDATION.md) for the exact structural,
simulated, and real-runtime boundaries proven by this release candidate.

## What Codsemble may generate

```text
AGENTS.md
.codex/
├── agents/
│   └── <role>.toml
├── config.toml
└── codsemble/
    ├── manifest.json
    └── transactions/
```

The managed `AGENTS.md` section and generated agent files remain bounded by a
manifest. Codsemble refuses to overwrite overlapping user edits.

Apply and rollback are serialized by a project lock. Each file is moved to a
private same-filesystem quarantine and the replacement is published with an
exclusive link, so a racing writer is preserved instead of silently
overwritten. Successful updates retain the original inode as a
receipt-recorded recovery quarantine so writes through an already-open editor
handle still have a pathname. The operation is not an atomic multi-file
snapshot. Process or power interruption can additionally leave a lock or
pending record;
`doctor` reports that state and further writes fail closed pending manual
recovery. See [Configuration safety](docs/CONFIG_SAFETY.md).

## Safety boundary

During v0.1.0 initialization Codsemble does not:

- edit `~/.codex/config.toml`;
- mark a project trusted;
- install third-party plugins, skills, hooks, or MCP servers;
- collect credentials or change provider configuration;
- execute scripts discovered in the audited repository;
- use telemetry or upload repository data;
- push, publish, deploy, release, or change external systems.

Read [Privacy](docs/PRIVACY.md), [Configuration safety](docs/CONFIG_SAFETY.md),
and the [Threat model](docs/THREAT_MODEL.md) before using Codsemble on a
sensitive repository.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check
```

The release boundary additionally requires official plugin and skill
validation, fixture/security tests, reproducibility checks, and fresh-session
runtime evidence. See the [Definition of Done](docs/DEFINITION_OF_DONE.md).

## Contributing and support

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Use the public issue tracker for
non-sensitive bugs and feature requests, and follow [SECURITY.md](SECURITY.md)
for vulnerabilities. Governance and decision rules are in
[GOVERNANCE.md](GOVERNANCE.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
