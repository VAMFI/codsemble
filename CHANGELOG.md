# Changelog

All notable changes to Codesemble will be documented here.

The project follows Semantic Versioning and keeps changes under `Unreleased`
until a release is explicitly published.

## Unreleased

### Added

- Voice-friendly plan approval with a strict six-word spoken challenge derived
  from the unchanged full confirmation digest.
- A read-only `approval` command that clearly separates terminal preview plans
  from apply-capable plans.
- Project Capability Compiler v1 with atomic typed EvidenceRefs, a Project
  Capability Map, bounded Work Packages, generated-role admission, and Team IR v2.
- Coverage-driven Focused, Recommended, and Extended proposals with no
  desired-count filler.
- Referenced-evidence freshness checks at approval and apply.
- Strict v2 manifest provenance while retaining v1 plan, receipt, doctor, and
  rollback compatibility.

### Changed

- The bundled 111-role catalog is now an extensible primitive library, not a
  recommendation ceiling, installed-team target, or concurrency limit.
- Concurrency uses an independently named safety ceiling and retains the
  explicit acknowledgement gate above 16 workers.
- CI targets Node 22 and 24 on Ubuntu, macOS, and Windows.

## 0.1.0 - 2026-07-31

### Added

- Initial offline-first Codex plugin architecture.
- Bounded local Codex version, feature, model, tool, and permission capability
  reporting.
- Bounded workspace audit and typed evidence model.
- Versioned catalog of 111 specialist role blueprints.
- Lean, Balanced, and Full team recommendation flow.
- Native Codex agent generation with project-scoped concurrency planning.
- Preview/apply transactions, doctor, update, and rollback workflows.
- Content-bound confirmation, canonical-receipt-only rollback, and reversible
  stale-role deletion.
- Golden, property, and adversarial security regression suites.
- Open-source governance, security, privacy, support, and CI foundations.

### Fixed

- Cross-platform transaction paths, Windows command launchers, deterministic
  build invocation, and checksum verification in public CI.
