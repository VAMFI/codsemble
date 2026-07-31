# Privacy

Codsemble v0.1.0 is offline-first. It does not include telemetry, analytics,
account creation, hosted storage, or repository upload.

## Data processed

The auditor derives bounded, typed signals such as languages, frameworks,
package boundaries, build/test tooling, CI metadata, and existing Codex project
files. Evidence uses workspace-relative paths.

Codsemble may persist the selected team, generator versions, content hashes,
and transaction metadata under `.codex/codsemble/`. Transaction records do not
need to store arbitrary source content or secret values.

## Data excluded

The auditor excludes:

- `.env` files and common credential, key, certificate, auth, and token paths;
- files ignored by the repository;
- dependency caches, build output, generated artifacts, and large binaries;
- symlinks and paths outside the selected workspace;
- arbitrary home-directory and global Codex configuration.

Codsemble does not execute scripts it discovers during audit.

These controls reduce exposure but cannot prove that a repository contains no
sensitive material. Review the preview and use a synthetic fixture when
evaluating unfamiliar repositories.

## Network behavior

The bundled v0.1.0 auditor and configuration compiler require no network access.
Codex itself and user-enabled tools may have separate network behavior governed
by their own settings and policies. Codsemble does not widen those settings.

Initialization never installs plugins, skills, hooks, MCP servers, dependencies,
or model providers.

## Logs and reports

Before sharing a doctor report or issue reproduction:

- remove absolute paths, repository names, usernames, and proprietary metadata;
- never include credentials or environment values;
- prefer a minimal synthetic fixture;
- label whether the result came from structural, simulated, or real-runtime
  evidence.

## Deletion

Preview-only commands do not write workspace state. Applied teams store their
manifest and transaction history under `.codex/codsemble/`. Use the rollback
skill to preview a safe reversal. Deleting remaining history manually is a
separate user decision and can reduce rollback capability.

## Future changes

Any telemetry, hosted analysis, remote catalog, or connector feature requires a
new privacy review, explicit opt-in, documented data flow, and separate consent.
