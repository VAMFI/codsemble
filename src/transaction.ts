import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { validateToml } from "./config.js";
import type {
  PlannedFile,
  TeamPlan,
  TransactionRecord,
} from "./types.js";
import { assertContainedPath, sha256, stableStringify } from "./util.js";

const transactionRoot = ".codex/codsemble/transactions";
const projectConfig = ".codex/config.toml";

interface PreflightFile {
  planned: PlannedFile;
  absolutePath: string;
  before: Buffer | null;
  mode: number | null;
  backupRelativePath: string | null;
}

export async function applyTeamPlan(
  workspace: string,
  plan: TeamPlan,
): Promise<TransactionRecord> {
  validatePlan(plan);
  const root = await resolveSafeWorkspace(workspace);
  const transactionId = randomUUID();
  const prepared: PreflightFile[] = [];

  for (const planned of plan.files) {
    const absolutePath = await safeTarget(root, planned.relativePath);
    const state = await readSafeRegularFile(absolutePath);
    const beforeHash = state.content === null ? null : sha256(state.content);
    if (beforeHash !== planned.beforeSha256) {
      throw new Error(
        `Preimage conflict for ${planned.relativePath}: expected ${formatHash(planned.beforeSha256)}, found ${formatHash(beforeHash)}`,
      );
    }
    if (sha256(planned.content) !== planned.afterSha256) {
      throw new Error(`After-image hash mismatch for ${planned.relativePath}`);
    }
    if (planned.action === "create" && state.content !== null) {
      throw new Error(`Create target already exists: ${planned.relativePath}`);
    }
    if (planned.action === "update" && state.content === null) {
      throw new Error(`Update target does not exist: ${planned.relativePath}`);
    }
    if (planned.relativePath === projectConfig) {
      if (state.content !== null) {
        validateToml(decodeUtf8(state.content, planned.relativePath));
      }
      validateToml(planned.content);
    }
    prepared.push({
      planned,
      absolutePath,
      before: state.content,
      mode: state.mode,
      backupRelativePath:
        state.content === null
          ? null
          : `${transactionRoot}/${transactionId}.backups/${planned.relativePath}`,
    });
  }

  const transaction: TransactionRecord = {
    schemaVersion: 1,
    transactionId,
    planId: plan.planId,
    createdAt: new Date().toISOString(),
    files: prepared.map((file) => ({
      relativePath: file.planned.relativePath,
      beforeSha256:
        file.before === null ? null : sha256(file.before),
      afterSha256: file.planned.afterSha256,
      backupRelativePath: file.backupRelativePath,
      mode: file.mode,
    })),
  };

  const staged = new Map<string, string>();
  const installed: PreflightFile[] = [];
  try {
    for (const file of prepared) {
      if (file.before !== null && file.backupRelativePath !== null) {
        const backup = await safeTarget(root, file.backupRelativePath);
        await ensureSafeParentDirectories(root, backup);
        await atomicWrite(backup, file.before, file.mode ?? 0o600);
      }
      await ensureSafeParentDirectories(root, file.absolutePath);
      const temporary = await stageFile(
        file.absolutePath,
        Buffer.from(file.planned.content, "utf8"),
        file.mode ?? 0o600,
      );
      staged.set(file.absolutePath, temporary);
    }

    for (const file of prepared) {
      const temporary = staged.get(file.absolutePath);
      if (temporary === undefined) {
        throw new Error(`Missing staged file for ${file.planned.relativePath}`);
      }
      const current = await readSafeRegularFile(file.absolutePath);
      const currentHash =
        current.content === null ? null : sha256(current.content);
      if (currentHash !== file.planned.beforeSha256) {
        throw new Error(
          `Concurrent modification of ${file.planned.relativePath}: expected ${formatHash(file.planned.beforeSha256)}, found ${formatHash(currentHash)}`,
        );
      }
      await rename(temporary, file.absolutePath);
      staged.delete(file.absolutePath);
      await syncDirectory(path.dirname(file.absolutePath));
      installed.push(file);
    }

    const receiptRelativePath = `${transactionRoot}/${transactionId}.json`;
    const receiptPath = await safeTarget(root, receiptRelativePath);
    await ensureSafeParentDirectories(root, receiptPath);
    await atomicWrite(receiptPath, stableStringify(transaction), 0o600);
    return transaction;
  } catch (error) {
    await cleanupStaged(staged);
    const restoreErrors = await restoreInstalled(installed);
    if (restoreErrors.length > 0) {
      throw new AggregateError(
        [error, ...restoreErrors],
        "Transaction failed and automatic restoration was incomplete",
      );
    }
    throw error;
  }
}

