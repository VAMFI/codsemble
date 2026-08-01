# Project Capability Compiler v1

Project Capability Compiler v1 is the deterministic core of Codesemble v0.2.
It answers three human questions:

1. What work boundaries does this project and goal actually require?
2. What is the smallest specialist team that covers them?
3. Why is each agent safe and useful here?

## Inputs

- A bounded `AuditReport` created from allowlisted local files.
- Explicit goal tokens, project stage, optimization preference, prohibited
  actions, requested roles, and worker policy.
- A live Codex capability report for adapters, models, and reasoning efforts.
- A non-empty local primitive library. Its size is not an output constraint.

Raw repository prose, script bodies, credentials, ignored files, and remote data
are not compiler inputs.

## EvidenceRef

Each repository EvidenceRef represents one typed observation at one validated
relative path. Its identity includes the detector, typed value, confidence,
path, and inspected-file digest. User goals and project stage use separate
typed references. References are sorted and content-addressed.

Managed Codesemble output is lifecycle state, not project-capability evidence;
installing a team therefore does not change its own design.

## Project Capability Map

Repository facets can specialize explicit intent, but passive files do not
activate work. A README, license, code of conduct, CI file, or existing agent is
not enough to create a documentation, legal, community, release, or orchestration
specialist.

Every capability records:

- a stable `unitId` for the deepest audited manifest root containing its evidence;
- kind and human label;
- required versus observed-only status;
- risk level;
- supporting repository evidence and confirmed goal references.

Unknown goals become generic goal-bound capabilities. They do not invent a
framework, stack, domain, or deployment surface.

The workspace root uses `unitId: "."`. Nested manifests create nested units,
and an evidence leaf attaches to the deepest containing unit. Evidence is
partitioned by unit before representative-reference bounds are applied, so a
large root package cannot erase a smaller nested package from the design.

## Work Packages

A Work Package is the independently reviewable unit of delegation. It records
the project unit, intended outcome, covered capability, risk, advisory project paths,
evidence, dependencies, and validation boundary.

Path scopes help coordination; current native Codex sandbox modes do not enforce
per-role path allowlists. Codesemble says this explicitly in generated prompts.

## Generated role admission

The deterministic generator composes compatible Work Packages into candidate
roles. Admission then rejects any candidate that:

- references an unknown capability, Work Package, evidence leaf, or primitive;
- carries an unknown field, model profile, reasoning effort, sandbox, or cost class;
- borrows evidence or paths outside its assigned Work Packages;
- uses an uninspected, unsafe, secret-like, absolute, or escaping path;
- requests an unavailable tool;
- requests workspace-write without an implementation package, edit capability,
  and a real admitted path;
- omits mandatory prohibitions;
- requests external writes or supplies unsupported authority.

Generated implementation ownership is grouped by capability kind and project
unit. A monorepo therefore receives distinct unit-scoped owners rather than one
broad role whose advisory paths span unrelated packages.

Candidates do not provide developer instructions, TOML, output paths, concrete
model ids, hooks, MCP configuration, credentials, providers, or global settings.
Codesemble compiles admitted structured fields into a fixed instruction template.

## Coverage proposals

- **Focused** contains every role needed to cover activated required capabilities.
- **Recommended** adds an independent validator only for high-risk required work.
- **Extended** adds activated optional lifecycle work. It can legitimately equal
  Recommended when no additional specialist is justified.

`desiredRoleCount` is a soft preference. It never adds filler or removes required
coverage. `maxConcurrentWorkers` is a separate capacity setting.

## Identity and lifecycle

Canonical evidence, capability, Work Package, role, proposal, and compiler data
produce the Team Design ID. The complete design digest and every referenced
repository evidence precondition enter the plan and confirmation digest. The v2
manifest stores compact design provenance and ownership hashes.

Approval and apply rebuild referenced evidence. A changed or missing leaf
invalidates the plan; an unrelated file does not. Apply independently rechecks
Codex capabilities and exact output preimages before the transaction begins.

Existing v1 manifests and receipts remain readable. A v2 update requires a
canonical apply receipt binding the current manifest before Codesemble accepts
automatic ownership; otherwise it refuses adoption.

## Determinism boundary

The same semantic audit evidence, goals, primitive library, and policy produce
the same Team Design regardless of insertion order. An irrelevant file does not
change existing roles. A relevant evidence-content change updates its leaf and
requires a new plan.

Deterministic fixture proof does not substitute for fresh native Codex discovery,
delegation, operating-system behavior, or physical voice-device evidence.
