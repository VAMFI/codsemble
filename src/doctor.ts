import { execFile } from "node:child_process";
import { access, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import type {
  DoctorCheck,
  DoctorReport,
  TransactionRecord,
} from "./types.js";
import { assertWorkspaceRoot, sha256 } from "./util.js";

const execFileAsync = promisify(execFile);

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function overallStatus(checks: DoctorCheck[]): DoctorReport["overallStatus"] {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

interface TeamManifest {
  schemaVersion?: unknown;
  planId?: unknown;
  proposal?: { maxConcurrentWorkers?: unknown };
  ownership?: {
    agentsBlock?: { path?: unknown; start?: unknown; end?: unknown };
    agentFiles?: unknown;
  };
}

async function readRegularFile(candidate: string): Promise<Buffer> {
  const stats = await lstat(candidate);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error("Expected a regular, single-link file");
  }
  return readFile(candidate);
}

export async function doctorWorkspace(workspace: string): Promise<DoctorReport> {
  const root = await assertWorkspaceRoot(workspace);
  const checks: DoctorCheck[] = [];
  const configPath = path.join(root, ".codex", "config.toml");

  if (await exists(configPath)) {
    try {
      const parsed = parseToml(
        (await readRegularFile(configPath)).toString("utf8"),
      ) as { agents?: { max_concurrent_threads_per_session?: unknown } };
      const concurrency =
        parsed.agents?.max_concurrent_threads_per_session;
      checks.push({
        id: "project-config",
        status: "pass",
        summary:
          typeof concurrency === "number"
            ? `.codex/config.toml is valid; spawned-worker ceiling is ${concurrency}`
            : ".codex/config.toml is valid; no spawned-worker ceiling is set",
      });
    } catch (error) {
      checks.push({
        id: "project-config",
        status: "fail",
        summary: ".codex/config.toml cannot be parsed",
        details: [error instanceof Error ? error.message : String(error)],
      });
    }
  } else {
    checks.push({
      id: "project-config",
      status: "warn",
      summary: "No project .codex/config.toml is present",
    });
  }

  const agentsDirectory = path.join(root, ".codex", "agents");
  let agentEntries: string[] = [];
  if (await exists(agentsDirectory)) {
    const invalid: string[] = [];
    const entries = (await readdir(agentsDirectory))
      .filter((entry) => entry.endsWith(".toml"))
      .sort();
    agentEntries = entries.map((entry) => `.codex/agents/${entry}`);
    for (const entry of entries) {
      try {
        const parsed = parseToml(
          (
            await readRegularFile(path.join(agentsDirectory, entry))
          ).toString("utf8"),
        ) as Record<string, unknown>;
        for (const required of [
          "name",
          "description",
          "developer_instructions",
        ]) {
          if (typeof parsed[required] !== "string" || parsed[required] === "") {
            invalid.push(`${entry}: missing ${required}`);
          }
        }
      } catch (error) {
        invalid.push(
          `${entry}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    checks.push({
      id: "agent-files",
      status: invalid.length > 0 ? "fail" : entries.length > 0 ? "pass" : "warn",
      summary:
        entries.length > 0
          ? `${entries.length} native agent file(s) inspected`
          : "The agent directory is empty",
      ...(invalid.length > 0 ? { details: invalid } : {}),
    });
  } else {
    checks.push({
      id: "agent-files",
      status: "warn",
      summary: "No .codex/agents directory is present",
    });
  }

  const manifestCandidates = [
    path.join(root, ".codex", "codsemble", "manifest.json"),
    path.join(root, ".codex", "team", "manifest.json"),
  ];
  const manifestPath = (
    await Promise.all(
      manifestCandidates.map(async (candidate) => ({
        candidate,
        found: await exists(candidate),
      })),
    )
  ).find(({ found }) => found)?.candidate;
  let manifest: TeamManifest | undefined;
  if (manifestPath) {
    try {
      manifest = JSON.parse(
        (await readRegularFile(manifestPath)).toString("utf8"),
      ) as TeamManifest;
      const valid =
        manifest.schemaVersion === 1 && typeof manifest.planId === "string";
      checks.push({
        id: "codsemble-manifest",
        status: valid ? "pass" : "fail",
        summary: valid
          ? `Codsemble manifest loaded from ${path.relative(root, manifestPath)}`
          : "Codsemble manifest is missing schemaVersion=1 or planId",
      });
      if (valid) {
        const ownedAgents = Array.isArray(manifest.ownership?.agentFiles)
          ? manifest.ownership.agentFiles.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : [];
        const missing = ownedAgents.filter(
          (entry) => !agentEntries.includes(entry),
        );
        const unexpected = agentEntries.filter(
          (entry) => !ownedAgents.includes(entry),
        );
        checks.push({
          id: "manifest-ownership",
          status: missing.length > 0 ? "fail" : unexpected.length > 0 ? "warn" : "pass",
          summary:
            missing.length === 0 && unexpected.length === 0
              ? "Manifest agent ownership matches installed native agent files"
              : "Installed agent files differ from manifest ownership",
          ...((missing.length > 0 || unexpected.length > 0)
            ? {
                details: [
                  ...missing.map((entry) => `missing: ${entry}`),
                  ...unexpected.map((entry) => `user-owned or unexpected: ${entry}`),
                ],
              }
            : {}),
        });

        const block = manifest.ownership?.agentsBlock;
        if (
          block &&
          block.path === "AGENTS.md" &&
          typeof block.start === "string" &&
          typeof block.end === "string"
        ) {
          try {
            const agentsText = (
              await readRegularFile(path.join(root, "AGENTS.md"))
            ).toString("utf8");
            const starts = agentsText.split(block.start).length - 1;
            const ends = agentsText.split(block.end).length - 1;
            checks.push({
              id: "managed-agents-block",
              status: starts === 1 && ends === 1 ? "pass" : "fail",
              summary:
                starts === 1 && ends === 1
                  ? "AGENTS.md contains exactly one Codsemble managed block"
                  : "AGENTS.md managed block markers are missing or ambiguous",
            });
          } catch (error) {
            checks.push({
              id: "managed-agents-block",
              status: "fail",
              summary: "Managed AGENTS.md could not be inspected",
              details: [error instanceof Error ? error.message : String(error)],
            });
          }
        }
      }
    } catch (error) {
      checks.push({
        id: "codsemble-manifest",
        status: "fail",
        summary: "Codsemble manifest is not valid JSON",
        details: [error instanceof Error ? error.message : String(error)],
      });
    }
  } else {
    checks.push({
      id: "codsemble-manifest",
      status: "warn",
      summary: "No Codsemble manifest is present; the workspace may be uninitialized",
    });
  }

  checks.push(await inspectTransactions(root));

  try {
    const { stdout } = await execFileAsync("codex", ["features", "list"], {
      cwd: root,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    const multiAgentLine = stdout
      .split(/\r?\n/)
      .find((line) => line.trimStart().startsWith("multi_agent"));
    checks.push({
      id: "codex-runtime",
      status:
        multiAgentLine && /\btrue\b/.test(multiAgentLine) ? "pass" : "warn",
      summary: multiAgentLine
        ? `Codex reports ${multiAgentLine.trim()}`
        : "Codex is installed, but multi-agent feature state was not reported",
    });
  } catch (error) {
    checks.push({
      id: "codex-runtime",
      status: "warn",
      summary: "Codex runtime diagnostics could not be executed",
      details: [error instanceof Error ? error.message : String(error)],
    });
  }

  return {
    schemaVersion: 1,
    overallStatus: overallStatus(checks),
    checks,
  };
}

async function inspectTransactions(root: string): Promise<DoctorCheck> {
  const directory = path.join(root, ".codex", "codsemble", "transactions");
  if (!(await exists(directory))) {
    return {
      id: "transactions",
      status: "warn",
      summary: "No Codsemble transaction history is present",
    };
  }
  try {
    const receiptNames = (await readdir(directory))
      .filter(
        (entry) =>
          entry.endsWith(".json") && !entry.endsWith(".rollback.json"),
      )
      .sort();
    const rollbackMarkerNames = (await readdir(directory))
      .filter((entry) => entry.endsWith(".rollback.json"))
      .sort();
    const receipts: TransactionRecord[] = [];
    const invalid: string[] = [];
    const rolledBackIds = new Set<string>();
    for (const name of rollbackMarkerNames) {
      try {
        const marker = JSON.parse(
          (
            await readRegularFile(path.join(directory, name))
          ).toString("utf8"),
        ) as {
          schemaVersion?: unknown;
          transactionId?: unknown;
          rolledBackAt?: unknown;
        };
        if (
          marker.schemaVersion !== 1 ||
          typeof marker.transactionId !== "string" ||
          typeof marker.rolledBackAt !== "string"
        ) {
          throw new Error("invalid rollback marker schema");
        }
        rolledBackIds.add(marker.transactionId);
      } catch (error) {
        invalid.push(
          `${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const name of receiptNames) {
      try {
        const parsed = JSON.parse(
          (
            await readRegularFile(path.join(directory, name))
          ).toString("utf8"),
        ) as TransactionRecord;
        if (
          parsed.schemaVersion !== 1 ||
          typeof parsed.transactionId !== "string" ||
          !Array.isArray(parsed.files)
        ) {
          throw new Error("invalid transaction schema");
        }
        receipts.push(parsed);
      } catch (error) {
        invalid.push(
          `${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const activeReceipts = receipts.filter(
      (receipt) => !rolledBackIds.has(receipt.transactionId),
    );
    const latest = [...activeReceipts]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .at(-1);
    const drift: string[] = [];
    if (latest) {
      for (const file of latest.files) {
        try {
          const current = await readRegularFile(path.join(root, file.relativePath));
          if (sha256(current) !== file.afterSha256) {
            drift.push(`${file.relativePath}: content changed after apply`);
          }
        } catch {
          drift.push(`${file.relativePath}: missing or not a regular file`);
        }
      }
    }
    const details = [...invalid, ...drift];
    return {
      id: "transactions",
      status:
        invalid.length > 0 ? "fail" : drift.length > 0 ? "warn" : receipts.length > 0 ? "pass" : "warn",
      summary:
        receipts.length > 0
          ? activeReceipts.length === 0
            ? `${receipts.length} transaction receipt(s) found; all are recorded as rolled back`
            : `${receipts.length} transaction receipt(s) found; latest active rollback ${drift.length === 0 ? "has matching postimages" : "is blocked by drift"}`
          : "No transaction receipts were found",
      ...(details.length > 0 ? { details } : {}),
    };
  } catch (error) {
    return {
      id: "transactions",
      status: "fail",
      summary: "Transaction history could not be inspected safely",
      details: [error instanceof Error ? error.message : String(error)],
    };
  }
}