export async function rollbackTransaction(
  workspace: string,
  transaction: string | TransactionRecord,
): Promise<void> {
  const root = await resolveSafeWorkspace(workspace);
  const record =
    typeof transaction === "string"
      ? await loadTransaction(root, transaction)
      : transaction;
  validateTransaction(record);

  const targets: Array<{
    record: TransactionRecord["files"][number];
    absolutePath: string;
    backup: Buffer | null;
  }> = [];

  for (const file of record.files) {
    const absolutePath = await safeTarget(root, file.relativePath);
    const current = await readSafeRegularFile(absolutePath);
    const currentHash =
      current.content === null ? null : sha256(current.content);
    if (currentHash !== file.afterSha256) {
      throw new Error(
        `Rollback conflict for ${file.relativePath}: expected ${file.afterSha256}, found ${formatHash(currentHash)}`,
      );
    }

    let backup: Buffer | null = null;
    if (file.beforeSha256 !== null) {
      if (file.backupRelativePath === null) {
        throw new Error(`Missing backup path for ${file.relativePath}`);
      }
      const backupPath = await safeTarget(root, file.backupRelativePath);
      const backupState = await readSafeRegularFile(backupPath);
      if (
        backupState.content === null ||
        sha256(backupState.content) !== file.beforeSha256
      ) {
        throw new Error(`Backup integrity failure for ${file.relativePath}`);
      }
      backup = backupState.content;
      if (file.relativePath === projectConfig) {
        validateToml(decodeUtf8(backup, file.relativePath));
      }
    }
    targets.push({ record: file, absolutePath, backup });
  }

  const staged = new Map<string, string>();
  for (const target of targets) {
    if (target.backup !== null) {
      const temporary = await stageFile(
        target.absolutePath,
        target.backup,
        target.record.mode ?? 0o600,
      );
      staged.set(target.absolutePath, temporary);
    }
  }

  try {
    for (const target of targets) {
      if (target.backup === null) {
        await unlink(target.absolutePath);
      } else {
        const temporary = staged.get(target.absolutePath);
        if (temporary === undefined) {
          throw new Error(`Missing rollback stage for ${target.record.relativePath}`);
        }
        await rename(temporary, target.absolutePath);
        staged.delete(target.absolutePath);
      }
      await syncDirectory(path.dirname(target.absolutePath));
    }
    const rollbackMarker = await safeTarget(
      root,
      `${transactionRoot}/${record.transactionId}.rollback.json`,
    );
    await ensureSafeParentDirectories(root, rollbackMarker);
    await atomicWrite(
      rollbackMarker,
      stableStringify({
        schemaVersion: 1,
        transactionId: record.transactionId,
        rolledBackAt: new Date().toISOString(),
      }),
      0o600,
    );
  } catch (error) {
    await cleanupStaged(staged);
    throw error;
  }
}

async function resolveSafeWorkspace(workspace: string): Promise<string> {
  const supplied = path.resolve(workspace);
  const suppliedStats = await lstat(supplied);
  if (!suppliedStats.isDirectory() || suppliedStats.isSymbolicLink()) {
    throw new Error("Workspace must be a real directory, not a symlink");
  }
  return supplied;
}

async function safeTarget(root: string, relativePath: string): Promise<string> {
  if (
    relativePath === "" ||
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    throw new Error(`Unsafe transaction path: ${relativePath}`);
  }
  const target = await assertContainedPath(root, relativePath);
  await assertExistingAncestorsSafe(root, target);
  return target;
}

async function assertExistingAncestorsSafe(
  root: string,
  target: string,
): Promise<void> {
  const relative = path.relative(root, path.dirname(target));
  if (relative === "") {
    return;
  }
  let cursor = root;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const stats = await lstat(cursor);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Unsafe transaction ancestor: ${cursor}`);
      }
    } catch (error) {
      if (isMissing(error)) {
        return;
      }
      throw error;
    }
  }
}

async function ensureSafeParentDirectories(
  root: string,
  target: string,
): Promise<void> {
  const relative = path.relative(root, path.dirname(target));
  let cursor = root;
  for (const part of relative === "" ? [] : relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const stats = await lstat(cursor);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Unsafe transaction ancestor: ${cursor}`);
      }
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
      await mkdir(cursor, { mode: 0o700 });
      await syncDirectory(path.dirname(cursor));
    }
  }
}

async function readSafeRegularFile(
  target: string,
): Promise<{ content: Buffer | null; mode: number | null }> {
  try {
    const stats = await lstat(target);
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.nlink !== 1
    ) {
      throw new Error(
        `Transaction target must be a regular, single-link file: ${target}`,
      );
    }
    return {
      content: await readFile(target),
      mode: stats.mode & 0o777,
    };
  } catch (error) {
    if (isMissing(error)) {
      return { content: null, mode: null };
    }
    throw error;
  }
}

