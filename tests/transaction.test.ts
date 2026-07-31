import {
  link,
  mkdir,
  mkdtemp,
  readFile,
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
  it("atomically applies and rolls back updated and created files", async () => {
    const workspace = await makeWorkspace();
    const configPath = path.join(workspace, ".codex/config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    const before = "[agents]\nmax_concurrent_threads_per_session = 2\n";
    const after = "[agents]\nmax_concurrent_threads_per_session = 4\n";
    await writeFile(configPath, before, { mode: 0o640 });

    const plan = makePlan([
      planned(".codex/config.toml", "update", before, after),
      planned(".codex/agents/reviewer.toml", "create", null, 'name = "Reviewer"\n'),
    ]);
    const transaction = await applyTeamPlan(workspace, plan);

    expect(await readFile(configPath, "utf8")).toBe(after);
    expect(
      await readFile(path.join(workspace, ".codex/agents/reviewer.toml"), "utf8"),
    ).toBe('name = "Reviewer"\n');
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
      makePlan([planned(".codex/agents/owned.toml", "update", "old", "generated")]),
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
});

async function makeWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codsemble-test-"));
  temporaryWorkspaces.push(directory);
  return directory;
}

function planned(
  relativePath: string,
  action: "create" | "update",
  before: string | null,
  content: string,
) {
  return {
    relativePath,
    action,
    beforeSha256: before === null ? null : sha256(before),
    afterSha256: sha256(content),
    content,
  };
}

function makePlan(files: ReturnType<typeof planned>[]): TeamPlan {
  return {
    schemaVersion: 1,
    planId: "test-plan",
    auditFingerprint: "test",
    roles: [],
    concurrency: {
      requestedWorkers: 2,
      effectiveCurrentValue: null,
      adapter: "agents-v1",
      configMode: "apply-project",
    },
    preimages: [],
    files,
  };
}
