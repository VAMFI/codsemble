<p align="center">
  <img src="assets/brand/codsemble-github-hero.png" alt="Codesemble — repository evidence transformed into a small native Codex team" width="100%">
</p>

<p align="center">
  <strong>Turn your project and goal into the smallest useful Codex agent team.</strong>
</p>

<p align="center">
  Codesemble audits your project, proposes the specialists it needs, and gives
  you an exact preview, human approval, and rollback.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#safety-and-control">Safety</a> ·
  <a href="#documentation">Documentation</a>
</p>

<p align="center">
  <a href="https://vamfi.github.io/codsemble/">Open the interactive project guide →</a>
</p>

---

## Why Codesemble?

- **Understands the project** — recommendations come from repository evidence and your goal.
- **Builds only justified roles** — no fixed team, no role padding, no team to design by hand.
- **Keeps changes reviewable** — project-local setup is previewed before apply and can be rolled back.

Codesemble is for builders and teams who want useful specialists without
maintaining a multi-agent framework. It configures native Codex project files;
it does not replace Codex.

## Quick start

### 1. Install, then restart Codex

```bash
codex plugin marketplace add VAMFI/codsemble --ref 0aa84be36209e454fadfb34b96c8c3d5b3a16caf
codex plugin add codsemble@codsemble
```

Open a fresh Codex session so its four Codesemble skills are discovered. The
pinned commit is the locally validated v0.2 privacy-hardening candidate. It is
not merged, tagged, or released yet; use it only after that commit is available
from the configured Git source.

### 2. Audit, choose, and approve

```text
$codsemble:initialize-team Audit this workspace and help me choose the smallest useful team.
```

Codesemble presents Focused, Recommended, and Extended options, then shows the
exact project files and configuration diff. Choose an apply-capable mode if you
want changes: a preview-only plan is read-only and cannot later be applied.

Nothing is written until you approve the exact current plan with its
confirmation ID or complete six-word voice challenge.

### 3. Restart and give the team a goal

After apply, open another fresh Codex session so the generated agents are
discovered. You continue working through the primary thread:

```text
You → primary Codex thread → bounded specialists → primary integrates and reports
```

```text
Use the installed specialists where useful to review the checkout flow, fix the
highest-risk issue, and validate the result.
```

Specialists run only when the primary delegates separable work; they are not
always running. The primary remains accountable for decisions and final claims.

Maintain the team with
[`$codsemble:update-team`](docs/USAGE.md#update-a-team),
[`$codsemble:team-doctor`](docs/USAGE.md#diagnose), and
[`$codsemble:rollback-team`](docs/USAGE.md#roll-back).

## How it works

```text
Project evidence + your goal → required work → project team → preview → apply
```

1. **Audit** project signals locally.
2. **Compile** required work into evidence-backed team options.
3. **Preview and apply** only the exact fresh plan you confirm.

For example:

```text
Project evidence
  GitHub Actions + delivery goal + security requirement

Recommended Codex team
  Delivery specialist       owns the delivery work
  Security specialist       reviews the security boundary
  Independent validator     verifies the high-risk path

Spawned-worker ceiling: 4
```

The names and number of agents change with the project and goal. Codesemble
explains why every role is present before apply.

### Why 111 does not mean 111 agents

The 111-entry catalog is a library of reusable capability primitives—not a team
size, recommendation ceiling, or concurrency limit. Codesemble generates only
the roles justified by the current project: **Focused** covers required work,
**Recommended** adds independent verification only for high-risk required work,
and **Extended** adds only closed-rule optional lifecycle work; it may equal
Recommended.

Installed roles and concurrent workers are separate. A project can install 12
useful specialists while allowing only 4 workers to run at once; the primary
thread is not counted in that worker ceiling.

[Read the compiler contract →](docs/PROJECT_CAPABILITY_COMPILER.md) ·
[Explore the primitive library →](docs/ROLE_CATALOG.md)

## What it creates

```text
AGENTS.md                         bounded orchestration guidance
.codex/agents/<role>.toml         native specialist definitions
.codex/config.toml                optional project worker ceiling
.codex/codsemble/manifest.json    selected team and ownership record
.codex/codsemble/transactions/    reversible transaction history
```

## Safety and control

Audit and preview are read-only. Apply refuses the plan if relevant evidence,
runtime capabilities, ownership lineage, or output preimages changed. Codesemble
does not edit personal Codex settings, mark projects trusted, collect
credentials, control Codex runtime permissions, broaden the active sandbox, or
publish anything.

[Configuration safety →](docs/CONFIG_SAFETY.md) ·
[Voice-friendly approval →](docs/VOICE_APPROVAL.md) ·
[Privacy →](docs/PRIVACY.md) ·
[Threat model →](docs/THREAT_MODEL.md)

## Documentation

- **Get started:** [Usage](docs/USAGE.md) and [v0.2 migration](docs/MIGRATION_V0_2.md)
- **Understand generation:** [Architecture](docs/ARCHITECTURE.md) and
  [compiler contract](docs/PROJECT_CAPABILITY_COMPILER.md)
- **Review safety:** [Configuration safety](docs/CONFIG_SAFETY.md),
  [privacy](docs/PRIVACY.md), and [threat model](docs/THREAT_MODEL.md)
- **Check the evidence:** [Validation](docs/VALIDATION.md) and [bounded comparison](docs/USEFULNESS_COMPARISON.md)
- **Explore the project:** [Roadmap](ROADMAP.md),
  [Definition of Done](docs/DEFINITION_OF_DONE.md), and
  [brand guide](docs/BRAND.md)

## Project status

The v0.2 code line is present on `main`, but the privacy-hardening candidate
documented here is one local commit ahead of the recorded `origin/main`. It is
validated locally and has not been pushed, merged, tagged, or released; v0.1.0
remains the latest release.

Validation claims remain tied to the exact tested payload and environment.
[See the evidence →](docs/VALIDATION.md)

## Contributing

Try Codesemble in an isolated project and report where its audit, proposed roles,
or explanations were incomplete. See [Contributing](CONTRIBUTING.md),
[Support](SUPPORT.md), and [Security](SECURITY.md).

Codesemble is an independent open-source project licensed under the
[Apache License 2.0](LICENSE).
