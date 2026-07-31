import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { doctorWorkspace } from "../src/doctor.js";
import {
  applyTeamPlan,
  rollbackTransaction,
} from "../src/transaction.js";
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

  it("checks manifest ownership and latest transaction drift", async () => {
    const workspace = await fixture();
    const files = {
      "AGENTS.md":
        "<!-- codsemble:start -->\n## Codsemble team\n<!-- codsemble:end -->\n",
      ".codex/config.toml":
        "[agents]\nmax_concurrent_threads_per_session = 2\n",
      ".codex/agents/reviewer.toml":
        'name = "Reviewer"\ndescription = "Review changes"\ndeveloper_instructions = "Report evidence."\n',
      ".codex/codsemble/manifest.json": `${JSON.stringify({
        schemaVersion: 1,
        planId: "doctor-plan",
        ownership: {
          agentsBlock: {
            path: "AGENTS.md",
            start: "<!-- codsemble:start -->",
            end: "<!-- codsemble:end -->",
          },
          agentFiles: [".codex/agents/reviewer.toml"],
        },
      })}\n`,
    };
    const plan: TeamPlan = {
      schemaVersion: 1,
      planId: "doctor-plan",
      auditFingerprint: "fixture",
      roles: [],
      concurrency: {
        requestedWorkers: 2,
        effectiveCurrentValue: null,
        adapter: "agents-v1",
        configMode: "apply-project",
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
});
