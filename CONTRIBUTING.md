# Contributing to Codsemble

Thank you for helping make repository-aware Codex teams safer and more useful.

## Before opening a change

- Search existing issues and pull requests.
- For a large feature, catalog-wide change, schema migration, or security
  boundary change, open a design issue first.
- Never include real credentials, private repositories, customer data, or
  personal Codex configuration in fixtures or logs.
- Do not copy private or incompatibly licensed agent packs into this project.

By submitting a contribution, you agree that it is licensed under Apache-2.0
and that you have the right to submit it.

## Development setup

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
npm run check
```

Use an isolated temporary workspace and an isolated Codex home for integration
tests. Never run mutating tests against your personal Codex configuration.

## Pull requests

Keep changes focused and include:

- the user-visible problem and intended outcome;
- tests for normal, edge, and failure paths;
- documentation for changed behavior or configuration;
- an explicit evidence label: structural, simulated, or real runtime;
- migration and rollback behavior for managed output changes;
- security and privacy impact.

All generated output must be deterministic for identical normalized inputs.
Preserve unrelated files and content outside managed boundaries.

## Role catalog contributions

The catalog contains exactly 111 roles. A role addition therefore requires a
reviewed replacement, merge, or catalog-version decision. Each role must have a
distinct job, evidence signals, deliverables, permission profile, model
capability profile, quality gates, dependencies, conflicts, and handoffs.

Avoid vendor-specific model promises. Use capability profiles and inherit when
the active Codex environment cannot verify a model.

## Security-sensitive changes

Changes involving traversal, ignored files, secret detection, TOML mutation,
managed blocks, permissions, concurrency, transaction records, or rollback need
adversarial tests and a second maintainer review. Do not publish a suspected
vulnerability in a public issue; follow [SECURITY.md](SECURITY.md).

## Commit and review hygiene

- Use clear, imperative commit subjects.
- Do not mix generated build output with unrelated source changes.
- Keep dependency updates isolated when practical.
- Resolve review comments with code, tests, or documented evidence.
- Maintainers may request smaller changes when a patch is difficult to audit.

## Certificate of origin

Contributors certify the Developer Certificate of Origin 1.1 by adding a
`Signed-off-by` trailer to each commit:

```text
Signed-off-by: Your Name <your-email@example.com>
```

Use `git commit -s` to add the trailer.
