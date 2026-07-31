import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cli = path.resolve("plugins/codsemble/scripts/codsemble.mjs");
const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const result = await mkdtemp(path.join(os.tmpdir(), "codsemble-cli-"));
  temporaryDirectories.push(result);
  await writeFile(
    path.join(result, "package.json"),
    '{"name":"fixture","devDependencies":{"typescript":"1.0.0"}}\n',
  );
  return result;
}

async function answers(
  root: string,
  configMode: "preview" | "manual" | "apply-project",
): Promise<string> {
  const target = path.join(root, "answers.json");
  await writeFile(
    target,
    `${JSON.stringify({
      goals: ["engineering", "testing"],
      projectStage: "active",
      desiredRoleCount: 2,
      maxConcurrentWorkers: 2,
      optimizeFor: "balanced",
      configMode,
      configAdapter: "agents-v1",
      prohibitedActions: ["Do not publish."],
      requiredRoles: [],
      excludedRoles: [],
      customRoles: [],
      availableTools: ["workspace-read"],
      availableModelIds: [],
      verifiedModels: {},
      allowHighConcurrency: false,
    })}\n`,
  );
  return target;
}

async function run(args: string[]): Promise<string> {
  return (
    await execFileAsync(process.execPath, [cli, ...args], {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("bundled CLI", () => {
  it("loads the complete offline catalog", async () => {
    const output = JSON.parse(await run(["catalog", "--search", "frontend"])) as {
      total: number;
      matched: number;
    };
    expect(output.total).toBe(111);
    expect(output.matched).toBeGreaterThan(0);
  });

  it("refuses to apply a preview plan", async () => {
    const root = await workspace();
    const answerFile = await answers(root, "preview");
    const planFile = path.join(root, "plan.json");
    const plan = await run([
      "plan",
      "--workspace",
      root,
      "--answers",
      answerFile,
      "--proposal",
      "balanced",
    ]);
    await writeFile(planFile, plan);
    const parsed = JSON.parse(plan) as {
      planId: string;
      confirmationId: string;
    };

    await expect(
      run([
        "apply",
        "--workspace",
        root,
        "--plan",
        planFile,
        "--confirm",
        parsed.confirmationId,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("preview plans are read-only"),
    });
    await expect(access(path.join(root, ".codex"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("applies team artifacts in manual config mode without writing config.toml", async () => {
    const root = await workspace();
    const answerFile = await answers(root, "manual");
    const planFile = path.join(root, "plan.json");
    const plan = await run([
      "plan",
      "--workspace",
      root,
      "--answers",
      answerFile,
      "--proposal",
      "balanced",
    ]);
    await writeFile(planFile, plan);
    const parsed = JSON.parse(plan) as {
      planId: string;
      confirmationId: string;
    };
    const applied = JSON.parse(
      await run([
        "apply",
        "--workspace",
        root,
        "--plan",
        planFile,
        "--confirm",
        parsed.confirmationId,
      ]),
    ) as { transaction: { planId: string; transactionId: string } };

    expect(applied.transaction.planId).toBe(parsed.planId);
    expect(
      (await readdir(path.join(root, ".codex", "agents"))).length,
    ).toBeGreaterThan(0);
    await expect(
      access(path.join(root, ".codex", "config.toml")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await run([
      "rollback",
      "--workspace",
      root,
      "--transaction",
      applied.transaction.transactionId,
      "--confirm",
      applied.transaction.transactionId,
    ]);
    await expect(access(path.join(root, "AGENTS.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("applies and rolls back the confirmed project concurrency ceiling", async () => {
    const root = await workspace();
    const answerFile = await answers(root, "apply-project");
    const planFile = path.join(root, "plan.json");
    const plan = await run([
      "plan",
      "--workspace",
      root,
      "--answers",
      answerFile,
      "--proposal",
      "balanced",
    ]);
    await writeFile(planFile, plan);
    const parsed = JSON.parse(plan) as {
      planId: string;
      confirmationId: string;
    };

    await expect(
      run([
        "apply",
        "--workspace",
        root,
        "--plan",
        planFile,
        "--confirm",
        "wrong-plan-id",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("must exactly match plan.confirmationId"),
    });

    const applied = JSON.parse(
      await run([
        "apply",
        "--workspace",
        root,
        "--plan",
        planFile,
        "--confirm",
        parsed.confirmationId,
      ]),
    ) as { transaction: { transactionId: string } };
    const config = await import("node:fs/promises").then(({ readFile }) =>
      readFile(path.join(root, ".codex", "config.toml"), "utf8"),
    );
    expect(config).toContain("max_concurrent_threads_per_session = 2");

    await run([
      "rollback",
      "--workspace",
      root,
      "--transaction",
      applied.transaction.transactionId,
      "--confirm",
      applied.transaction.transactionId,
    ]);
    await expect(
      access(path.join(root, ".codex", "config.toml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
