# Usage

Use the Codex skills for the guided workflow. Direct CLI commands are provided
for inspection, automation, and troubleshooting.

## Before starting

- Select the exact workspace root.
- Preserve uncommitted work; Codesemble does not require a clean worktree.
- Use an isolated Codex environment for pre-release testing.
- Do not place answer or plan files inside the audited workspace unless you
  intentionally want them treated as project files.

The bundled executable is:

```text
<plugin-root>/scripts/codsemble.mjs
```

Skills resolve `<plugin-root>` from their own installed `SKILL.md` location.
They do not rely on a global environment variable.

## Initialize a team

Invoke:

```text
$initialize-team Set up a balanced team for this workspace.
```

The skill runs a read-only audit, asks only for missing intent, and presents
Lean, Balanced, and Full options. It asks separately for:

- desired installed role count;
- maximum concurrent spawned workers, excluding the primary thread;
- preview, project apply, manual snippet, or unchanged configuration mode.

Direct CLI flow:

```bash
node "<plugin-root>/scripts/codsemble.mjs" audit \
  --workspace "/absolute/path/to/workspace"

node "<plugin-root>/scripts/codsemble.mjs" capabilities \
  --workspace "/absolute/path/to/workspace"

node "<plugin-root>/scripts/codsemble.mjs" recommend \
  --workspace "/absolute/path/to/workspace" \
  --answers "/temporary/path/answers.json"

node "<plugin-root>/scripts/codsemble.mjs" plan \
  --workspace "/absolute/path/to/workspace" \
  --answers "/temporary/path/answers.json" \
  --proposal balanced
```

These commands emit JSON to standard output and do not write workspace files.
`capabilities` asks the installed local Codex executable for its version,
multi-agent feature state, and bounded model metadata. It discards raw provider
instructions and cannot grant permissions. If probing fails, keep model
configuration inherited and use manual or unchanged config mode.
Save the plan outside the workspace, inspect every proposed path and diff, then
apply with the exact confirmation id, which is a digest of the complete plan:

```bash
node "<plugin-root>/scripts/codsemble.mjs" apply \
  --workspace "/absolute/path/to/workspace" \
  --plan "/temporary/path/plan.json" \
  --confirm "<exact-confirmation-id>"
```

`apply` is the mutating boundary. Do not infer confirmation from an earlier
general request; show the final exact diff and ask for confirmation of the plan
id. In `manual` and `unchanged` modes, apply writes only the confirmed team
artifacts and leaves `.codex/config.toml` untouched. `preview` performs no
writes. An already-identical plan returns `noChanges: true` with no transaction
receipt and no reload request.

## Browse roles

```bash
node "<plugin-root>/scripts/codsemble.mjs" catalog
node "<plugin-root>/scripts/codsemble.mjs" catalog --search "security"
```

The catalog contains 111 options. Initialization normally installs a small,
non-overlapping subset.

## Update a team

Invoke:

```text
$update-team Re-audit and preview changes for the current team.
```

Update follows the same audit, recommend, plan, and exact-confirmation flow.
User-owned agents and content outside the Codesemble managed section remain
untouched. Overlapping edits cause a conflict instead of an overwrite.

## Diagnose

Invoke:

```text
$team-doctor Check this team's generated files and configuration.
```

Or run:

```bash
node "<plugin-root>/scripts/codsemble.mjs" doctor \
  --workspace "/absolute/path/to/workspace"
```

Doctor emits JSON and does not repair files. It distinguishes malformed files,
drift, policy/configuration warnings, and checks that require a fresh Codex
session. A clean doctor report is not by itself native delegation proof.

## Roll back

Invoke:

```text
$rollback-team Preview rollback of the latest Codesemble transaction.
```

Or select a transaction:

```bash
node "<plugin-root>/scripts/codsemble.mjs" rollback \
  --workspace "/absolute/path/to/workspace" \
  --transaction "<transaction-id>" \
  --confirm "<exact-transaction-id>"
```

Only a canonical receipt selected by transaction id can be rolled back;
external receipt JSON is never accepted. The `$rollback-team` skill performs a
read-only reverse preview first. The
direct `rollback` CLI command is the mutating boundary and requires the exact
transaction id after that review. Rollback restores only Codesemble-owned
postimages whose hashes still match. It refuses to overwrite later edits and
reports a manual recovery path for conflicts.

## After configuration changes

1. Run `$team-doctor`.
2. Run the applicable Codex strict-config diagnostic.
3. Start a fresh Codex session.
4. Confirm the generated roles are discovered.
5. Test a genuinely separable task and a trivial no-delegation task.

Do not describe static parsing as runtime proof.

## Troubleshooting

### Plugin script missing

Stop. Reinstall or rebuild the plugin. Never download an executable from an
unverified source as an automatic fallback.

### Project configuration appears inactive

Confirm the project is trusted, check closer nested `.codex/config.toml` files,
check command-line overrides and managed policy, and start a fresh session.
Codesemble never changes trust.

### Worker limit reached

Reduce fan-out or wait for existing workers. Do not retry in a tight loop. The
ceiling counts spawned threads, not installed roles.

### Plan changed before apply

Rerun audit and plan. Preimage drift invalidates the prior confirmation.

### Unsupported model or effort

Regenerate using inherited model configuration or a model verified for the
active Codex environment.
