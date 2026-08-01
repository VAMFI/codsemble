<p align="center">
  <img src="assets/brand/codsemble-github-hero.png" alt="Codesemble — repository evidence transformed into a small native Codex team" width="100%">
</p>

<p align="center">
  <strong>Build the right Codex agent team for this repository and goal.</strong>
</p>

<p align="center">
  Codesemble audits bounded project evidence, generates only the specialists
  your work needs, and shows every project-local change before applying it.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/CONFIG_SAFETY.md">Safety</a> ·
  <a href="#documentation">Documentation</a>
</p>

---

## Why Codesemble?

- **Project-specific** — agents are derived from your repository and intended outcome.
- **Small by design** — every proposed role must cover justified project work.
- **Native and reversible** — Codesemble configures Codex project files with exact preview, Doctor, and rollback support.

Codesemble is an open-source, repository-aware team builder for native Codex
multi-agent orchestration. It configures Codex; it does not replace the Codex
runtime.

## Quick start

### Install the v0.2 candidate

```bash
codex plugin marketplace add VAMFI/codsemble --ref fc247152961c25e79b525a969806991f499a2bac
codex plugin add codsemble@codsemble
```

The pinned commit is the merged, validated v0.2 candidate. Start a fresh Codex
session after installation so the plugin skills are discovered.

### Build your team

```text
$codsemble:initialize-team Build the recommended Codex team for this workspace.
```

Codesemble audits the workspace and presents Focused, Recommended, and Extended
options. It prepares a side-effect-free exact plan before writing any project
file.

### Use your agents

After you approve and apply the team, work normally in the primary Codex thread:

```text
Review the checkout flow, fix the highest-risk issue, and validate the result.
```

Start another fresh Codex session after apply or configuration changes so the
generated project agents are discovered.

The primary agent remains user-facing and accountable. Project-local
orchestration guidance delegates bounded, separable work to installed
specialists when useful, reconciles their evidence, and keeps final decisions
with the primary thread.

Installed roles are available capabilities, not always-running processes. The
project worker ceiling limits simultaneous spawned workers, excludes the primary
thread, and is independent of installed role count.

### Keep the team healthy

```text
$codsemble:update-team Re-audit this workspace and preview team changes.
$codsemble:team-doctor Check this project's generated team and configuration.
$codsemble:rollback-team Preview rollback of the latest Codesemble transaction.
```

[Open the step-by-step guide →](docs/USAGE.md)

> **You stay in control.** Audit and preview are read-only. Codesemble writes
> project files only after you approve the exact current plan, refuses stale or
> changed plans, preserves transaction history, and previews rollback before
> restoring managed files. It does not change personal Codex settings or
> publish anything.

## How it works

```text
Repository evidence + your goal → Work Packages → Project team → Preview → Apply
```

1. **Audit** bounded, typed project signals locally.
2. **Compile** the capabilities and separable work the goal requires.
3. **Generate** evidence-backed Focused, Recommended, and Extended teams.
4. **Preview** every role, sandbox, instruction, and configuration change.
5. **Apply** only the exact fresh plan you confirm, with Doctor and rollback support.

### Example output

```text
Repository evidence
  GitHub Actions + delivery goal + security requirement

Recommended Codex team
  Delivery specialist       owns the delivery Work Package
  Security specialist       reviews the security boundary
  Independent validator     verifies the high-risk delivery path

Spawned-worker ceiling: 4
```

The names and number of agents change with the repository evidence and confirmed
goal. Codesemble explains the evidence and Work Package behind every generated
role before apply.

[Read the compiler contract →](docs/PROJECT_CAPABILITY_COMPILER.md) ·
[See the architecture →](docs/ARCHITECTURE.md)

## Dynamic teams, not 111 installed agents

Codesemble does not install a fixed team of 111 agents.

The current 111-entry catalog is a reusable primitive library—not a roster,
recommendation ceiling, team-size target, or concurrency limit. For each
workspace, the compiler derives Work Packages from bounded evidence and explicit
goals, then generates only justified project-specific roles.

