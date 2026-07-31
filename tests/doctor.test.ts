import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { doctorWorkspace } from "../src/doctor.js";
import {
  applyTeamPlan,
  rollbackTransaction,
} from "../src/transaction.js";
import { computeConfirmationId } from "../src/compiler.js";
import type { TeamPlan } from "../src/types.js";
import { sha256 } from "../src/util.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codsemble-doctor-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("doctorWorkspace", () => {
  it("reports an uninitialized workspace without changing it", async () => {
    const workspace = await fixture();
    const report = await doctorWorkspace(workspace);

    expect(report.schemaVersion).toBe(1);
    expect(report.overallStatus).toBe("warn");
    expect(report.checks.map((check) => check.id)).toContain("agent-files");
  });

  it("fails malformed project configuration", async () => {
    const workspace = await fixture();
    await mkdir(path.join(workspace, ".codex"), { recursive: true });
    await writeFile(
      path.join(workspace, ".codex", "config.toml"),
      "[agents\nbad =",
    );

    const report = await doctorWorkspace(workspace);
    expect(
      report.checks.find((check) => check.id === "project-config")?.status,
    ).toBe("fail");
  });

  it("validates required native agent fields", async () => {
    const workspace = await fixture();
    await mkdir(path.join(workspace, ".codex", "agents"), { recursive: true });
    await writeFile(
      path.join(workspace, ".codex", "agents", "reviewer.toml"),
      'name = "reviewer"\ndescription = "Review changes"\n',
    );

    const report = await doctorWorkspace(workspace);
    const check = report.checks.find((entry) => entry.id === "agent-files");
    expect(check?.status).toBe("fail");
    expect(check?.details?.join("\n")).toContain("developer_instructions");
  });

  it("refuses to enumerate symlinked managed directories", async () => {
    const workspace = await fixture();
    const outside = await fixture();
    await mkdir(path.join(workspace, ".codex"), { recursive: true });
    await writeFile(
      path.join(outside, "outside-probe.toml"),
      'name = "outside"\ndescription = "Outside"\ndeveloper_instructions = "No."\nsandbox_mode = "read-only"\n',
    );
    await symlink(outside, path.join(workspace, ".codex", "agents"));

    const report = await doctorWorkspace(workspace);
    const agents = report.checks.find(({ id }) => id === "agent-files");
    expect(agents?.status).toBe("fail");
    expect(agents?.summary).toBe("The agent directory is empty");
    expect(agents?.details?.join(" ")).toContain("real directory");
    expect(agents?.details?.join(" ")).not.toContain("outside-probe.toml");
  });

  it("checks manifest ownership and latest transaction drift", async () => {
    const workspace = await fixture();
    const auditFingerprint = "a".repeat(64);
    const agent =
      'name = "reviewer"\ndescription = "Review changes"\ndeveloper_instructions = "Report evidence."\nsandbox_mode = "read-only"\n';
    const files = {
      "AGENTS.md":
        "<!-- codsemble:start -->\n## Codsemble team\n<!-- codsemble:end -->\n",
      ".codex/config.toml":
        "[agents]\nmax_concurrent_threads_per_session = 2\n",
      ".codex/agents/reviewer.toml": agent,
      ".codex/codsemble/manifest.json": `${JSON.stringify({
        schemaVersion: 1,
        generator: { name: "codsemble", version: "0.1.0" },
        catalogVersion: "0.1.0",
        planId: "doctor-plan",
        auditFingerprint,
        proposal: { kind: "balanced", maxConcurrentWorkers: 2 },
        capabilities: {
          configAdapter: "agents-v1",
          modelCapabilities: [],
          availableTools: ["workspace-read"],
        },
        roles: [{
          id: "reviewer",
          name: "reviewer",
          modelProfile: "inherit",
          sandbox: "read-only",
          source: "catalog",
        }],
        ownership: {
          agentsBlock: {
            path: "AGENTS.md",
            start: "<!-- codsemble:start -->",
            end: "<!-- codsemble:end -->",
          },
          agentFiles: [".codex/agents/reviewer.toml"],
          agentSha256: {
            ".codex/agents/reviewer.toml": sha256(agent),
          },
        },
      })}\n`,
    };
    const unsignedPlan: Omit<TeamPlan, "confirmationId"> = {
      schemaVersion: 1,
      planId: "doctor-plan",
      auditFingerprint,
      roles: [{
        id: "reviewer",
        name: "reviewer",
        description: "Review changes",
        developerInstructions: "Report evidence.",
        modelProfile: "inherit",
        sandbox: "read-only",
        source: "catalog",
      }],
      concurrency: {
        requestedWorkers: 2,
        projectCurrentValue: null,
        adapter: "agents-v1",
        configMode: "apply-project",
        willApply: true,
        manualSnippet:
          "[agents]\nmax_concurrent_threads_per_session = 2\n",
      },
      preimages: Object.entries(files).map(([relativePath]) => ({
        relativePath,
        exists: false,
        sha256: null,
        mode: null,
      })),
      files: Object.entries(files).map(([relativePath, content]) => ({
        relativePath,
        action: "create",
        beforeSha256: null,
        afterSha256: sha256(content),
        content,
      })),
    };
    const plan: TeamPlan = {
      ...unsignedPlan,
      confirmationId: computeConfirmationId(unsignedPlan),
    };
    const transaction = await applyTeamPlan(workspace, plan);

    const healthy = await doctorWorkspace(workspace);
    expect(
      healthy.checks.find((check) => check.id === "manifest-ownership")?.status,
    ).toBe("pass");
    expect(
      healthy.checks.find((check) => check.id === "managed-agents-block")?.status,
    ).toBe("pass");
    expect(
      healthy.checks.find((check) => check.id === "transactions")?.status,
    ).toBe("pass");

    await writeFile(
      path.join(workspace, ".codex", "agents", "reviewer.toml"),
      `${files[".codex/agents/reviewer.toml"]}# user edit\n`,
    );
    const drifted = await doctorWorkspace(workspace);
    expect(
      drifted.checks.find((check) => check.id === "manifest-ownership")?.status,
    ).toBe("fail");
    expect(
      drifted.checks.find((check) => check.id === "transactions")?.status,
    ).toBe("warn");

    await writeFile(
      path.join(workspace, ".codex", "agents", "reviewer.toml"),
      files[".codex/agents/reviewer.toml"],
    );
    await rollbackTransaction(workspace, transaction);
    const rolledBack = await doctorWorkspace(workspace);
    expect(
      rolledBack.checks.find((check) => check.id === "transactions")?.summary,
    ).toContain("all are recorded as rolled back");
  });

  it("rejects transaction receipt paths outside owned outputs", async () => {
    const workspace = await fixture();
    const transactionDirectory = path.join(
      workspace,
      ".codex/codsemble/transactions",
    );
    await mkdir(transactionDirectory, { recursive: true });
    await writeFile(
      path.join(transactionDirectory, "forged.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        transactionId: "forged",
        planId: "forged-plan",
        createdAt: new Date(0).toISOString(),
        files: [
          {
            relativePath: "../../outside",
            beforeSha256: null,
            afterSha256: "a".repeat(64),
            backupRelativePath: null,
            mode: null,
          },
        ],
      })}\n`,
    );

    const report = await doctorWorkspace(workspace);
    const transactions = report.checks.find(
      (check) => check.id === "transactions",
    );
    expect(transactions?.status).toBe("warn");
    expect(transactions?.details?.join(" ")).toContain(
      "not a Codsemble-owned output",
    );
  });

  it("fails closed on an interrupted mutation record and lock", async () => {
    const workspace = await fixture();
    const transactionDirectory = path.join(
      workspace,
      ".codex/codsemble/transactions",
    );
    await mkdir(path.join(transactionDirectory, "mutation.lock"), {
      recursive: true,
    });
    await writeFile(
      path.join(transactionDirectory, "interrupted.apply.pending.json"),
      '{"schemaVersion":1,"operation":"apply"}\n',
    );

    const report = await doctorWorkspace(workspace);
    const transactions = report.checks.find(
      (check) => check.id === "transactions",
    );
    expect(transactions?.status).toBe("fail");
    expect(transactions?.summary).toContain("Incomplete");
    expect(transactions?.details?.join(" ")).toContain("requires recovery");
    expect(transactions?.details?.join(" ")).toContain("mutation.lock");
  });
});
