<p align="center">
  <img src="assets/brand/codsemble-github-hero.png" alt="Codesemble — repository evidence transformed into a small native Codex team" width="100%">
</p>

<p align="center">
  <strong>Audit your repository. Assemble the smallest capable Codex team. Apply it safely.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/USAGE.md">Usage</a> ·
  <a href="docs/PROJECT_CAPABILITY_COMPILER.md">Compiler</a> ·
  <a href="docs/ARCHITECTURE.md">How it works</a> ·
  <a href="docs/CONFIG_SAFETY.md">Safety</a> ·
  <a href="docs/VOICE_APPROVAL.md">Voice approval</a> ·
  <a href="docs/ROLE_CATALOG.md">Primitive library</a> ·
  <a href="docs/USEFULNESS_COMPARISON.md">Comparison</a>
</p>

---

## What is Codesemble?

Codesemble is an open-source, repository-aware team builder for Codex.

It reads bounded project signals, asks what outcome you want, and compiles a
Project Capability Map, Work Packages, and the smallest capable set of
project-specific specialists. Every role explains why it exists before
Codesemble generates native project configuration.

Codesemble configures Codex. It does not replace the Codex runtime.

## Who is it for?

Codesemble is for people working in real repositories who want specialized help
without installing a generic army of agents.

- **Solo builders** who want the right specialists without designing a team by hand.
- **Maintainers** who need reviewable, reversible project configuration.
- **Product teams** whose work spans engineering, testing, design, docs, growth, or operations.
- **Organizations** that want project-local defaults without silently changing personal Codex settings.

## How does it work?

```text
Typed evidence → Capability map → Work packages → Admitted team → Exact preview → Confirmed apply
```

1. **Audit** — reads bounded, typed project signals offline.
2. **Compile** — derives capabilities and independently delegable Work Packages.
3. **Generate** — proposes Focused, Recommended, and Extended teams with coverage evidence.
4. **Preview** — shows every agent, sandbox, instruction, and configuration change.
5. **Apply** — writes only the fresh exact plan you confirm, with doctor and rollback support.

[Read the complete workflow →](docs/USAGE.md)

## Why is it different?

Most agent packs start with a fixed roster. Codesemble starts with your goal and
the typed evidence that can safely specialize it.

The bundled catalog is an extensible primitive library, not the set of teams
Codesemble can produce. Project roles are generated and admitted from Work
Packages. Installed roles and live concurrency stay separate, so a project may
install 12 specialists while allowing only 4 spawned workers at once.

> **Evidence in. Native team out.**

[Explore the primitive library →](docs/ROLE_CATALOG.md)

[See the architecture →](docs/ARCHITECTURE.md)

## Quick start

### Install

```bash
codex plugin marketplace add VAMFI/codsemble --ref <reviewed-release-or-commit>
codex plugin add codsemble@codsemble
```

Start a fresh Codex session so the plugin and project agents are reloaded.

### Build your team

```text
$initialize-team Build the recommended Codex team for this workspace.
```

Codesemble audits and prepares a side-effect-free plan first. It applies project
files only after showing the exact diff and receiving the plan's confirmation ID
or its strictly matched, voice-friendly spoken alias.

### Keep it healthy

```text
$update-team Re-audit this workspace and preview team changes.
$team-doctor Check this project's generated team and configuration.
$rollback-team Preview rollback of the latest Codesemble transaction.
```

[Open the step-by-step guide →](docs/USAGE.md)

## What can it create?

```text
AGENTS.md                         bounded orchestration guidance
.codex/agents/<role>.toml         native specialist definitions
.codex/config.toml                optional project concurrency default
.codex/codsemble/manifest.json    ownership and selected-team record
.codex/codsemble/transactions/    reversible transaction history
```

Codesemble does not edit `~/.codex/config.toml`, mark a project trusted, collect
credentials, broaden permissions, or publish anything for you.

[Understand configuration safety →](docs/CONFIG_SAFETY.md)

[Read the privacy boundary →](docs/PRIVACY.md)

[Review the threat model →](docs/THREAT_MODEL.md)

## Documentation

| I want to… | Read… |
| --- | --- |
| Install, initialize, update, diagnose, or roll back | [Usage](docs/USAGE.md) |
| Understand the compiler and native Codex outputs | [Architecture](docs/ARCHITECTURE.md) |
| Inspect the EvidenceRef, capability, Work Package, and admission contracts | [Project Capability Compiler](docs/PROJECT_CAPABILITY_COMPILER.md) |
| Migrate a v0.1 team safely | [v0.2 migration](docs/MIGRATION_V0_2.md) |
| Review concurrency, no-clobber apply, and recovery behavior | [Configuration safety](docs/CONFIG_SAFETY.md) |
| Approve an apply-capable plan from a realtime voice session | [Voice-friendly approval](docs/VOICE_APPROVAL.md) |
| Understand reusable role primitives and dynamic generation | [Primitive library](docs/ROLE_CATALOG.md) |
| Understand local data handling | [Privacy](docs/PRIVACY.md) |
| Review trust boundaries and abuse cases | [Threat model](docs/THREAT_MODEL.md) |
| See what has actually been tested | [Validation evidence](docs/VALIDATION.md) |
| Compare the compiler with catalog-surface and single-primary baselines | [Bounded usefulness comparison](docs/USEFULNESS_COMPARISON.md) |
| Understand the project promise and release gate | [Definition of Done](docs/DEFINITION_OF_DONE.md) |
| Reuse the visual identity correctly | [Brand guide](docs/BRAND.md) |

## Project status

Codesemble v0.2.0 is the Project Capability Compiler candidate. It is not merged,
released, or published by this branch. Structural and simulated checks never
prove that every Codex version, policy, model, or operating system will accept a
generated team; runtime claims remain tied to the exact tested payload and host.

[See validation evidence →](docs/VALIDATION.md)

[View the roadmap →](ROADMAP.md)

## Contributing

Contributions are welcome. Start with the [contribution guide](CONTRIBUTING.md),
use [support guidance](SUPPORT.md) for reproducible questions, and report
vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

Codesemble is an independent open-source project, licensed under
[Apache License 2.0](LICENSE).
