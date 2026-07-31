# Governance

Codesemble uses a maintainer-led, consensus-seeking model.

## Roles

- **Contributors** propose code, documentation, tests, designs, and issue
  analysis.
- **Reviewers** provide sustained, high-quality review in an area.
- **Maintainers** merge changes, manage releases, enforce project policies, and
  respond to security and conduct reports.

Maintainer status is earned through sustained trusted contribution and granted
by consensus of existing maintainers. Maintainers may step down at any time.
Inactive maintainers may be moved to emeritus status after a documented review.

## Decisions

Routine changes use pull-request review. Maintainers seek consensus and record
material tradeoffs in the pull request or an architecture decision record.

The following require at least two maintainer approvals when the project has
two active maintainers:

- security or privacy boundary changes;
- catalog or generated-schema migrations;
- dependency or license policy changes;
- release publication;
- governance and Code of Conduct changes.

If consensus cannot be reached, the project lead makes the decision and records
the rationale. Governance changes remain reviewable through the normal
contribution process.

## Releases

A release requires the applicable Definition of Done checks from the release
commit. Building a local release candidate, publishing a GitHub release,
listing a marketplace, and submitting to an external directory are separate
authorization and evidence boundaries.

No maintainer may use project access to publish, deploy, rotate credentials, or
change external infrastructure outside an approved release action.

## Assets and funds

Project names, domains, credentials, package namespaces, and donated funds must
be administered for the project's benefit and documented when introduced.

## Conduct

All project spaces follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
