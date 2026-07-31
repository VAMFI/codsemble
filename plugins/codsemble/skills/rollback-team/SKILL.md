---
name: rollback-team
description: Inspect and safely revert a selected Codesemble project transaction while refusing to overwrite later user changes. Use when a user asks to undo, revert, uninstall, or roll back a generated Codex team or project concurrency change.
---

# Roll back a Codex team transaction

Resolve this skill's installed directory and plugin root as `../..`. Use the
absolute bundled CLI path:

```text
node <plugin-root>/scripts/codsemble.mjs
```

Stop if the script, manifest, or transaction history is missing. Never invent
rollback ownership from filenames.

## Guardrails

- Roll back only Codesemble-owned paths and managed sections listed in the
  selected transaction.
- Never edit global `~/.codex/config.toml`, project trust, managed policy,
  credentials, providers, third-party components, or external systems.
- Never overwrite a file whose current hash differs from the recorded
  transaction postimage.
- Do not treat “uninstall the plugin” as permission to delete generated project
  files or transaction history.
- Keep role removal separate from worker-ceiling restoration. Restore the prior
  project value only if the selected transaction changed it.

## Workflow

1. Run:

   ```text
   node <plugin-root>/scripts/codsemble.mjs doctor --workspace <absolute-workspace>
   ```

   Identify available transaction ids, drift, and conflicts.
   Stop if an incomplete mutation lock or pending record exists. Preserve the
   target, quarantine, backup, and pending record for manual recovery.

2. Ask the user to select an exact transaction if the request is ambiguous.
   Resolve the selected transaction record inside
   `.codex/codsemble/transactions/`. Read its metadata and current target
   hashes without modifying the workspace.

3. Present a reverse preview:

   - transaction id and creation time;
   - files that would be restored or removed;
   - managed section changes;
   - prior and current project concurrency values;
   - conflicts caused by later edits;
   - what remains untouched.

   Never accept a transaction JSON supplied from outside the workspace. The
   canonical transaction id must resolve inside Codesemble's transaction
   directory.

4. Ask for explicit confirmation of the exact transaction id and displayed
   reverse changes. Do not infer this confirmation from the initial rollback
   request.

5. Only after confirmation, run:

   ```text
   node <plugin-root>/scripts/codsemble.mjs rollback \
     --workspace <absolute-workspace> \
     --transaction <exact-transaction-id> \
     --confirm <exact-transaction-id>
   ```

   If the CLI reports drift or conflict, stop. Provide the conflict details and
   manual recovery guidance; never force restoration.

6. Run `doctor` again. Report what was restored, what conflicted, and whether a
   fresh Codex session is needed. Explain that rollback does not uninstall the
   plugin or alter global configuration.