async function atomicWrite(
  target: string,
  content: string | Buffer,
  mode: number,
): Promise<void> {
  const temporary = await stageFile(
    target,
    typeof content === "string" ? Buffer.from(content, "utf8") : content,
    mode,
  );
  try {
    await rename(temporary, target);
    await syncDirectory(path.dirname(target));
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function stageFile(
  target: string,
  content: Buffer,
  mode: number,
): Promise<string> {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.codsemble-${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, mode);
  return temporary;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function restoreInstalled(installed: PreflightFile[]): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const file of [...installed].reverse()) {
    try {
      const current = await readSafeRegularFile(file.absolutePath);
      const currentHash =
        current.content === null ? null : sha256(current.content);
      if (currentHash !== file.planned.afterSha256) {
        throw new Error(
          `Refusing automatic restoration after concurrent modification of ${file.planned.relativePath}`,
        );
      }
      if (file.before === null) {
        await unlink(file.absolutePath);
      } else {
        await atomicWrite(
          file.absolutePath,
          file.before,
          file.mode ?? 0o600,
        );
      }
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function cleanupStaged(staged: Map<string, string>): Promise<void> {
  await Promise.all(
    [...staged.values()].map((temporary) =>
      unlink(temporary).catch(() => undefined),
    ),
  );
}

async function loadTransaction(
  root: string,
  transactionId: string,
): Promise<TransactionRecord> {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(transactionId)) {
    throw new Error("Invalid transaction id");
  }
  const receipt = await safeTarget(
    root,
    `${transactionRoot}/${transactionId}.json`,
  );
  const state = await readSafeRegularFile(receipt);
  if (state.content === null) {
    throw new Error(`Transaction receipt not found: ${transactionId}`);
  }
  try {
    return JSON.parse(decodeUtf8(state.content, receipt)) as TransactionRecord;
  } catch (error) {
    throw new Error(`Invalid transaction receipt: ${transactionId}`, {
      cause: error,
    });
  }
}

function validatePlan(plan: TeamPlan): void {
  if (
    plan.schemaVersion !== 1 ||
    !plan.planId ||
    !Array.isArray(plan.files) ||
    !Array.isArray(plan.preimages)
  ) {
    throw new Error("Invalid team plan");
  }
  const paths = new Set<string>();
  for (const file of plan.files) {
    if (!isCodsembleOwnedOutput(file.relativePath)) {
      throw new Error(
        `Plan contains a non-Codsemble output path: ${file.relativePath}`,
      );
    }
    if (paths.has(file.relativePath)) {
      throw new Error(`Duplicate planned path: ${file.relativePath}`);
    }
    paths.add(file.relativePath);
  }
  if (plan.preimages.length > 0) {
    const preimages = new Map(
      plan.preimages.map((preimage) => [preimage.relativePath, preimage]),
    );
    if (preimages.size !== plan.preimages.length) {
      throw new Error("Duplicate plan preimage path");
    }
    for (const file of plan.files) {
      const preimage = preimages.get(file.relativePath);
      if (
        preimage === undefined ||
        preimage.sha256 !== file.beforeSha256 ||
        preimage.exists !== (file.beforeSha256 !== null)
      ) {
        throw new Error(`Plan preimage metadata mismatch: ${file.relativePath}`);
      }
    }
  }
}

function validateTransaction(record: TransactionRecord): void {
  if (
    record.schemaVersion !== 1 ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(record.transactionId) ||
    !Array.isArray(record.files)
  ) {
    throw new Error("Invalid transaction record");
  }
  const paths = new Set<string>();
  for (const file of record.files) {
    if (
      !file.relativePath ||
      !isCodsembleOwnedOutput(file.relativePath) ||
      !/^[a-f0-9]{64}$/.test(file.afterSha256) ||
      (file.beforeSha256 !== null &&
        !/^[a-f0-9]{64}$/.test(file.beforeSha256)) ||
      paths.has(file.relativePath)
    ) {
      throw new Error("Invalid transaction file record");
    }
    const expectedBackup =
      file.beforeSha256 === null
        ? null
        : `${transactionRoot}/${record.transactionId}.backups/${file.relativePath}`;
    if (file.backupRelativePath !== expectedBackup) {
      throw new Error("Transaction backup path is outside its scoped directory");
    }
    paths.add(file.relativePath);
  }
}

function isCodsembleOwnedOutput(relativePath: string): boolean {
  return (
    relativePath === "AGENTS.md" ||
    relativePath === ".codex/config.toml" ||
    relativePath === ".codex/codsemble/manifest.json" ||
    /^\.codex\/agents\/[a-z][a-z0-9-]{1,63}\.toml$/.test(relativePath)
  );
}

function decodeUtf8(content: Buffer, label: string): string {
  const decoded = content.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(content)) {
    throw new Error(`File is not valid UTF-8: ${label}`);
  }
  return decoded;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function formatHash(value: string | null): string {
  return value ?? "<missing>";
}
