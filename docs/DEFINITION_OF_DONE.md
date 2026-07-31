# Definition of Done

Codesemble `v0.1.0` is a release candidate only when all applicable items pass.

## Product

- The catalog contains exactly 111 unique, documented role blueprints.
- Audit, intake, recommendation, preview, apply, doctor, update, and rollback work.
- Small projects receive small teams; trivial tasks retain a single-agent path.
- Every recommendation cites typed workspace evidence or a user answer.
- Generated roles have distinct ownership, deliverables, permissions, and verification contracts.

## Safety

- Audit remains inside the approved workspace and never follows symlinks.
- Ignored, untracked-by-default, secret-like, binary, oversized, and generated files are excluded.
- Repository prompt injection cannot alter policy or execute code.
- Preview performs no writes.
- Apply preserves unrelated content, validates preimages, publishes each file
  without clobbering a racing writer, and is reversible during an uninterrupted
  cooperative transaction.
- The exact confirmation id is recomputed from the complete plan before apply.
- Update deletes only stale agent files owned by the prior Codesemble manifest.
- No global config, trust, credentials, plugins, MCP servers, hooks, or external systems are changed.

## Validation

- Type checks, unit tests, fixture tests, golden tests, property tests, and security tests pass.
- Plugin and every skill pass the official validators.
- The release payload is reproducible and contains no secrets or absolute developer paths.
- A fresh isolated Codex session discovers the plugin and generated roles.
- A real separable task produces attributable specialist results and root integration.
- Capacity exhaustion degrades safely and a trivial task causes no unnecessary delegation.
- Rollback restores the prior project state without overwriting later user
  edits; interruption is detected and retained for manual recovery.

## Open source

- Apache-2.0 license, README, architecture, threat model, privacy statement,
  contribution guide, code of conduct, security policy, support policy,
  changelog, roadmap, CI, SBOM, and checksums are ready. Signed release
  provenance remains a separately reported publication boundary.
- Local proof, public GitHub release, marketplace exposure, OpenAI submission,
  and universal publication are reported as separate boundaries.
