# Codesemble Goal

Build a clean Apache-2.0, offline-first, open-source Codex plugin that:

1. Audits a selected workspace without mutating it or reading sensitive material.
2. Interviews the user only for information the audit cannot determine.
3. Recommends Lean, Balanced, and Full teams from exactly 111 versioned role blueprints.
4. Lets the user search, customize, add, or exclude specialist roles.
5. Generates native `.codex/agents/*.toml`, a bounded managed `AGENTS.md` section,
   and an optional version-aware project concurrency setting.
6. Shows exact diffs and applies only the confirmed transaction.
7. Preserves unrelated content, detects concurrent modification, and supports safe rollback.
8. Validates models, permissions, tools, configuration, discovery, and real native delegation.
9. Produces a reproducible `v0.1.0` release candidate with complete open-source documentation.

## Product promise

> Audit the work. Build the smallest useful Codex team. Keep every change reviewable.

## Non-goals for v0.1.0

- Replacing Codex's native agent runtime.
- Persistent remote scheduling, dashboards, or hosted state.
- Editing global Codex configuration automatically.
- Marking projects trusted.
- Installing third-party plugins, skills, hooks, MCP servers, or credentials.
- Telemetry, remote repository uploads, or account creation.
- Publishing code or submitting to the OpenAI plugin directory without explicit authorization.