- **Focused** is the smallest complete team covering required Work Packages.
- **Recommended** adds independent verification only for evidenced high-risk work.
- **Extended** adds only closed-rule, evidence-backed optional lifecycle work and may equal Recommended.

Catalog size, installed roles, and active workers remain separate. A project may
install 12 useful specialists while allowing only 4 workers to run concurrently.

[Explore the primitive library →](docs/ROLE_CATALOG.md) ·
[See the bounded comparison →](docs/USEFULNESS_COMPARISON.md)

## Who is it for?

- **Solo builders** who want useful specialists without designing a team by hand.
- **Maintainers** who need reviewable, reversible project configuration.
- **Product teams** whose work spans engineering, testing, design, docs, growth, or operations.
- **Organizations** that want project-local defaults without silently changing personal Codex settings.

## What can it create?

```text
AGENTS.md                         bounded orchestration guidance
.codex/agents/<role>.toml         native specialist definitions
.codex/config.toml                optional project worker ceiling
.codex/codsemble/manifest.json    ownership and selected-team record
.codex/codsemble/transactions/    reversible transaction history
```

Codesemble does not edit `~/.codex/config.toml`, mark a project trusted, collect
credentials, broaden permissions, or publish anything for you.

[Understand configuration safety →](docs/CONFIG_SAFETY.md) ·
[Read the privacy boundary →](docs/PRIVACY.md) ·
[Review the threat model →](docs/THREAT_MODEL.md)

## Documentation

| I want to… | Read… |
| --- | --- |
| Install, initialize, update, diagnose, or roll back | [Usage](docs/USAGE.md) |
| Understand the compiler and native Codex outputs | [Architecture](docs/ARCHITECTURE.md) |
| Inspect EvidenceRef, capability, Work Package, and admission contracts | [Project Capability Compiler](docs/PROJECT_CAPABILITY_COMPILER.md) |
| Migrate a v0.1 team safely | [v0.2 migration](docs/MIGRATION_V0_2.md) |
| Review concurrency, no-clobber apply, and recovery | [Configuration safety](docs/CONFIG_SAFETY.md) |
| Approve from a realtime voice session | [Voice-friendly approval](docs/VOICE_APPROVAL.md) |
| Understand reusable primitives and dynamic generation | [Primitive library](docs/ROLE_CATALOG.md) |
| Understand local data handling | [Privacy](docs/PRIVACY.md) |
| Review trust boundaries and abuse cases | [Threat model](docs/THREAT_MODEL.md) |
| See what has actually been tested | [Validation evidence](docs/VALIDATION.md) |
| Compare Codesemble with simpler baselines | [Bounded usefulness comparison](docs/USEFULNESS_COMPARISON.md) |
| Understand the project promise and release gate | [Definition of Done](docs/DEFINITION_OF_DONE.md) |
| Reuse the visual identity correctly | [Brand guide](docs/BRAND.md) |

## Project status

Codesemble v0.2.0 is merged on `main` as the Project Capability Compiler
candidate. Its merge-head CI passed on Node 22 and 24 across Ubuntu, macOS, and
Windows, with CodeQL and dependency review also passing. It has not been tagged,
released, or marketplace-published; v0.1.0 remains the latest release.

Runtime and physical-device claims remain tied to the exact tested payload and
boundary. Structural checks never prove that every Codex version, policy, model,
operating system, or voice device will accept a generated team.

[See validation evidence →](docs/VALIDATION.md) ·
[View the roadmap →](ROADMAP.md)

## Contributing

Try Codesemble in an isolated repository and report where its audit, proposed
roles, or explanations were incomplete. Contributors can add representative
fixtures, improve compiler policies, strengthen lifecycle tests, or refine the
documentation.

Start with the [contribution guide](CONTRIBUTING.md), use [support guidance](SUPPORT.md)
for reproducible questions, and report vulnerabilities through the private
process in [SECURITY.md](SECURITY.md).

Codesemble is an independent open-source project licensed under the
[Apache License 2.0](LICENSE).
