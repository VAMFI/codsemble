# Validation evidence

Codesemble separates structural, simulated, and real-runtime evidence. A result
at one level is not promoted to a broader claim.

## Structural and simulated checks

The local release-candidate command is:

```bash
npm ci
npm run check
npm run sbom:verify
node .github/scripts/validate-repository.mjs
node .github/scripts/check-deterministic-build.mjs
npm run checksums:verify
npm audit --audit-level=high
```

The current candidate passes:

- strict TypeScript checking;
- 94 unit, golden, property, security, fixture, transaction, capability,
  voice-confirmation, doctor, compiler, and bundled-CLI tests;
- deterministic bundle generation;
- full source-payload checksum verification;
- exactly 111 schema-valid, uniquely identified role blueprints;
- the official plugin validator;
- the official skill validator for all four skills;
- repository metadata and absolute-path leak checks;
- deterministic, lockfile-complete CycloneDX 1.5 SBOM generation and
  verification for 128 components;
- `npm audit` with zero reported vulnerabilities.
- the complete test check on Linux arm64 in a clean Node 20
  `bookworm-slim` container with Git installed.

Ignored secret-like fixture files are created dynamically, so a clean checkout
does not depend on ignored developer-worktree state. Git audits exclude
ordinary untracked files by default while still recognizing bounded untracked
Codex-managed state.

The checked-in SBOM is
`artifacts/codsemble-0.1.0-rc.sbom.cdx.json`.

## Real Codex runtime

The runtime proof used Codex CLI 0.145.0 on macOS arm64, an isolated Codex home,
and a disposable trusted Git project. Existing authentication was referenced
without copying or recording credential contents.

The refreshed run is bound to source commit
`a3b15151bd74fd1aabea6de94b21555cdc61d384` and the reproducible 12-file plugin
payload digest recorded in `artifacts/runtime-evidence.json`. The digest
algorithm is implemented by `scripts/plugin-payload-digest.mjs`.

The following boundaries passed:

1. The local marketplace exposed `codsemble@codsemble`.
2. The plugin installed and appeared enabled in the isolated home.
3. A Codesemble plan generated two project-native custom agents and set a
   spawned-worker ceiling of two.
4. A fresh ordinary Codex session spawned both generated roles concurrently:
   `delivery_planner` and `integration_test_engineer`.
5. Child session metadata identified the expected custom role and included its
   generated developer instructions.
6. The root integrated the two attributable child results.
   Generated guidance caused typed spawns to use a bounded history fork, as
   required by the tested Codex runtime.
7. A three-spawn capacity test admitted two children and rejected the third
   with `agent thread limit reached`; no retry storm occurred.
8. A trivial turn produced no subagent activity.
9. A converged update produced five state-bound `verify` actions. Applying that
   exact plan returned `noChanges: true`, `transaction: null`, and
   `reloadRequired: false`, while the receipt count remained unchanged.
10. Both mutating transactions rolled back in reverse order, leaving no
    generated project files outside receipt-owned transaction history. Six
    rollback source quarantines remained under transaction history as the
    documented open-inode recovery boundary.

The sanitized machine-readable record is
`artifacts/runtime-evidence.json`. Raw session files are not included because
they referenced local authentication state.

## Public CI and remaining boundaries

- The public CI run for the runtime-bound source passed Node.js 20 and 22 on
  Ubuntu, macOS, and Windows. See
  [GitHub Actions run 30624509423](https://github.com/VAMFI/codsemble/actions/runs/30624509423).
- CodeQL passed on the same source. See
  [CodeQL run 30624509442](https://github.com/VAMFI/codsemble/actions/runs/30624509442).
- Real-runtime proof currently covers one macOS arm64 host and Codex 0.145.0.
- Voice tests use transcript strings. They do not prove Android microphone,
  realtime echo suppression, speech recognition, speaker identity, or trusted
  UI channel binding.
- OpenAI plugin-directory submission is a separate external review boundary.
