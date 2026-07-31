import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { TeamPlan } from "../src/types.js";
import {
  applyTeamPlan,
  rollbackTransaction,
} from "../src/transaction.js";
import { computeConfirmationId } from "../src/compiler.js";
import { sha256 } from "../src/util.js";

const temporaryWorkspaces: string[] = [];
const temporaryFiles: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryWorkspaces.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  await Promise.all(
    temporaryFiles.splice(0).map((file) => rm(file, { force: true })),
  );
});

describe("project transactions", () => {
  it("applies and rolls back updated and created files without clobbering", async () => {
    const workspace = await makeWorkspace();
    const configPath = path.join(workspace, ".codex/config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    const before = "[agents]\nmax_concurrent_threads_per_session = 2\n";
    const after = "[agents]\nmax_concurrent_threads_per_session = 4\n";
    await writeFile(configPath, before, { mode: 0o640 });

    const plan = makePlan([
      planned(".codex/config.toml", "update", before, after),
      planned(".codex/agents/reviewer.toml", "create", null, agentToml("reviewer")),
    ]);
    plan.concurrency.requestedWorkers = 4;
    plan.concurrency.manualSnippet =
      "[agents]\nmax_concurrent_threads_per_session = 4\n";
    plan.confirmationId = computeConfirmationId(plan);
    const transaction = await applyTeamPlan(workspace, plan);

    expect(await readFile(configPath, "utf8")).toBe(after);
    expect(
      await readFile(path.join(workspace, ".codex/agents/reviewer.toml"), "utf8"),
    ).toBe(agentToml("reviewer"));
    expect(
      await readFile(
        path.join(
          workspace,
          `.codex/codsemble/transactions/${transaction.transactionId}.json`,
        ),
        "utf8",
      ),
    ).toContain(transaction.transactionId);

    await rollbackTransaction(workspace, transaction.transactionId);
    expect(await readFile(configPath, "utf8")).toBe(before);
    expect(
      await readFile(
        path.join(
          workspace,
          `.codex/codsemble/transactions/${transaction.transactionId}.rollback.json`,
        ),
        "utf8",
      ),
    ).toContain('"rolledBackAt"');
    await expect(
      readFile(path.join(workspace, ".codex/agents/reviewer.toml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses changed preimages before writing any file", async () => {
    const workspace = await makeWorkspace();
    await mkdir(path.join(workspace, ".codex/agents"), { recursive: true });
    await writeFile(path.join(workspace, ".codex/agents/owned.toml"), "changed");
    const plan = makePlan([
      planned(".codex/agents/owned.toml", "update", "expected", "new"),
      planned(".codex/agents/untouched.toml", "create", null, "must not appear"),
    ]);

    await expect(applyTeamPlan(workspace, plan)).rejects.toThrow(
      "Preimage conflict",
    );
    await expect(readFile(path.join(workspace, ".codex/agents/untouched.toml"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses rollback after a user edit", async () => {
    const workspace = await makeWorkspace();
    await mkdir(path.join(workspace, ".codex/agents"), { recursive: true });
    const owned = path.join(workspace, ".codex/agents/owned.toml");
    await writeFile(owned, "old");
    const transaction = await applyTeamPlan(
      workspace,
      makePlan([
        planned(
          ".codex/agents/owned.toml",
          "update",
          "old",
          agentToml("owned"),
        ),
      ]),
    );
    await writeFile(owned, "user edit");

    await expect(
      rollbackTransaction(workspace, transaction),
    ).rejects.toThrow("Rollback conflict");
    expect(await readFile(owned, "utf8")).toBe(
      "user edit",
    );
  });

  it("rejects symlink and hard-link targets", async () => {
    const workspace = await makeWorkspace();
    const agents = path.join(workspace, ".codex/agents");
    await mkdir(agents, { recursive: true });
    const outside = path.join(os.tmpdir(), `codsemble-outside-${Date.now()}`);
    temporaryFiles.push(outside);
    await writeFile(outside, "outside");
    await symlink(outside, path.join(agents, "linked.toml"));
    await expect(
      applyTeamPlan(
        workspace,
        makePlan([planned(".codex/agents/linked.toml", "update", "outside", "new")]),
      ),
    ).rejects.toThrow("single-link file");

    await writeFile(path.join(agents, "source.toml"), "source");
    await link(path.join(agents, "source.toml"), path.join(agents, "hard.toml"));
    await expect(
      applyTeamPlan(
        workspace,
        makePlan([planned(".codex/agents/hard.toml", "update", "source", "new")]),
      ),
    ).rejects.toThrow("single-link file");
  });

  it("validates project TOML before applying", async () => {
    const workspace = await makeWorkspace();
    const configPath = path.join(workspace, ".codex/config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, "[agents]\n");
    await expect(
      applyTeamPlan(
        workspace,
        makePlan([
          planned(".codex/config.toml", "update", "[agents]\n", "[agents"),
        ]),
      ),
    ).rejects.toThrow("Invalid TOML");
    expect(await readFile(configPath, "utf8")).toBe("[agents]\n");
  });

  it("rejects dangerous config keys outside the exact concurrency patch", async () => {
    const workspace = await makeWorkspace();
    const configPath = path.join(workspace, ".codex/config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    const before = "[agents]\nmax_concurrent_threads_per_session = 1\n";
    const dangerous = `${before}approval_policy = "never"\nsandbox_mode = "danger-full-access"\n`;
    await writeFile(configPath, before);

    await expect(
      applyTeamPlan(
        workspace,
        makePlan([
          planned(".codex/config.toml", "update", before, dangerous),
        ]),
      ),
    ).rejects.toThrow("exact supported concurrency patch");
    expect(await readFile(configPath, "utf8")).toBe(before);
  });

  it("rejects symlinked parent directories without following them", async () => {
    const workspace = await makeWorkspace();
    const outside = await mkdtemp(path.join(os.tmpdir(), "codsemble-parent-"));
    temporaryWorkspaces.push(outside);
    await symlink(outside, path.join(workspace, ".codex"));

    await expect(
      applyTeamPlan(
        workspace,
        makePlan([
          planned(".codex/config.toml", "create", null, "[agents]\n"),
        ]),
      ),
    ).rejects.toThrow("Unsafe transaction ancestor");
    await expect(readFile(path.join(outside, "config.toml"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects plans outside Codsemble-owned outputs", async () => {
    const workspace = await makeWorkspace();
    await expect(
      applyTeamPlan(
        workspace,
        makePlan([planned("src/injected.ts", "create", null, "bad")]),
      ),
    ).rejects.toThrow("non-Codsemble output path");
  });

  it("rejects a plan changed after its confirmation id was generated", async () => {
    const workspace = await makeWorkspace();
    const plan = makePlan([
      planned(".codex/agents/reviewer.toml", "create", null, "reviewed"),
    ]);
    plan.files[0] = planned(
      ".codex/agents/reviewer.toml",
      "create",
      null,
      "tampered",
    );

    await expect(applyTeamPlan(workspace, plan)).rejects.toThrow(
      "confirmation digest mismatch",
    );
  });

  it("rejects table-valued model fields in generated agent TOML", async () => {
    const workspace = await makeWorkspace();
    const invalid = [
      'name = "reviewer"',
      'description = "Bounded test agent"',
      'developer_instructions = "Report evidence."',
      'sandbox_mode = "read-only"',
      "[model]",
      'command = "not-a-model-id"',
      "",
    ].join("\n");
    const plan = makePlan([
      planned(".codex/agents/reviewer.toml", "create", null, invalid),
    ]);

    await expect(applyTeamPlan(workspace, plan)).rejects.toThrow(
      "Generated agent has an invalid schema",
    );
    await expect(
      readFile(path.join(workspace, ".codex/agents/reviewer.toml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves racing bytes and leaves a fail-closed recovery record", async () => {
    const workspace = await makeWorkspace();
    const target = path.join(workspace, ".codex/agents/reviewer.toml");
    await mkdir(path.dirname(target), { recursive: true });
    const before = agentToml("reviewer");
    const after = agentToml("reviewer").replace(
      "Report evidence.",
      "Report verified evidence.",
    );
    await writeFile(target, before);
    const plan = makePlan([
      planned(".codex/agents/reviewer.toml", "update", before, after),
    ]);
    const role = plan.roles[0];
    if (role === undefined) throw new Error("missing test role");
    role.developerInstructions = "Report verified evidence.";
    plan.confirmationId = computeConfirmationId(plan);

    await expect(
      applyTeamPlan(workspace, plan, {
        beforeExclusivePublish: async () => {
          await writeFile(target, "racing user bytes");
        },
      }),
    ).rejects.toThrow("preserved for manual recovery");

    expect(await readFile(target, "utf8")).toBe("racing user bytes");
    const transactionDirectory = path.join(
      workspace,
      ".codex/codsemble/transactions",
    );
    const transactionEntries = await readdir(transactionDirectory);
    expect(transactionEntries).toContain("mutation.lock");
    const pendingName = transactionEntries.find((entry) =>
      entry.endsWith(".apply.pending.json"),
    );
    expect(pendingName).toBeDefined();
    const pending = JSON.parse(
      await readFile(
        path.join(transactionDirectory, pendingName as string),
        "utf8",
      ),
    ) as { files: Array<{ quarantinePath: string }> };
    expect(
      await readFile(
        path.join(workspace, pending.files[0]?.quarantinePath as string),
        "utf8",
      ),
    ).toBe(before);
  });

  it("retains late writes made through an already-open source inode", async () => {
    const workspace = await makeWorkspace();
    const target = path.join(workspace, ".codex/agents/reviewer.toml");
    await mkdir(path.dirname(target), { recursive: true });
    const before = agentToml("reviewer");
    const after = before.replace(
      "Report evidence.",
      "Report verified evidence.",
    );
    await writeFile(target, before);
    const handle = await import("node:fs/promises").then(({ open }) =>
      open(target, "r+"),
    );
    const plan = makePlan([
      planned(".codex/agents/reviewer.toml", "update", before, after),
    ]);
    const role = plan.roles[0];
    if (role === undefined) throw new Error("missing test role");
    role.developerInstructions = "Report verified evidence.";
    plan.confirmationId = computeConfirmationId(plan);

    const transaction = await applyTeamPlan(workspace, plan, {
      beforeExclusivePublish: async () => {
        await handle.truncate(0);
        await handle.writeFile("late editor bytes");
        await handle.sync();
      },
    });
    await handle.close();

    expect(await readFile(target, "utf8")).toBe(after);
    const recoveryPath = transaction.files[0]?.quarantineRelativePath;
    expect(recoveryPath).toBeTruthy();
    expect(
      await readFile(path.join(workspace, recoveryPath as string), "utf8"),
    ).toBe("late editor bytes");
  });

  it("refuses new writes when a pending record remains without its lock", async () => {
    const workspace = await makeWorkspace();
    const transactions = path.join(
      workspace,
      ".codex/codsemble/transactions",
    );
    await mkdir(transactions, { recursive: true });
    await writeFile(
      path.join(transactions, "stale.apply.pending.json"),
      '{"schemaVersion":1}\n',
    );

    await expect(
      applyTeamPlan(
        workspace,
        makePlan([
          planned(
            ".codex/agents/reviewer.toml",
            "create",
            null,
            agentToml("reviewer"),
          ),
        ]),
      ),
    ).rejects.toThrow("Incomplete Codsemble mutation record");
    await expect(
      readFile(path.join(workspace, ".codex/agents/reviewer.toml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("binds unchanged manifest ownership hashes and role metadata", async () => {
    const workspace = await makeWorkspace();
    const agentPath = path.join(workspace, ".codex/agents/reviewer.toml");
    const agent = agentToml("reviewer");
    await mkdir(path.dirname(agentPath), { recursive: true });
    await writeFile(agentPath, agent);
    const role = {
      id: "reviewer",
      name: "reviewer",
      description: "Bounded test agent",
      developerInstructions: "Report evidence.",
      modelProfile: "inherit" as const,
      sandbox: "read-only" as const,
      source: "catalog" as const,
    };
    const manifest = `${JSON.stringify({
      schemaVersion: 1,
      generator: { name: "codsemble", version: "0.1.0" },
      catalogVersion: "0.1.0",
      planId: "test-plan",
      auditFingerprint: "a".repeat(64),
      proposal: { kind: "balanced", maxConcurrentWorkers: 2 },
      capabilities: {
        configAdapter: "agents-v1",
        modelCapabilities: [],
        availableTools: ["workspace-read"],
      },
      roles: [{
        id: role.id,
        name: role.name,
        modelProfile: role.modelProfile,
        sandbox: "workspace-write",
        source: role.source,
      }],
      ownership: {
        agentsBlock: {
          path: "AGENTS.md",
          start: "<!-- codsemble:start -->",
          end: "<!-- codsemble:end -->",
        },
        agentFiles: [".codex/agents/reviewer.toml"],
        agentSha256: {
          ".codex/agents/reviewer.toml": "0".repeat(64),
        },
      },
    })}\n`;
    const file = planned(
      ".codex/codsemble/manifest.json",
      "create",
      null,
      manifest,
    );
    const unsigned: Omit<TeamPlan, "confirmationId"> = {
      schemaVersion: 1,
      planId: "test-plan",
      auditFingerprint: "a".repeat(64),
      roles: [role],
      concurrency: {
        requestedWorkers: 2,
        projectCurrentValue: null,
        adapter: "agents-v1",
        configMode: "manual",
        willApply: false,
        manualSnippet:
          "[agents]\nmax_concurrent_threads_per_session = 2\n",
      },
      preimages: [{
        relativePath: file.relativePath,
        exists: false,
        sha256: null,
        mode: null,
      }],
      files: [file],
    };
    const plan: TeamPlan = {
      ...unsigned,
      confirmationId: computeConfirmationId(unsigned),
    };

    await expect(applyTeamPlan(workspace, plan)).rejects.toThrow(
      "manifest is not bound to the plan",
    );
  });

  it("applies and rolls back deletion of a previously owned output", async () => {
    const workspace = await makeWorkspace();
    const target = path.join(workspace, ".codex/agents/stale.toml");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "stale");
    const transaction = await applyTeamPlan(
      workspace,
      makePlan([
        planned(".codex/agents/stale.toml", "delete", "stale", null),
      ]),
    );

    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    await rollbackTransaction(workspace, transaction.transactionId);
    expect(await readFile(target, "utf8")).toBe("stale");
  });
});

async function makeWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codsemble-test-"));
  temporaryWorkspaces.push(directory);
  return directory;
}

function planned(
  relativePath: string,
  action: "create" | "update" | "delete",
  before: string | null,
  content: string | null,
) {
  return {
    relativePath,
    action,
    beforeSha256: before === null ? null : sha256(before),
    afterSha256: content === null ? null : sha256(content),
    content,
  };
}

function agentToml(name: string): string {
  return [
    `name = "${name}"`,
    'description = "Bounded test agent"',
    'developer_instructions = "Report evidence."',
    'sandbox_mode = "read-only"',
    "",
  ].join("\n");
}

function makePlan(files: ReturnType<typeof planned>[]): TeamPlan {
  const roles = files
    .filter(
      ({ relativePath, content }) =>
        /^\.codex\/agents\/.+\.toml$/.test(relativePath) &&
        content?.includes("Bounded test agent"),
    )
    .map(({ relativePath }) => {
      const id = path.posix.basename(relativePath, ".toml");
      return {
        id,
        name: id,
        description: "Bounded test agent",
        developerInstructions: "Report evidence.",
        modelProfile: "inherit" as const,
        sandbox: "read-only" as const,
        source: "catalog" as const,
      };
    });
  const unsigned: Omit<TeamPlan, "confirmationId"> = {
    schemaVersion: 1,
    planId: "test-plan",
    auditFingerprint: "test",
    roles,
    concurrency: {
      requestedWorkers: 2,
      projectCurrentValue: null,
      adapter: "agents-v1",
      configMode: "apply-project",
      willApply: true,
      manualSnippet:
        "[agents]\nmax_concurrent_threads_per_session = 2\n",
    },
    preimages: files.map((file) => ({
      relativePath: file.relativePath,
      exists: file.beforeSha256 !== null,
      sha256: file.beforeSha256,
      mode: null,
    })),
    files,
  };
  return { ...unsigned, confirmationId: computeConfirmationId(unsigned) };
}
