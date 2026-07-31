import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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
  const fakeBin = path.join(result, "fake-bin");
  await mkdir(fakeBin);
  if (process.platform === "win32") {
    await writeFile(
      path.join(fakeBin, "codex.cmd"),
      [
        "@echo off",
        'if "%~1"=="--version" goto version',
        'if "%~1 %~2"=="features list" goto features',
        'if "%~1 %~2"=="debug models" goto models',
        "exit /b 1",
        ":version",
        "echo codex-cli 0.145.0",
        "exit /b 0",
        ":features",
        "echo multi_agent stable true",
        "exit /b 0",
        ":models",
        "echo {\"models\":[]}",
        "exit /b 0",
        "",
      ].join("\r\n"),
    );
  } else {
    const executable = path.join(fakeBin, "codex");
    await writeFile(
      executable,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "codex-cli 0.145.0"; exit 0; fi',
        'if [ "$1 $2" = "features list" ]; then echo "multi_agent stable true"; exit 0; fi',
        'if [ "$1 $2" = "debug models" ]; then echo \'{"models":[]}\'; exit 0; fi',
        "exit 1",
        "",
      ].join("\n"),
    );
    await chmod(executable, 0o755);
  }
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
      modelCapabilities: [],
      verifiedModels: {},
      allowHighConcurrency: false,
    })}\n`,
  );
  return target;
}

async function run(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const workspaceIndex = args.indexOf("--workspace");
  const workspaceRoot =
    workspaceIndex >= 0 ? args[workspaceIndex + 1] : undefined;
  const selectedEnvironment =
    environment === process.env && workspaceRoot !== undefined
      ? {
          ...process.env,
          PATH: `${path.join(workspaceRoot, "fake-bin")}${path.delimiter}${
            process.env.PATH ?? ""
          }`,
        }
      : environment;
  return (
    await execFileAsync(process.execPath, [cli, ...args], {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
      env: selectedEnvironment,
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

  it("fails closed when planning cannot run the local Codex probe", async () => {
    const root = await workspace();
    const answerFile = await answers(root, "preview");
    await expect(
      run(
        [
          "plan",
          "--workspace",
          root,
          "--answers",
          answerFile,
          "--proposal",
          "lean",
        ],
        { ...process.env, PATH: "/nonexistent" },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Plan capability check failed: the local Codex runtime is unavailable",
      ),
    });
    await expect(access(path.join(root, ".codex"))).rejects.toMatchObject({
      code: "ENOENT",
    });
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

  it("re-probes and refuses apply when Codex disappears after planning", async () => {
    const root = await workspace();
    const answerFile = await answers(root, "manual");
    const planFile = path.join(root, "plan.json");
    const planText = await run([
      "plan",
      "--workspace",
      root,
      "--answers",
      answerFile,
      "--proposal",
      "balanced",
    ]);
    await writeFile(planFile, planText);
    const plan = JSON.parse(planText) as { confirmationId: string };

    await expect(
      run(
        [
          "apply",
          "--workspace",
          root,
          "--plan",
          planFile,
          "--confirm",
          plan.confirmationId,
        ],
        { ...process.env, PATH: "/nonexistent" },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Apply capability check failed: the local Codex runtime is unavailable",
      ),
    });
    await expect(access(path.join(root, ".codex"))).rejects.toMatchObject({
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
