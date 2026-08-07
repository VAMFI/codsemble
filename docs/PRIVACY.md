# Privacy

Codesemble v0.2.0 deterministic mode is offline-first. It does not include telemetry, analytics,
account creation, hosted storage, or repository upload.

## Data processed

The auditor derives bounded, typed signals such as languages, frameworks,
package boundaries, build/test tooling, CI metadata, and existing Codex project
files. Evidence uses workspace-relative paths.

Codesemble may persist typed evidence identifiers, relative allowlisted paths,
capabilities, Work Packages, admitted team provenance, generator versions,
content hashes, and transaction metadata under `.codex/codsemble/`. Repository
excerpts are not persisted in generated role instructions or receipts.

The voice-friendly path processes only the transcript string passed to the
local CLI. Codesemble does not record audio, identify a speaker, or persist the
spoken challenge or transcript in the workspace or transaction receipt. The
calling voice surface may have separate data handling that remains outside this
plugin's boundary.

## Data excluded

The auditor excludes:

- `.env` files and common credential, key, certificate, auth, OAuth, API-key,
  service-account, access-token, and refresh-token stores. Auth/token matching
  is limited to boundary-delimited configuration/data filenames such as JSON,
  YAML, TOML, plist, properties, and XML plus named CLI/cloud auth stores;
  ordinary source and documentation such as `src/auth.ts` and `docs/AUTH.md`
  remain eligible. Ambiguous config names such as `design-tokens.json` fail
  closed and are excluded;
- files ignored by the repository;
- dependency caches, build output, generated artifacts, and large binaries;
- symlinks and paths outside the selected workspace;
- arbitrary home-directory and global Codex configuration.

Codesemble does not execute scripts it discovers during audit.

These controls reduce exposure but cannot prove that a repository contains no
sensitive material. Review the preview and use a synthetic fixture when
evaluating unfamiliar repositories.

## Network behavior

The bundled v0.2.0 deterministic auditor and capability compiler require no network access.
Codex itself and user-enabled tools may have separate network behavior governed
by their own settings and policies. Codesemble does not widen those settings.

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

Any assisted synthesis, telemetry, hosted analysis, remote catalog, or connector feature requires a
new privacy review, explicit opt-in, documented data flow, and separate consent.
