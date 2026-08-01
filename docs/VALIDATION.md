# Validation evidence

Codesemble reports structural, simulated, native-runtime, operating-system,
physical-device, publication, and release evidence separately. Passing one
boundary never promotes a claim at another.

## v0.2 local candidate

Run from a clean locked checkout:

```bash
npm ci
npm run check
npm run archive:verify
npm run sbom:verify
npm run checksums:verify
node .github/scripts/validate-repository.mjs
node .github/scripts/check-deterministic-build.mjs
npm audit --audit-level=high
```

Validate the plugin and each skill with the official validators from the active
Codex installation. Validator locations are environment-owned and are not
downloaded by the project.

The current local candidate passes:

- strict TypeScript checking;
- 131 automated tests across 19 files, including audit, capability compilation,
  representative fixtures, semantic golden/property behavior, generated-role
  admission, evidence freshness, voice confirmation, CLI integration, manifest
  lineage, no-clobber transactions, doctor, update convergence, and rollback;
- the current non-empty 111-entry compatibility primitive library, with no
  functional count requirement in schema, validation, recommendation, or concurrency;
- deterministic bundled CLI generation and smoke testing;
- official plugin validation and official validation of all four bundled skills;
- repository metadata and absolute developer-path checks;
- a deterministic complete 12-file plugin archive at
  `artifacts/codsemble-0.2.0-plugin.tgz`;
- deterministic lockfile-complete CycloneDX 1.5 SBOM generation for 128 components
  at `artifacts/codsemble-0.2.0-rc.sbom.cdx.json`;
- complete source-payload checksum verification;
- `npm audit --audit-level=high` with zero reported vulnerabilities.

The test count matching the current primitive count is coincidental. Neither
number controls generated team size or spawned-worker capacity.

## Representative compiler fixtures

The committed corpus currently covers:

- empty/trivial planning;
- Next-style TypeScript web work with testing and security goals;
- Flutter mobile work;
- Rust CLI work;
- Python data-service work;
- documentation-only work;
- production regulated delivery.
- a polyglot monorepo with deepest-manifest unit ownership;
- a legacy service without test evidence;
- a truncated ambiguous workspace;
- an existing managed-team update boundary;
- injected repository prose; and
- an interrupted apply journal consumed by transaction refusal tests.

The current properties prove 64 seeded signal/evidence/goal/primitive
permutations, atomic evidence, distinct monorepo unit ownership, exact required
coverage, Focused role-removal minimality, tier inclusion, irrelevant-file
stability, relevant-evidence identity change, no desired-count padding,
concurrency independence, strict admission, v1-to-v2 migration, v2 provenance,
v2 receipt lineage, evidence-drift refusal, update convergence, and rollback.
Checked-in semantic goldens cover the polyglot and high-risk delivery designs.

## Cross-platform CI

The workflow declares Node 22 and 24 on Ubuntu, macOS, and Windows. It runs the
repository suite, catalog validation, repository validator, bundled-CLI and
complete-archive reproducibility checks, checksum/SBOM verification, dependency
audit, and a clean-generated-diff gate.

This declaration is not a passing result. Public cross-platform evidence must
come from the focused PR at its exact head commit. Windows CI proves the Node and
filesystem simulation boundary, not native Codex discovery on Windows.

## Native Codex runtime

`artifacts/runtime-evidence.json` is historical v0.1 evidence. It does not bind
the v0.2 Project Capability Compiler payload and cannot prove v0.2 completion.

Before v0.2 completion, a fresh isolated session must install the exact archived
plugin into an isolated Codex home and disposable trusted project, then record:

- source commit, archive SHA-256, logical payload digest, Codex/Node versions,
  OS, architecture, and adapter;
- plugin discovery and one non-catalog project-generated role;
- preview no-write, exact confirmed apply, and fresh-session role discovery;
- one attributable separable delegation plus primary-thread integration;
- bounded capacity rejection without a retry storm and a trivial no-spawn turn;
- meaningful update, no-op convergence, and reverse rollback preserving user bytes.

The record must be sanitized and regenerated for the exact final candidate.

## Voice evidence

Transcript tests prove deterministic challenge derivation, terminal preview
behavior, conservative normalization, vague/partial/reordered/cross-plan refusal,
full-ID compatibility, and zero writes on refusal.

They do not prove Android microphone behavior, speech recognition success,
speaker identity, echo suppression, trusted transcript origin, or physical-device
usability. Those require separately labeled Android evidence.

## Usefulness evidence

The bounded comparison suite proves structural relevance, coverage, minimality,
monorepo unit isolation, independent high-risk validation, and no padding against
compatibility-library and single-primary baselines. See
[`USEFULNESS_COMPARISON.md`](USEFULNESS_COMPARISON.md).

These checks do not prove better completion quality, cost, latency, or production
outcomes. Those claims require separately designed task trials.

## Remaining external boundaries

- Fresh v0.2 native runtime evidence is pending.
- Public PR CI and CodeQL at the final head are pending.
- Physical Android voice evidence is pending.
- Merge, tag, signed provenance, GitHub release, marketplace publication, and
  OpenAI directory submission are separate authorization and external-action boundaries.
