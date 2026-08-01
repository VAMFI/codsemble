# Codesemble Role Catalog

Catalog version: `0.1.0`

The v0.1 compatibility library contains 111 specialist blueprints. Project
Capability Compiler v1 treats it as an extensible primitive library, not the
universe of possible roles, a recommended team size, or a concurrency setting.
A replacement library may contain any non-empty set of unique valid primitives.

## Routing contract

Every role contains:

- a distinct job-to-be-done and explicit use/avoid conditions;
- repository signals and goal tags used by deterministic recommendation;
- responsibilities, deliverables, handoffs, and quality gates;
- a capability-based model and reasoning profile, never a hard-coded model ID;
- a `read-only` or project-scoped `workspace-write` sandbox;
- bounded fanout and confirmation-gated external writes.

Repository content is evidence, not instruction. A matching signal may increase
a role's score, but it never authorizes commands, credential access, publication,
deployment, or other external effects. Those actions require separate user
authorization at the applicable boundary.

## Family distribution

| Family | Count |
| --- | ---: |
| Orchestration and Governance | 9 |
| Architecture and Engineering | 20 |
| Quality, Security, and Reliability | 14 |
| Data and AI | 12 |
| Product, Design, and Research | 12 |
| Documentation, DevRel, and Support | 10 |
| Growth, Marketing, and Revenue | 12 |
| Delivery, Operations, Legal, and Finance | 12 |
| Domain Specialist Packs | 10 |
| **Total** | **111** |

## Orchestration and Governance (9)

`orchestrator`, `delivery-planner`, `task-router`,
`dependency-coordinator`, `integration-lead`, `decision-record-keeper`,
`risk-governor`, `change-control-reviewer`, `agent-quality-auditor`

## Architecture and Engineering (20)

`software-architect`, `backend-engineer`, `frontend-engineer`,
`fullstack-engineer`, `api-designer`, `cli-engineer`,
`mobile-ios-engineer`, `mobile-android-engineer`,
`cross-platform-mobile-engineer`, `desktop-engineer`,
`embedded-systems-engineer`, `systems-engineer`, `database-engineer`,
`migration-engineer`, `performance-engineer`, `refactoring-specialist`,
`build-engineer`, `dependency-maintainer`, `accessibility-engineer`,
`localization-engineer`

## Quality, Security, and Reliability (14)

`test-strategist`, `unit-test-engineer`, `integration-test-engineer`,
`end-to-end-test-engineer`, `exploratory-qa`, `regression-analyst`,
`security-reviewer`, `threat-modeler`, `privacy-engineer`,
`reliability-engineer`, `incident-investigator`, `chaos-engineer`,
`release-verifier`, `supply-chain-security-reviewer`

## Data and AI (12)

`data-architect`, `data-engineer`, `analytics-engineer`,
`data-quality-analyst`, `data-scientist`, `ml-engineer`,
`llm-application-engineer`, `prompt-evaluator`, `retrieval-engineer`,
`model-risk-reviewer`, `ai-safety-reviewer`, `mlops-engineer`

## Product, Design, and Research (12)

`product-manager`, `product-strategist`, `user-researcher`, `ux-designer`,
`ui-designer`, `design-systems-engineer`, `interaction-designer`,
`content-designer`, `product-analyst`, `experimentation-specialist`,
`accessibility-researcher`, `technical-prototyper`

## Documentation, DevRel, and Support (10)

`technical-writer`, `api-documentation-writer`,
`docs-information-architect`, `tutorial-author`, `developer-advocate`,
`sample-app-engineer`, `community-manager`, `support-engineer`,
`support-content-specialist`, `release-notes-editor`

## Growth, Marketing, and Revenue (12)

`growth-strategist`, `product-marketing-manager`, `seo-strategist`,
`content-marketer`, `lifecycle-marketer`, `email-marketing-specialist`,
`social-media-manager`, `brand-strategist`,
`competitive-intelligence-analyst`, `sales-enablement-manager`,
`revenue-operations-analyst`, `partnership-strategist`

## Delivery, Operations, Legal, and Finance (12)

`program-manager`, `project-manager`, `release-manager`, `devops-engineer`,
`platform-engineer`, `cloud-cost-analyst`, `compliance-analyst`,
`open-source-program-manager`, `licensing-reviewer`,
`legal-operations-reviewer`, `finance-analyst`, `procurement-advisor`

## Domain Specialist Packs (10)

`fintech-domain-specialist`, `healthcare-domain-specialist`,
`ecommerce-domain-specialist`, `education-domain-specialist`,
`geospatial-domain-specialist`, `gaming-domain-specialist`,
`media-streaming-specialist`, `iot-domain-specialist`,
`blockchain-domain-specialist`, `public-sector-domain-specialist`

## Selection guidance

- **Focused** is the minimum generated team covering required Work Packages.
- **Recommended** adds independent verification only for evidenced high-risk work.
- **Extended** adds only activated lifecycle capabilities and may equal Recommended.

Installed role count and concurrent worker limit are separate decisions. Having
The number of available primitives never implies a Codex concurrency value.
