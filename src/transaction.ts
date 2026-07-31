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
import { computeConfirmationId } from "./compiler.js";
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
    if (planned.action === "delete") {
      if (planned.content !== null || planned.afterSha256 !== null) {
        throw new Error(`Delete plan has an after-image for ${planned.relativePath}`);
      }
    } else if (
      typeof planned.content !== "string" ||
      planned.afterSha256 === null ||
      sha256(planned.content) !== planned.afterSha256
    ) {
      throw new Error(`After-image hash mismatch for ${planned.relativePath}`);
    }
    if (planned.action === "create" && state.content !== null) {
      throw new Error(`Create target already exists: ${planned.relativePath}`);
    }
    if (planned.action === "update" && state.content === null) {
      throw new Error(`Update target does not exist: ${planned.relativePath}`);
    }
    if (planned.action === "delete" && state.content === null) {
      throw new Error(`Delete target does not exist: ${planned.relativePath}`);
    }
    if (planned.relativePath === projectConfig) {
      if (state.content !== null) {
        validateToml(decodeUtf8(state.content, planned.relativePath));
      }
      if (planned.content !== null) validateToml(planned.content);
    }
    if (planned.content !== null) {
      validatePlannedOutput(planned.relativePath, planned.content);
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
      if (file.planned.action !== "delete") {
        const temporary = await stageFile(
          file.absolutePath,
          Buffer.from(file.planned.content as string, "utf8"),
          file.mode ?? 0o600,
        );
        staged.set(file.absolutePath, temporary);
      }
    }

    for (const file of prepared) {
      const current = await readSafeRegularFile(file.absolutePath);
      const currentHash =
        current.content === null ? null : sha256(current.content);
      if (currentHash !== file.planned.beforeSha256) {
        throw new Error(
          `Concurrent modification of ${file.planned.relativePath}: expected ${formatHash(file.planned.beforeSha256)}, found ${formatHash(currentHash)}`,
        );
      }
      if (file.planned.action === "delete") {
        await unlink(file.absolutePath);
      } else {
        const temporary = staged.get(file.absolutePath);
        if (temporary === undefined) {
          throw new Error(`Missing staged file for ${file.planned.relativePath}`);
        }
        await rename(temporary, file.absolutePath);
        staged.delete(file.absolutePath);
      }
      installed.push(file);
      await syncDirectory(path.dirname(file.absolutePath));
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
    postimage: Buffer | null;
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
    targets.push({
      record: file,
      absolutePath,
      backup,
      postimage: current.content,
    });
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

  const completed: typeof targets = [];
  try {
    for (const target of targets) {
      const current = await readSafeRegularFile(target.absolutePath);
      const currentHash =
        current.content === null ? null : sha256(current.content);
      if (currentHash !== target.record.afterSha256) {
        throw new Error(
          `Rollback concurrent modification of ${target.record.relativePath}`,
        );
      }
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
      completed.push(target);
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
    const restoreErrors = await restoreRolledBack(completed);
    if (restoreErrors.length > 0) {
      throw new AggregateError(
        [error, ...restoreErrors],
        "Rollback failed and forward restoration was incomplete",
      );
    }
    throw error;
  }
}

async function restoreRolledBack(
  completed: Array<{
    record: TransactionRecord["files"][number];
    absolutePath: string;
    backup: Buffer | null;
    postimage: Buffer | null;
  }>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const target of [...completed].reverse()) {
    try {
      const current = await readSafeRegularFile(target.absolutePath);
      const expectedRollbackHash = target.record.beforeSha256;
      const currentHash =
        current.content === null ? null : sha256(current.content);
      if (currentHash !== expectedRollbackHash) {
        throw new Error(
          `Refusing forward restoration after concurrent modification of ${target.record.relativePath}`,
        );
      }
      if (target.postimage === null) {
        await unlink(target.absolutePath);
        await syncDirectory(path.dirname(target.absolutePath));
      } else {
        await atomicWrite(
          target.absolutePath,
          target.postimage,
          target.record.mode ?? 0o600,
        );
      }
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
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
  let handle;
  try {
    handle = await open(directory, "r");
  } catch (error) {
    if (process.platform === "win32" && isUnsupportedDirectorySync(error)) {
      return;
    }
    throw error;
  }
  try {
    try {
      await handle.sync();
    } catch (error) {
      if (!(process.platform === "win32" && isUnsupportedDirectorySync(error))) {
        throw error;
      }
    }
  } finally {
    await handle.close();
  }
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return ["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(
    String((error as NodeJS.ErrnoException).code),
  );
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
    !/^[a-f0-9]{32}$/.test(plan.confirmationId) ||
    !Array.isArray(plan.files) ||
    !Array.isArray(plan.preimages)
  ) {
    throw new Error("Invalid team plan");
  }
  if (computeConfirmationId(plan) !== plan.confirmationId) {
    throw new Error("Plan confirmation digest mismatch");
  }
  const paths = new Set<string>();
  let totalContentBytes = 0;
  for (const file of plan.files) {
    if (!isCodsembleOwnedOutput(file.relativePath)) {
      throw new Error(
        `Plan contains a non-Codsemble output path: ${file.relativePath}`,
      );
    }
    if (paths.has(file.relativePath)) {
      throw new Error(`Duplicate planned path: ${file.relativePath}`);
    }
    if (!["create", "update", "delete"].includes(file.action)) {
      throw new Error(`Invalid planned action: ${file.relativePath}`);
    }
    if (
      file.action === "delete"
        ? file.content !== null || file.afterSha256 !== null
        : typeof file.content !== "string" ||
          file.afterSha256 === null ||
          !/^[a-f0-9]{64}$/.test(file.afterSha256)
    ) {
      throw new Error(`Invalid planned after-image: ${file.relativePath}`);
    }
    if (typeof file.content === "string") {
      const bytes = Buffer.byteLength(file.content, "utf8");
      if (bytes > 1024 * 1024) {
        throw new Error(`Planned output exceeds 1 MiB: ${file.relativePath}`);
      }
      totalContentBytes += bytes;
    }
    paths.add(file.relativePath);
  }
  if (totalContentBytes > 8 * 1024 * 1024) {
    throw new Error("Combined planned output exceeds 8 MiB");
  }
  const preimages = new Map(
    plan.preimages.map((preimage) => [preimage.relativePath, preimage]),
  );
  if (
    preimages.size !== plan.preimages.length ||
    preimages.size !== plan.files.length
  ) {
    throw new Error("Plan must contain exactly one preimage per planned path");
  }
  for (const file of plan.files) {
    const preimage = preimages.get(file.relativePath);
    if (
      preimage === undefined ||
      preimage.sha256 !== file.beforeSha256 ||
      preimage.exists !== (file.beforeSha256 !== null) ||
      (file.beforeSha256 !== null &&
        !/^[a-f0-9]{64}$/.test(file.beforeSha256))
    ) {
      throw new Error(`Plan preimage metadata mismatch: ${file.relativePath}`);
    }
  }
}

function validatePlannedOutput(
  relativePath: string,
  content: string,
): void {
  if (/^\.codex\/agents\/.+\.toml$/.test(relativePath)) {
    const parsed = validateToml(content);
    const allowed = new Set([
      "name",
      "description",
      "developer_instructions",
      "model",
      "model_reasoning_effort",
      "sandbox_mode",
    ]);
    for (const key of Object.keys(parsed)) {
      if (!allowed.has(key)) {
        throw new Error(`Generated agent contains unsupported key: ${key}`);
      }
    }
    for (const required of ["name", "description", "developer_instructions"]) {
      if (typeof parsed[required] !== "string" || parsed[required] === "") {
        throw new Error(`Generated agent is missing ${required}`);
      }
    }
    if (
      parsed.sandbox_mode !== "read-only" &&
      parsed.sandbox_mode !== "workspace-write"
    ) {
      throw new Error("Generated agent has an unsupported sandbox_mode");
    }
  } else if (relativePath === ".codex/codsemble/manifest.json") {
    const parsed = JSON.parse(content) as {
      schemaVersion?: unknown;
      planId?: unknown;
      generator?: { name?: unknown; version?: unknown };
      catalogVersion?: unknown;
      ownership?: unknown;
    };
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.planId !== "string" ||
      parsed.generator?.name !== "codsemble" ||
      typeof parsed.generator.version !== "string" ||
      typeof parsed.catalogVersion !== "string" ||
      typeof parsed.ownership !== "object" ||
      parsed.ownership === null
    ) {
      throw new Error("Generated Codsemble manifest has an invalid schema");
    }
  } else if (relativePath === "AGENTS.md") {
    const starts = content.split("<!-- codsemble:start -->").length - 1;
    const ends = content.split("<!-- codsemble:end -->").length - 1;
    if (starts !== 1 || ends !== 1) {
      throw new Error("Generated AGENTS.md must contain exactly one managed block");
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
      (file.afterSha256 !== null &&
        !/^[a-f0-9]{64}$/.test(file.afterSha256)) ||
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

export function isCodsembleOwnedOutput(relativePath: string): boolean {
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
