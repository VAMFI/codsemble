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
import {
  assertContainedPath,
  assertNoSymlinkAncestors,
  assertWorkspaceRoot,
  sha256,
} from "./util.js";
import {
  assertValidRollbackMarker,
  assertValidTransactionRecord,
  generatedManifestSchema,
  type RollbackMarker,
} from "./transaction.js";

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

type TeamManifest = ReturnType<typeof generatedManifestSchema.parse>;
class LegacyManifestError extends Error {}

async function readRegularFile(
  candidate: string,
  root: string,
): Promise<Buffer> {
  await assertNoSymlinkAncestors(root, candidate);
  const stats = await lstat(candidate);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error("Expected a regular, single-link file");
  }
  return readFile(candidate);
}

async function readSafeDirectory(
  candidate: string,
  root: string,
): Promise<string[]> {
  await assertNoSymlinkAncestors(root, candidate);
  const stats = await lstat(candidate);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Expected a real directory");
  }
  return readdir(candidate);
}

export async function doctorWorkspace(workspace: string): Promise<DoctorReport> {
  const root = await assertWorkspaceRoot(workspace);
  const checks: DoctorCheck[] = [];
  const configPath = path.join(root, ".codex", "config.toml");

  if (await exists(configPath)) {
    try {
      const parsed = parseToml(
        (await readRegularFile(configPath, root)).toString("utf8"),
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
    let entries: string[] = [];
    try {
      entries = (await readSafeDirectory(agentsDirectory, root))
        .filter((entry) => entry.endsWith(".toml"))
        .sort();
    } catch (error) {
      invalid.push(
        error instanceof Error ? error.message : String(error),
      );
    }
    agentEntries = entries.map((entry) => `.codex/agents/${entry}`);
    for (const entry of entries) {
      try {
        const parsed = parseToml(
          (
            await readRegularFile(path.join(agentsDirectory, entry), root)
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
      const manifestValue: unknown = JSON.parse(
        (await readRegularFile(manifestPath, root)).toString("utf8"),
      );
      const parsed = generatedManifestSchema.safeParse(manifestValue);
      if (!parsed.success) {
        if (isLegacyManifestWithoutOwnershipHashes(manifestValue)) {
          throw new LegacyManifestError(
            "Legacy manifest has no agent ownership hashes; run the update-team workflow to migrate it safely",
          );
        }
        throw new Error(`invalid manifest schema: ${parsed.error.message}`);
      }
      manifest = parsed.data;
      checks.push({
        id: "codsemble-manifest",
        status: "pass",
        summary: `Codsemble manifest loaded from ${path.relative(root, manifestPath)}`,
      });
      {
        const ownedAgents = manifest.ownership.agentFiles;
        const missing = ownedAgents.filter(
          (entry) => !agentEntries.includes(entry),
        );
        const unexpected = agentEntries.filter(
          (entry) => !ownedAgents.includes(entry),
        );
        const changed: string[] = [];
        for (const entry of ownedAgents) {
          try {
            const content = await readRegularFile(path.join(root, entry), root);
            if (sha256(content) !== manifest.ownership.agentSha256[entry]) {
              changed.push(entry);
            }
          } catch {
            if (!missing.includes(entry)) changed.push(entry);
          }
        }
        checks.push({
          id: "manifest-ownership",
          status:
            missing.length > 0 || changed.length > 0
              ? "fail"
              : unexpected.length > 0
                ? "warn"
                : "pass",
          summary:
            missing.length === 0 &&
            unexpected.length === 0 &&
            changed.length === 0
              ? "Manifest agent ownership and hashes match installed native agent files"
              : "Installed agent files differ from manifest ownership",
          ...((missing.length > 0 ||
            unexpected.length > 0 ||
            changed.length > 0)
            ? {
                details: [
                  ...missing.map((entry) => `missing: ${entry}`),
                  ...changed.map((entry) => `hash mismatch: ${entry}`),
                  ...unexpected.map((entry) => `user-owned or unexpected: ${entry}`),
                ],
              }
            : {}),
        });

        const block = manifest.ownership.agentsBlock;
        if (
          block &&
          block.path === "AGENTS.md" &&
          typeof block.start === "string" &&
          typeof block.end === "string"
        ) {
          try {
            const agentsText = (
              await readRegularFile(path.join(root, "AGENTS.md"), root)
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
        status: error instanceof LegacyManifestError ? "warn" : "fail",
        summary:
          error instanceof LegacyManifestError
            ? "Legacy Codsemble manifest requires migration"
            : "Codsemble manifest is invalid",
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
    const directoryEntries = await readSafeDirectory(directory, root);
    const pendingNames = directoryEntries
      .filter((entry) => entry.endsWith(".pending.json"))
      .sort();
    const lockPresent = directoryEntries.includes("mutation.lock");
    const receiptNames = directoryEntries
      .filter(
        (entry) =>
          entry.endsWith(".json") &&
          !entry.endsWith(".rollback.json") &&
          !entry.endsWith(".pending.json"),
      )
      .sort();
    const rollbackMarkerNames = directoryEntries
      .filter((entry) => entry.endsWith(".rollback.json"))
      .sort();
    const receipts: TransactionRecord[] = [];
    const invalid: string[] = [
      ...pendingNames.map(
        (name) =>
          `${name}: incomplete mutation requires recovery before further writes`,
      ),
      ...(lockPresent
        ? ["mutation.lock: a mutation is active or was interrupted"]
        : []),
    ];
    for (const name of receiptNames) {
      try {
        const parsed: unknown = JSON.parse(
          (
            await readRegularFile(path.join(directory, name), root)
          ).toString("utf8"),
        );
        assertValidTransactionRecord(parsed);
        if (name !== `${parsed.transactionId}.json`) {
          throw new Error("transaction receipt filename does not match its id");
        }
        receipts.push(parsed);
      } catch (error) {
        invalid.push(
          `${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const receiptsById = new Map(
      receipts.map((receipt) => [receipt.transactionId, receipt]),
    );
    const rolledBackIds = new Set<string>();
    for (const name of rollbackMarkerNames) {
      try {
        const marker: unknown = JSON.parse(
          (
            await readRegularFile(path.join(directory, name), root)
          ).toString("utf8"),
        );
        assertValidRollbackMarker(marker);
        if (name !== `${marker.transactionId}.rollback.json`) {
          throw new Error("rollback marker filename does not match its id");
        }
        const receipt = receiptsById.get(marker.transactionId);
        if (receipt === undefined) {
          throw new Error("rollback marker has no valid transaction receipt");
        }
        assertMarkerMatchesReceipt(marker, receipt);
        rolledBackIds.add(marker.transactionId);
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
          const currentPath = await assertContainedPath(root, file.relativePath);
          if (file.beforeSha256 !== null) {
            if (typeof file.quarantineRelativePath !== "string") {
              drift.push(
                `${file.relativePath}: recovery quarantine metadata is missing`,
              );
            } else {
              const quarantinePath = await assertContainedPath(
                root,
                file.quarantineRelativePath,
              );
              const quarantine = await readRegularFile(quarantinePath, root);
              if (sha256(quarantine) !== file.beforeSha256) {
                drift.push(
                  `${file.relativePath}: recovery quarantine changed after apply`,
                );
              }
            }
          }
          if (file.afterSha256 === null) {
            if (await exists(currentPath)) {
              drift.push(`${file.relativePath}: deleted output was recreated`);
            }
            continue;
          }
          const current = await readRegularFile(currentPath, root);
          if (sha256(current) !== file.afterSha256) {
            drift.push(`${file.relativePath}: content changed after apply`);
          }
        } catch (error) {
          drift.push(
            `${file.relativePath}: ${
              error instanceof Error
                ? error.message
                : "missing or not a regular file"
            }`,
          );
        }
      }
    }
    const details = [...invalid, ...drift];
    return {
      id: "transactions",
      status:
        invalid.length > 0 ? "fail" : drift.length > 0 ? "warn" : receipts.length > 0 ? "pass" : "warn",
      summary:
        pendingNames.length > 0 || lockPresent
          ? "Incomplete Codsemble mutation state was detected"
          : receipts.length > 0
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

function isLegacyManifestWithoutOwnershipHashes(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const ownership = (value as { ownership?: unknown }).ownership;
  if (typeof ownership !== "object" || ownership === null) return false;
  const candidate = ownership as {
    agentFiles?: unknown;
    agentSha256?: unknown;
  };
  return (
    Array.isArray(candidate.agentFiles) &&
    candidate.agentFiles.every(
      (entry) =>
        typeof entry === "string" &&
        /^\.codex\/agents\/[a-z][a-z0-9-]{1,63}\.toml$/.test(entry),
    ) &&
    candidate.agentSha256 === undefined
  );
}

function assertMarkerMatchesReceipt(
  marker: RollbackMarker,
  receipt: TransactionRecord,
): void {
  const expected = receipt.files
    .filter(({ afterSha256 }) => afterSha256 !== null)
    .map(
      ({ relativePath }) =>
        `.codex/codsemble/transactions/${receipt.transactionId}.rollback.quarantines/${relativePath}`,
    )
    .sort();
  const actual = [...marker.quarantineRelativePaths].sort();
  if (
    expected.length !== actual.length ||
    expected.some((entry, index) => entry !== actual[index])
  ) {
    throw new Error(
      "rollback marker quarantine paths do not match its transaction receipt",
    );
  }
}
