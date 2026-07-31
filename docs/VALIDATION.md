# Validation evidence

Codsemble separates structural, simulated, and real-runtime evidence. A result
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
- 87 unit, golden, property, security, fixture, transaction, capability,
  doctor, compiler, and bundled-CLI tests;
- deterministic bundle generation;
- full source-payload checksum verification;
- exactly 111 schema-valid, uniquely identified role blueprints;
- the official plugin validator;
- the official skill validator for all four skills;
- repository metadata and absolute-path leak checks;
- deterministic, lockfile-complete CycloneDX 1.5 SBOM generation and
  verification for 133 components;
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
`9bdd2381cac00015eaa0698edde36d589e542859` and the reproducible 12-file plugin
payload digest recorded in `artifacts/runtime-evidence.json`. The digest
algorithm is implemented by `scripts/plugin-payload-digest.mjs`.

The following boundaries passed:

1. The local marketplace exposed `codsemble@codsemble`.
2. The plugin installed and appeared enabled in the isolated home.
3. A Codsemble plan generated two project-native custom agents and set a
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
9. The project transaction rolled back, leaving no generated project files
   outside receipt-owned transaction history. Five rollback source
   quarantines remained under transaction history as the documented
   open-inode recovery boundary.

The sanitized machine-readable record is
`artifacts/runtime-evidence.json`. Raw session files are not included because
they referenced local authentication state.

## Honest remaining boundaries

- Cross-platform CI is configured but has not run on a public CI provider.
  Local Linux arm64 and macOS arm64 checks pass; Windows remains CI-only and
  unproven until publication.
- Real-runtime proof currently covers one macOS arm64 host and Codex 0.145.0.
- The repository has not been pushed, tagged, or released.
- OpenAI plugin-directory submission is a separate external review boundary.
