import { execFile } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { auditWorkspace } from "../src/audit.js";

const execFileAsync = promisify(execFile);
const fixtureRoot = path.resolve("tests/fixtures/audit/typescript-app");
const temporaryDirectories: string[] = [];

async function temporaryWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codsemble-audit-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function copyFixture(): Promise<string> {
  const directory = await temporaryWorkspace();
  await cp(fixtureRoot, directory, { recursive: true });
  return directory;
}

function signalValues(
  report: Awaited<ReturnType<typeof auditWorkspace>>,
  key: string,
): string[] {
  return report.signals.find((signal) => signal.key === key)?.values ?? [];
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("auditWorkspace", () => {
  it("detects typed project and Codex signals deterministically", async () => {
    const workspace = await copyFixture();

    const first = await auditWorkspace(workspace);
    const second = await auditWorkspace(workspace);

    expect(second).toEqual(first);
    expect(first.workspace).toBe(".");
    expect(first.gitRepository).toBe(false);
    expect(first.dirtyWorktree).toBeNull();
    expect(first.inspectedFileDigests).toHaveLength(first.inspectedFiles.length);
    expect(first.inspectedFileDigests?.every(({ sha256 }) =>
      /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
    expect(signalValues(first, "stack")).toEqual(
      expect.arrayContaining(["nodejs", "typescript"]),
    );
    expect(signalValues(first, "framework")).toEqual(
      expect.arrayContaining(["nextjs", "react"]),
    );
    expect(signalValues(first, "testing")).toEqual(
      expect.arrayContaining(["tests-present", "vitest"]),
    );
    expect(signalValues(first, "ci")).toContain("github-actions");
    expect(signalValues(first, "documentation")).toContain(
      "documentation-present",
    );
    expect(signalValues(first, "deployment")).toContain("docker");
    expect(first.existingCodex).toEqual({
      agentsMd: true,
      projectConfig: true,
      agentFiles: [".codex/agents/reviewer.toml"],
      teamManifest: true,
    });
    expect(signalValues(first, "codex")).toEqual([
      "agents-instructions",
      "codsemble-managed-team",
      "project-config",
      "specialist-agents",
    ]);
  });

  it("does not inspect ignored, secret-like, generated, binary, oversized, or symlinked files", async () => {
    const workspace = await copyFixture();
    await writeFile(path.join(workspace, ".env"), "SYNTHETIC_SECRET=fixture");
    await writeFile(path.join(workspace, "ignored.ts"), "export {};");
    await mkdir(path.join(workspace, "node_modules", "fake"), {
      recursive: true,
    });
    await writeFile(
      path.join(workspace, "node_modules", "fake", "package.json"),
      '{"dependencies":{"vue":"latest"}}',
    );
    await writeFile(path.join(workspace, "private-key.pem"), "secret");
    await writeFile(path.join(workspace, "binary.ts"), Buffer.from([0, 1, 2]));
    await writeFile(path.join(workspace, "oversized.ts"), "x".repeat(9_000));
    await symlink(
      path.join(workspace, "package.json"),
      path.join(workspace, "linked-package.json"),
    );

    const report = await auditWorkspace(workspace, { maxFileBytes: 8_192 });
    const skipped = Object.fromEntries(
      report.skipped.map(({ reason, count }) => [reason, count]),
    );

    expect(report.inspectedFiles).not.toEqual(
      expect.arrayContaining([
        ".env",
        "ignored.ts",
        "private-key.pem",
        "binary.ts",
        "oversized.ts",
        "linked-package.json",
        "node_modules/fake/package.json",
      ]),
    );
    expect(skipped).toMatchObject({
      binary: 1,
      generated: 1,
      ignored: 1,
      oversized: 1,
      "secret-like": 2,
      symlink: 1,
    });
  });

  it("excludes ordinary untracked files while reporting Git dirtiness", async () => {
    const workspace = await temporaryWorkspace();
    await execFileAsync("git", ["init", "-q"], { cwd: workspace });
    await writeFile(path.join(workspace, ".gitignore"), "ignored.ts\n");
    await writeFile(
      path.join(workspace, "package.json"),
      '{"devDependencies":{"jest":"1.0.0"}}',
    );
    await writeFile(path.join(workspace, "ignored.ts"), "export {};");
    await execFileAsync("git", ["add", ".gitignore", "package.json"], {
      cwd: workspace,
    });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Codesemble Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: workspace },
    );
    await writeFile(path.join(workspace, "src.ts"), "export {};");
    await mkdir(
      path.join(workspace, ".codex/codsemble/transactions"),
      { recursive: true },
    );
    await writeFile(
      path.join(
        workspace,
        ".codex/codsemble/transactions/generated-receipt.json",
      ),
      "{}",
    );

    const report = await auditWorkspace(workspace);

    expect(report.gitRepository).toBe(true);
    expect(report.dirtyWorktree).toBe(true);
    expect(report.inspectedFiles).toEqual([".gitignore", "package.json"]);
    expect(report.inspectedFiles).not.toContain("ignored.ts");
    expect(report.skipped).toContainEqual({ reason: "untracked", count: 1 });
    expect(signalValues(report, "testing")).toContain("jest");
  });

  it("excludes transaction history from Git candidates and dirtiness", async () => {
    const workspace = await temporaryWorkspace();
    await execFileAsync("git", ["init", "-q"], { cwd: workspace });
    const transactionDirectory = path.join(
      workspace,
      ".codex/codsemble/transactions",
    );
    await mkdir(transactionDirectory, { recursive: true });
    await writeFile(path.join(workspace, "package.json"), '{"name":"fixture"}');
    await writeFile(
      path.join(transactionDirectory, "tracked.json"),
      '{"state":"initial"}',
    );
    await execFileAsync("git", ["add", "."], { cwd: workspace });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Codesemble Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: workspace },
    );

    const clean = await auditWorkspace(workspace);
    expect(clean.dirtyWorktree).toBe(false);
    expect(clean.inspectedFiles).toEqual(["package.json"]);

    await writeFile(
      path.join(transactionDirectory, "tracked.json"),
      '{"state":"changed"}',
    );
    await writeFile(
      path.join(transactionDirectory, "untracked.json"),
      '{"state":"new"}',
    );
    const transactionOnly = await auditWorkspace(workspace);
    expect(transactionOnly.dirtyWorktree).toBe(false);
    expect(transactionOnly.inspectedFiles).toEqual(["package.json"]);
    expect(transactionOnly.skipped).toEqual([]);

    await writeFile(path.join(workspace, "package.json"), '{"name":"changed"}');
    expect((await auditWorkspace(workspace)).dirtyWorktree).toBe(true);
  });

  it("ignores a transaction-only fully untracked .codex tree", async () => {
    const workspace = await temporaryWorkspace();
    await execFileAsync("git", ["init", "-q"], { cwd: workspace });
    await writeFile(path.join(workspace, "package.json"), '{"name":"fixture"}');
    await execFileAsync("git", ["add", "package.json"], { cwd: workspace });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Codesemble Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: workspace },
    );
    const transactionDirectory = path.join(
      workspace,
      ".codex/codsemble/transactions",
    );
    await mkdir(transactionDirectory, { recursive: true });
    await writeFile(
      path.join(transactionDirectory, "untracked.json"),
      '{"state":"new"}',
    );

    const report = await auditWorkspace(workspace);
    expect(report.dirtyWorktree).toBe(false);
    expect(report.inspectedFiles).toEqual(["package.json"]);
    expect(report.skipped).toEqual([]);
  });

  it("enforces file and depth bounds", async () => {
    const workspace = await temporaryWorkspace();
    await writeFile(path.join(workspace, "a.ts"), "export {};");
    await writeFile(path.join(workspace, "b.ts"), "export {};");
    await mkdir(path.join(workspace, "one", "two"), { recursive: true });
    await writeFile(path.join(workspace, "one", "two", "deep.ts"), "export {};");

    const report = await auditWorkspace(workspace, {
      maxFiles: 1,
      maxDepth: 1,
    });

    expect(report.inspectedFiles).toHaveLength(1);
    expect(report.truncated).toBe(true);
    expect(report.skipped).toEqual(
      expect.arrayContaining([
        { reason: "depth-limit", count: 1 },
        { reason: "file-limit", count: 1 },
      ]),
    );
  });

  it("rejects a symlink workspace root and never follows file symlinks", async () => {
    const workspace = await temporaryWorkspace();
    const target = path.join(workspace, "target");
    const linkedRoot = path.join(workspace, "linked-root");
    await mkdir(target);
    await writeFile(path.join(target, "package.json"), "{}");
    await symlink(target, linkedRoot);

    await expect(auditWorkspace(linkedRoot)).rejects.toThrow(
      "Workspace must be a real directory, not a symlink",
    );
  });

  it("performs no writes", async () => {
    const workspace = await copyFixture();
    const before = await treeMetadata(workspace);

    await auditWorkspace(workspace);

    expect(await treeMetadata(workspace)).toEqual(before);
  });
});

async function treeMetadata(
  root: string,
  relativeDirectory = "",
): Promise<Array<{ path: string; size: number; mtimeMs: number; mode: number }>> {
  const entries = await readdir(path.join(root, relativeDirectory), {
    withFileTypes: true,
  });
  const result: Array<{
    path: string;
    size: number;
    mtimeMs: number;
    mode: number;
  }> = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const stats = await lstat(path.join(root, relativePath));
    result.push({
      path: relativePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mode: stats.mode,
    });
    if (entry.isDirectory()) {
      result.push(...(await treeMetadata(root, relativePath)));
    }
  }
  return result;
}
