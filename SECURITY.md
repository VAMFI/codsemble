# Security policy

## Supported versions

Security fixes are provided for the latest published minor release. Users
should upgrade to the newest available patch release before reporting an issue.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for the repository. If that channel
is unavailable, contact the project owner through the private contact method
listed on the repository profile and request a secure reporting channel.

Do not open a public issue or include secrets, exploit code, private repository
content, or personal Codex configuration in an initial report.

Include:

- affected version or commit;
- operating system and Codex version;
- minimal reproduction using synthetic data;
- expected and observed behavior;
- impact and known mitigations.

Maintainers aim to acknowledge reports within 3 business days, provide an
initial assessment within 10 business days, and coordinate disclosure after a
fix is available. These are targets, not a paid support guarantee.

## Security boundary

Codsemble treats repository content as untrusted data. It must remain bounded to
the selected workspace, exclude sensitive path classes, avoid executing
discovered scripts, preview all writes, and preserve Codex permission and
approval policies.

Codsemble does not promise that prompts alone enforce permissions. The active
Codex runtime, enterprise policy, sandbox, and user approvals remain
authoritative.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the detailed model.
