# Usage

Use the Codex skills for the guided workflow. Direct CLI commands are provided
for inspection, automation, and troubleshooting.

## Before starting

- Select the exact workspace root.
- Preserve uncommitted work; Codesemble does not require a clean worktree.
- Use an isolated Codex environment for pre-release testing.
- Answer and plan files may be saved outside the workspace. If an approval plan
  is saved inside the workspace, it is treated as an unrelated artifact and does
  not change the typed capability-evidence fingerprint.

The bundled executable is:

```text
<plugin-root>/scripts/codsemble.mjs
```

Skills resolve `<plugin-root>` from their own installed `SKILL.md` location.
They do not rely on a global environment variable.

## Initialize a team

Invoke:

```text
$initialize-team Build the recommended team for this workspace.
```

The skill runs a read-only audit, asks only for missing intent, and presents
Focused, Recommended, and Extended options. It asks separately for:

- desired role count as a soft preference, never a padding target;
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
  --proposal recommended
```

These commands emit JSON to standard output and do not write workspace files.
Proposal rationales distinguish evidence-bound coverage roles generated from the
audit, explicit user-selected roles, and the total proposed team size.
`capabilities` asks the installed local Codex executable for its version,
multi-agent feature state, and bounded model metadata. It discards raw provider
instructions and cannot grant permissions. If probing fails, keep model
configuration inherited and use manual or unchanged config mode.
Save the plan outside the workspace and inspect every proposed path and diff.
Then ask the read-only approval command whether the plan is apply-capable:

```bash
node "<plugin-root>/scripts/codsemble.mjs" approval \
  --workspace "/absolute/path/to/workspace" \
  --plan "/temporary/path/plan.json"
```

A `preview-only` result is terminal: it has no approval challenge and cannot be
passed to `apply`. To make changes, re-probe and regenerate a new plan using
`apply-project`, `manual`, or `unchanged` mode, then show its exact diff.

For an apply-capable plan, use either the exact confirmation id, which is a
digest of the complete plan:

```bash
node "<plugin-root>/scripts/codsemble.mjs" apply \
  --workspace "/absolute/path/to/workspace" \
  --plan "/temporary/path/plan.json" \
  --confirm "<exact-confirmation-id>"
```

or its complete voice challenge:

```bash
node "<plugin-root>/scripts/codsemble.mjs" apply \
  --workspace "/absolute/path/to/workspace" \
  --plan "/temporary/path/plan.json" \
  --confirm-voice "approve team <six-word-challenge>"
```

Voice matching accepts only case, whitespace or hyphen separators, and one
terminal punctuation mark. `yes`, `continue`, `go ahead`, partial phrases,
reordered words, approximate matches, and cross-plan challenges are refused.
See [Voice-friendly plan approval](VOICE_APPROVAL.md).

`apply` is the mutating boundary. Do not infer confirmation from an earlier
general request, proposal choice, positive feedback, or read-only consent; show
the final exact diff and ask for the current confirmation ID or complete voice
challenge. In `manual` and `unchanged` modes, apply writes only the confirmed team
artifacts and leaves `.codex/config.toml` untouched. `preview` performs no
writes. An already-identical plan returns `noChanges: true` with no transaction
receipt and no reload request.

## Browse roles

```bash
node "<plugin-root>/scripts/codsemble.mjs" catalog
node "<plugin-root>/scripts/codsemble.mjs" catalog --search "security"
```

The bundled catalog currently contains reusable primitives. Initialization does
not select a team by catalog count: it generates project roles from evidence-bound
Work Packages and uses matching primitives only as deterministic ingredients.

Legacy `lean`, `balanced`, and `full` CLI proposal names remain accepted as aliases
for `focused`, `recommended`, and `extended` during v0.1 migration.

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

### Plan or evidence changed before apply

Rerun audit and plan. Referenced-evidence drift, capability drift, or output
preimage drift invalidates the prior confirmation. Unrelated files do not.

### Unsupported model or effort

Regenerate using inherited model configuration or a model verified for the
active Codex environment. Codesemble accepts `max` and `ultra` only when the
selected live model reports that exact effort; it never silently downgrades an
agent's requested reasoning level.
