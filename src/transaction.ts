import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { patchConcurrencyToml, validateToml } from "./config.js";
import {
  computeConfirmationId,
  renderManagedAgentsFile,
} from "./compiler.js";
import type {
  PlannedFile,
  TeamPlan,
  TransactionRecord,
} from "./types.js";
import {
  assertContainedPath,
  sha256,
  stableStringify,
  toPosix,
} from "./util.js";

const transactionRoot = ".codex/codsemble/transactions";
const projectConfig = ".codex/config.toml";
const agentPathPattern = /^\.codex\/agents\/[a-z][a-z0-9-]{1,63}\.toml$/;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const generatedAgentSchema = z
  .object({
    name: z.string().min(1).max(128),
    description: z.string().min(1).max(1_000),
    developer_instructions: z.string().min(1).max(64 * 1024),
    model: z.string().min(1).max(200).regex(/^[^\s]+$/).optional(),
    model_reasoning_effort: z
      .enum(["low", "medium", "high", "xhigh"])
      .optional(),
    sandbox_mode: z.enum(["read-only", "workspace-write"]),
  })
  .strict()
  .superRefine((agent, context) => {
    if (agent.model_reasoning_effort !== undefined && agent.model === undefined) {
      context.addIssue({
        code: "custom",
        message: "model_reasoning_effort requires model",
        path: ["model_reasoning_effort"],
      });
    }
  });
const transactionIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/);
const transactionFileSchema = z
  .object({
    relativePath: z.string().min(1),
    beforeSha256: digestSchema.nullable(),
    afterSha256: digestSchema.nullable(),
    backupRelativePath: z.string().min(1).nullable(),
    quarantineRelativePath: z.string().min(1).nullable(),
    mode: z.number().int().min(0).max(0o777).nullable(),
  })
  .strict()
  .refine(
    ({ beforeSha256, afterSha256 }) =>
      beforeSha256 !== null || afterSha256 !== null,
    { message: "transaction file must have a preimage or postimage" },
  );
const transactionRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    transactionId: transactionIdSchema,
    planId: z.string().min(1).max(512),
    createdAt: z.string().datetime({ offset: true }),
    files: z.array(transactionFileSchema).min(1).max(256),
  })
  .strict();
const rollbackMarkerSchema = z
  .object({
    schemaVersion: z.literal(1),
    transactionId: transactionIdSchema,
    rolledBackAt: z.string().datetime({ offset: true }),
    quarantineRelativePaths: z.array(z.string().min(1)).max(256),
  })
  .strict();
export const generatedManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generator: z
      .object({ name: z.literal("codsemble"), version: z.string().min(1) })
      .strict(),
    catalogVersion: z.string().min(1),
    planId: z.string().min(1),
    auditFingerprint: digestSchema,
    proposal: z
      .object({
        kind: z.enum(["lean", "balanced", "full"]),
        maxConcurrentWorkers: z.number().int().min(1).max(111),
      })
      .strict(),
    capabilities: z
      .object({
        configAdapter: z.literal("agents-v1").nullable(),
        modelCapabilities: z.array(
          z
            .object({
              id: z.string().min(1).max(200).regex(/^[^\s]+$/),
              supportedReasoningEfforts: z.array(
                z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/),
              ),
            })
            .strict(),
        ),
        availableTools: z.array(
          z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
        ),
      })
      .strict(),
    roles: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
          name: z.string().min(1),
          modelProfile: z.enum(["inherit", "deep", "balanced", "fast"]),
          model: z.string().min(1).max(200).regex(/^[^\s]+$/).optional(),
          reasoningEffort: z
            .enum(["low", "medium", "high", "xhigh"])
            .optional(),
          sandbox: z.enum(["read-only", "workspace-write"]),
          source: z.enum(["custom", "catalog"]),
        })
        .strict(),
    ),
    ownership: z
      .object({
        agentsBlock: z
          .object({
            path: z.literal("AGENTS.md"),
            start: z.literal("<!-- codsemble:start -->"),
            end: z.literal("<!-- codsemble:end -->"),
          })
          .strict(),
        agentFiles: z
          .array(z.string().regex(agentPathPattern))
          .refine((paths) => new Set(paths).size === paths.length, {
            message: "agentFiles must be unique",
          }),
        agentSha256: z.record(z.string().regex(agentPathPattern), digestSchema),
      })
      .strict(),
  })
  .strict();

interface PreflightFile {
  planned: PlannedFile;
  absolutePath: string;
  before: Buffer | null;
  mode: number | null;
  backupRelativePath: string | null;
  quarantinePath: string;
  quarantineRelativePath: string;
}

interface VerifiedFile {
  planned: PlannedFile;
  absolutePath: string;
}

interface CompletedMutation {
  relativePath: string;
  absolutePath: string;
  sourceSha256: string | null;
  desiredSha256: string | null;
  quarantinePath: string | null;
  mode: number;
}

class PreservedConflictError extends Error {}
class CommitArtifactPublishedError extends Error {}

export interface TransactionHooks {
  beforeExclusivePublish?: (relativePath: string) => Promise<void>;
  afterDurableCommit?: (
    operation: "apply" | "rollback",
  ) => Promise<void>;
}

export interface RollbackMarker {
  schemaVersion: 1;
  transactionId: string;
  rolledBackAt: string;
  quarantineRelativePaths: string[];
}

export async function applyTeamPlan(
  workspace: string,
  plan: TeamPlan,
  hooks: TransactionHooks = {},
): Promise<TransactionRecord> {
  assertValidTeamPlan(plan);
  if (plan.files.length === 0) {
    throw new Error(
      "No managed file changes are required; no transaction was created",
    );
  }
  const root = await resolveSafeWorkspace(workspace);
  const transactionId = randomUUID();
  const prepared: PreflightFile[] = [];
  const verified: VerifiedFile[] = [];

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
      if (planned.content !== null) {
        validateToml(planned.content);
        if (planned.action === "verify") {
          validateProjectConfigVerification(plan, planned.content);
        } else {
          validateProjectConfigOutput(
            plan,
            state.content === null
              ? ""
              : decodeUtf8(state.content, planned.relativePath),
            planned.content,
          );
        }
      }
    }
    if (planned.relativePath === "AGENTS.md" && planned.content !== null) {
      validateManagedAgentsOutput(
        plan,
        state.content === null
          ? undefined
          : decodeUtf8(state.content, planned.relativePath),
        planned.content,
      );
    }
    if (planned.content !== null) {
      validatePlannedOutput(planned.relativePath, planned.content, plan);
    }
    if (planned.action === "verify") {
      verified.push({ planned, absolutePath });
      continue;
    }
    const quarantineRelativePath =
      `${transactionRoot}/${transactionId}.quarantines/${planned.relativePath}`;
    prepared.push({
      planned,
      absolutePath,
      before: state.content,
      mode: state.mode,
      backupRelativePath:
        state.content === null
          ? null
          : `${transactionRoot}/${transactionId}.backups/${planned.relativePath}`,
      quarantinePath: await safeTarget(root, quarantineRelativePath),
      quarantineRelativePath,
    });
  }
  await validateAgentDeletes(root, plan);
  await validateUnchangedManifestOwnership(root, plan);
  if (prepared.length === 0) {
    throw new Error(
      "No managed file changes are required; no transaction was created",
    );
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
      quarantineRelativePath:
        file.before === null
          ? null
          : file.quarantineRelativePath,
    })),
  };
  assertValidTransactionRecord(transaction);

  const staged = new Map<string, string>();
  const installed: CompletedMutation[] = [];
  let releaseLock: (() => Promise<void>) | undefined;
  let pendingPath: string | undefined;
  let committed = false;
  try {
    releaseLock = await acquireMutationLock(root, "apply", transactionId);
    await revalidateVerifiedFiles(verified);
    for (const file of prepared) {
      if (file.before !== null && file.backupRelativePath !== null) {
        const backup = await safeTarget(root, file.backupRelativePath);
        await ensureSafeParentDirectories(root, backup);
        await atomicWrite(backup, file.before, file.mode ?? 0o600);
      }
      await ensureSafeParentDirectories(root, file.absolutePath);
      await ensureSafeParentDirectories(root, file.quarantinePath);
      if (file.planned.action !== "delete") {
        const temporary = await stageFile(
          file.absolutePath,
          Buffer.from(file.planned.content as string, "utf8"),
          file.mode ?? 0o600,
        );
        staged.set(file.absolutePath, temporary);
      }
    }
    pendingPath = await writePendingMutation(
      root,
      `${transactionRoot}/${transactionId}.apply.pending.json`,
      {
        schemaVersion: 1,
        operation: "apply",
        transactionId,
        createdAt: new Date().toISOString(),
        files: prepared.map((file) => ({
          relativePath: file.planned.relativePath,
          sourceSha256: file.planned.beforeSha256,
          desiredSha256: file.planned.afterSha256,
          quarantinePath: toPosix(path.relative(root, file.quarantinePath)),
        })),
      },
    );

    for (const file of prepared) {
      const temporary =
        file.planned.action === "delete"
          ? null
          : staged.get(file.absolutePath);
      if (file.planned.action !== "delete" && temporary === undefined) {
        throw new Error(`Missing staged file for ${file.planned.relativePath}`);
      }
      installed.push(
        await mutateLosslessly({
          relativePath: file.planned.relativePath,
          absolutePath: file.absolutePath,
          sourceSha256: file.planned.beforeSha256,
          desiredSha256: file.planned.afterSha256,
          stagedPath: temporary ?? null,
          quarantinePath: file.quarantinePath,
          mode: file.mode ?? 0o600,
          hooks,
        }),
      );
      if (temporary !== null && temporary !== undefined) {
        staged.delete(file.absolutePath);
      }
    }
    await revalidateVerifiedFiles(verified);

    const receiptRelativePath = `${transactionRoot}/${transactionId}.json`;
    const receiptPath = await safeTarget(root, receiptRelativePath);
    await ensureSafeParentDirectories(root, receiptPath);
    await atomicCommitWrite(receiptPath, stableStringify(transaction), 0o600);
    committed = true;
    await hooks.afterDurableCommit?.("apply");
    await finishPendingMutation(pendingPath, installed);
    await releaseLock();
    releaseLock = undefined;
    return transaction;
  } catch (error) {
    await cleanupStaged(staged);
    if (error instanceof CommitArtifactPublishedError) {
      committed = true;
    }
    if (committed) {
      await releaseLock?.().catch(() => undefined);
      throw new Error(
        "Transaction committed, but post-commit cleanup is incomplete; inspect Doctor before another write",
        { cause: error },
      );
    }
    const restoreErrors = await restoreMutationsLosslessly(installed);
    const pendingCleared =
      restoreErrors.length === 0 &&
      !(error instanceof PreservedConflictError)
        ? await clearPendingMutation(pendingPath)
        : pendingPath === undefined;
    if (!(error instanceof PreservedConflictError) && pendingCleared) {
      await releaseLock?.().catch(() => undefined);
    }
    if (restoreErrors.length > 0) {
      throw new AggregateError(
        [error, ...restoreErrors],
        "Transaction failed; conflicting bytes were preserved and manual recovery is required",
      );
    }
    throw error;
  }
}

async function revalidateVerifiedFiles(
  verified: VerifiedFile[],
): Promise<void> {
  for (const { planned, absolutePath } of verified) {
    const state = await readSafeRegularFile(absolutePath);
    const currentHash =
      state.content === null ? null : sha256(state.content);
    if (currentHash !== planned.afterSha256) {
      throw new Error(
        `Verified plan state changed during apply: ${planned.relativePath}`,
      );
    }
  }
}

export async function verifyNoChangesPlan(
  workspace: string,
  plan: TeamPlan,
): Promise<void> {
  assertValidTeamPlan(plan);
  if (plan.files.some(({ action }) => action !== "verify")) {
    throw new Error("No-changes verification received a mutating plan");
  }
  assertCompleteVerificationSet(plan);
  const root = await resolveSafeWorkspace(workspace);
  for (const planned of plan.files) {
    const absolutePath = await safeTarget(root, planned.relativePath);
    const state = await readSafeRegularFile(absolutePath);
    const currentHash =
      state.content === null ? null : sha256(state.content);
    if (currentHash !== planned.beforeSha256) {
      throw new Error(
        `No-changes state conflict for ${planned.relativePath}: expected ${formatHash(planned.beforeSha256)}, found ${formatHash(currentHash)}`,
      );
    }
    if (
      planned.content === null ||
      planned.afterSha256 === null ||
      sha256(planned.content) !== planned.afterSha256
    ) {
      throw new Error(
        `No-changes verification image mismatch: ${planned.relativePath}`,
      );
    }
    if (planned.relativePath === projectConfig) {
      validateToml(planned.content);
      validateProjectConfigVerification(plan, planned.content);
    }
    if (planned.relativePath === "AGENTS.md") {
      validateManagedAgentsOutput(
        plan,
        state.content === null
          ? undefined
          : decodeUtf8(state.content, planned.relativePath),
        planned.content,
      );
    }
    validatePlannedOutput(planned.relativePath, planned.content, plan);
  }
}

function assertCompleteVerificationSet(plan: TeamPlan): void {
  if (plan.roles.length === 0) {
    throw new Error("No-changes verification requires at least one role");
  }
  const expectedPaths = [
    "AGENTS.md",
    ".codex/codsemble/manifest.json",
    ...plan.roles.map(({ id }) => `.codex/agents/${id}.toml`),
    ...(["preview", "apply-project"].includes(plan.concurrency.configMode)
      ? [projectConfig]
      : []),
  ].sort();
  const actualPaths = plan.files
    .map(({ relativePath }) => relativePath)
    .sort();
  if (
    expectedPaths.length !== actualPaths.length ||
    expectedPaths.some((entry, index) => entry !== actualPaths[index])
  ) {
    throw new Error(
      "No-changes verification does not contain the complete generated output set",
    );
  }
}

function validateManagedAgentsOutput(
  plan: TeamPlan,
  before: string | undefined,
  after: string,
): void {
  const manifest = parsePlannedManifest(plan);
  const expected = renderManagedAgentsFile(
    before,
    plan.roles,
    manifest.proposal.kind,
  );
  if (after !== expected) {
    throw new Error(
      "Generated AGENTS.md managed block is not bound to the plan",
    );
  }
}

function parsePlannedManifest(
  plan: TeamPlan,
): ReturnType<typeof generatedManifestSchema.parse> {
  const manifestFile = plan.files.find(
    ({ relativePath, action }) =>
      relativePath === ".codex/codsemble/manifest.json" &&
      action !== "delete",
  );
  if (manifestFile?.content === null || manifestFile?.content === undefined) {
    throw new Error("Plan is missing its generated manifest");
  }
  return generatedManifestSchema.parse(JSON.parse(manifestFile.content));
}

export async function rollbackTransaction(
  workspace: string,
  transaction: string | TransactionRecord,
  hooks: TransactionHooks = {},
): Promise<void> {
  const root = await resolveSafeWorkspace(workspace);
  const record =
    typeof transaction === "string"
      ? await loadTransaction(root, transaction)
      : transaction;
  assertValidTransactionRecord(record);

  const targets: Array<{
    record: TransactionRecord["files"][number];
    absolutePath: string;
    backup: Buffer | null;
    quarantinePath: string;
    quarantineRelativePath: string;
  }> = [];
  const rollbackOperationId = `${record.transactionId}.rollback`;

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
    const quarantineRelativePath =
      `${transactionRoot}/${rollbackOperationId}.quarantines/${file.relativePath}`;
    targets.push({
      record: file,
      absolutePath,
      backup,
      quarantinePath: await safeTarget(root, quarantineRelativePath),
      quarantineRelativePath,
    });
  }

  const staged = new Map<string, string>();
  const completed: CompletedMutation[] = [];
  let releaseLock: (() => Promise<void>) | undefined;
  let pendingPath: string | undefined;
  let committed = false;
  try {
    releaseLock = await acquireMutationLock(
      root,
      "rollback",
      record.transactionId,
    );
    for (const target of targets) {
      await ensureSafeParentDirectories(root, target.quarantinePath);
      if (target.backup !== null) {
        const temporary = await stageFile(
          target.absolutePath,
          target.backup,
          target.record.mode ?? 0o600,
        );
        staged.set(target.absolutePath, temporary);
      }
    }
    pendingPath = await writePendingMutation(
      root,
      `${transactionRoot}/${record.transactionId}.rollback.pending.json`,
      {
        schemaVersion: 1,
        operation: "rollback",
        transactionId: record.transactionId,
        createdAt: new Date().toISOString(),
        files: targets.map((target) => ({
          relativePath: target.record.relativePath,
          sourceSha256: target.record.afterSha256,
          desiredSha256: target.record.beforeSha256,
          quarantinePath: target.quarantineRelativePath,
        })),
      },
    );
    for (const target of targets) {
      const temporary =
        target.backup === null ? null : staged.get(target.absolutePath);
      if (target.backup !== null && temporary === undefined) {
        throw new Error(`Missing rollback stage for ${target.record.relativePath}`);
      }
      completed.push(
        await mutateLosslessly({
          relativePath: target.record.relativePath,
          absolutePath: target.absolutePath,
          sourceSha256: target.record.afterSha256,
          desiredSha256: target.record.beforeSha256,
          stagedPath: temporary ?? null,
          quarantinePath: target.quarantinePath,
          mode: target.record.mode ?? 0o600,
          hooks,
        }),
      );
      if (temporary !== null && temporary !== undefined) {
        staged.delete(target.absolutePath);
      }
    }
    const rollbackMarkerPath = await safeTarget(
      root,
      `${transactionRoot}/${record.transactionId}.rollback.json`,
    );
    const rollbackMarker: RollbackMarker = {
      schemaVersion: 1,
      transactionId: record.transactionId,
      rolledBackAt: new Date().toISOString(),
      quarantineRelativePaths: completed
        .map(({ quarantinePath }) =>
          quarantinePath === null
            ? null
            : toPosix(path.relative(root, quarantinePath)),
        )
        .filter((entry): entry is string => entry !== null),
    };
    assertValidRollbackMarker(rollbackMarker);
    await ensureSafeParentDirectories(root, rollbackMarkerPath);
    await atomicCommitWrite(
      rollbackMarkerPath,
      stableStringify(rollbackMarker),
      0o600,
    );
    committed = true;
    await hooks.afterDurableCommit?.("rollback");
    await finishPendingMutation(pendingPath, completed);
    await releaseLock();
    releaseLock = undefined;
  } catch (error) {
    await cleanupStaged(staged);
    if (error instanceof CommitArtifactPublishedError) {
      committed = true;
    }
    if (committed) {
      await releaseLock?.().catch(() => undefined);
      throw new Error(
        "Rollback committed, but post-commit cleanup is incomplete; inspect Doctor before another write",
        { cause: error },
      );
    }
    const restoreErrors = await restoreMutationsLosslessly(completed);
    const pendingCleared =
      restoreErrors.length === 0 &&
      !(error instanceof PreservedConflictError)
        ? await clearPendingMutation(pendingPath)
        : pendingPath === undefined;
    if (!(error instanceof PreservedConflictError) && pendingCleared) {
      await releaseLock?.().catch(() => undefined);
    }
    if (restoreErrors.length > 0) {
      throw new AggregateError(
        [error, ...restoreErrors],
        "Rollback failed; conflicting bytes were preserved and manual recovery is required",
      );
    }
    throw error;
  }
}

async function restoreMutationsLosslessly(
  completed: CompletedMutation[],
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const target of [...completed].reverse()) {
    try {
      const forwardQuarantine =
        `${target.absolutePath}.codsemble-restore-${randomUUID()}.quarantine`;
      const current = await readSafeRegularFile(target.absolutePath);
      const currentHash = current.content === null ? null : sha256(current.content);
      if (currentHash !== target.desiredSha256) {
        throw new Error(
          `Refusing restoration after concurrent modification of ${target.relativePath}`,
        );
      }
      if (current.content !== null) {
        await rename(target.absolutePath, forwardQuarantine);
        await syncDirectory(path.dirname(target.absolutePath));
        const moved = await readSafeRegularFile(forwardQuarantine);
        if (
          moved.content === null ||
          sha256(moved.content) !== target.desiredSha256
        ) {
          await restoreQuarantineExclusive(
            forwardQuarantine,
            target.absolutePath,
          );
          throw new Error(
            `Concurrent modification raced restoration of ${target.relativePath}`,
          );
        }
      }
      if (target.quarantinePath !== null) {
        await restoreQuarantineExclusive(
          target.quarantinePath,
          target.absolutePath,
        );
      }
      if (current.content !== null) {
        await unlink(forwardQuarantine);
      }
      await syncDirectory(path.dirname(target.absolutePath));
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function mutateLosslessly(input: {
  relativePath: string;
  absolutePath: string;
  sourceSha256: string | null;
  desiredSha256: string | null;
  stagedPath: string | null;
  quarantinePath: string;
  mode: number;
  hooks: TransactionHooks;
}): Promise<CompletedMutation> {
  const {
    relativePath,
    absolutePath,
    sourceSha256,
    desiredSha256,
    stagedPath,
    quarantinePath,
    mode,
    hooks,
  } = input;
  const quarantineState = await readSafeRegularFile(quarantinePath);
  if (quarantineState.content !== null) {
    throw new Error(`Quarantine path already exists for ${relativePath}`);
  }

  let retainedQuarantine: string | null = null;
  if (sourceSha256 !== null) {
    try {
      await rename(absolutePath, quarantinePath);
    } catch (error) {
      throw new Error(
        `Concurrent modification of ${relativePath}: source disappeared before quarantine`,
        { cause: error },
      );
    }
    retainedQuarantine = quarantinePath;
    await syncDirectory(path.dirname(absolutePath));
    const quarantined = await readSafeRegularFile(quarantinePath);
    const quarantinedHash =
      quarantined.content === null ? null : sha256(quarantined.content);
    if (quarantinedHash !== sourceSha256) {
      try {
        await restoreQuarantineExclusive(quarantinePath, absolutePath);
      } catch (error) {
        throw new PreservedConflictError(
          `Concurrent bytes for ${relativePath} and its quarantine were preserved for manual recovery`,
          { cause: error },
        );
      }
      throw new Error(
        `Concurrent modification of ${relativePath}: expected ${formatHash(sourceSha256)}, quarantined ${formatHash(quarantinedHash)}`,
      );
    }
  } else {
    const current = await readSafeRegularFile(absolutePath);
    if (current.content !== null) {
      throw new Error(`Concurrent creation of ${relativePath}`);
    }
  }

  try {
    await hooks.beforeExclusivePublish?.(relativePath);
    if (desiredSha256 !== null) {
      if (stagedPath === null) {
        throw new Error(`Missing staged desired image for ${relativePath}`);
      }
      await link(stagedPath, absolutePath);
      await unlink(stagedPath);
      await syncDirectory(path.dirname(absolutePath));
      const published = await readSafeRegularFile(absolutePath);
      if (
        published.content === null ||
        sha256(published.content) !== desiredSha256
      ) {
        throw new Error(`Published image verification failed for ${relativePath}`);
      }
    } else {
      const recreated = await readSafeRegularFile(absolutePath);
      if (recreated.content !== null) {
        throw new Error(
          `Concurrent recreation of ${relativePath}; the new bytes were preserved`,
        );
      }
    }
    return {
      relativePath,
      absolutePath,
      sourceSha256,
      desiredSha256,
      quarantinePath: retainedQuarantine,
      mode,
    };
  } catch (error) {
    if (retainedQuarantine !== null) {
      try {
        await restoreQuarantineExclusive(
          retainedQuarantine,
          absolutePath,
        );
      } catch (restoreError) {
        throw new PreservedConflictError(
          `Exclusive publication failed for ${relativePath}; target and quarantine bytes were preserved for manual recovery`,
          { cause: new AggregateError([error, restoreError]) },
        );
      }
    }
    throw new Error(
      `Exclusive publication failed for ${relativePath}; conflicting bytes were not overwritten`,
      { cause: error },
    );
  }
}

async function restoreQuarantineExclusive(
  quarantinePath: string,
  targetPath: string,
): Promise<void> {
  await link(quarantinePath, targetPath);
  await syncDirectory(path.dirname(targetPath));
  await unlink(quarantinePath);
  await syncDirectory(path.dirname(targetPath));
}

async function acquireMutationLock(
  root: string,
  operation: "apply" | "rollback",
  transactionId: string,
): Promise<() => Promise<void>> {
  const lockPath = await safeTarget(
    root,
    `${transactionRoot}/mutation.lock`,
  );
  await ensureSafeParentDirectories(root, lockPath);
  const transactionDirectory = path.dirname(lockPath);
  const beforePending = await listPendingMutations(transactionDirectory);
  if (beforePending.length > 0) {
    throw new Error(
      `Incomplete Codsemble mutation record(s) block new writes: ${beforePending.join(", ")}`,
    );
  }
  try {
    await mkdir(lockPath, { mode: 0o700 });
    await syncDirectory(path.dirname(lockPath));
  } catch (error) {
    throw new Error(
      `A Codsemble mutation lock already exists; ${operation} ${transactionId} cannot proceed until the prior operation is recovered`,
      { cause: error },
    );
  }
  const afterPending = await listPendingMutations(transactionDirectory);
  if (afterPending.length > 0) {
    await rmdir(lockPath).catch(() => undefined);
    await syncDirectory(transactionDirectory).catch(() => undefined);
    throw new Error(
      `Incomplete Codsemble mutation record(s) appeared while locking: ${afterPending.join(", ")}`,
    );
  }
  return async () => {
    await rmdir(lockPath);
    await syncDirectory(path.dirname(lockPath));
  };
}

async function listPendingMutations(directory: string): Promise<string[]> {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Transaction directory must be a real directory");
  }
  return (await readdir(directory))
    .filter((entry) => entry.endsWith(".pending.json"))
    .sort();
}

async function clearPendingMutation(
  pendingPath: string | undefined,
): Promise<boolean> {
  if (pendingPath === undefined) return true;
  try {
    await unlink(pendingPath);
    await syncDirectory(path.dirname(pendingPath));
    return true;
  } catch {
    return false;
  }
}

async function writePendingMutation(
  root: string,
  relativePath: string,
  journal: unknown,
): Promise<string> {
  const target = await safeTarget(root, relativePath);
  await ensureSafeParentDirectories(root, target);
  const existing = await readSafeRegularFile(target);
  if (existing.content !== null) {
    throw new Error(`Pending mutation record already exists: ${relativePath}`);
  }
  await atomicWrite(target, stableStringify(journal), 0o600);
  return target;
}

async function finishPendingMutation(
  pendingPath: string | undefined,
  _mutations: CompletedMutation[],
): Promise<void> {
  if (pendingPath !== undefined) {
    await unlink(pendingPath);
    await syncDirectory(path.dirname(pendingPath));
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

async function atomicCommitWrite(
  target: string,
  content: string | Buffer,
  mode: number,
): Promise<void> {
  const temporary = await stageFile(
    target,
    typeof content === "string" ? Buffer.from(content, "utf8") : content,
    mode,
  );
  let published = false;
  try {
    await rename(temporary, target);
    published = true;
    await syncDirectory(path.dirname(target));
  } catch (error) {
    if (!published) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    try {
      await unlink(target);
      await syncDirectory(path.dirname(target));
    } catch (cleanupError) {
      throw new CommitArtifactPublishedError(
        "Commit artifact may be published after durability verification failed",
        { cause: new AggregateError([error, cleanupError]) },
      );
    }
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

export function assertValidTeamPlan(plan: TeamPlan): void {
  if (
    plan.schemaVersion !== 1 ||
    !plan.planId ||
    !/^[a-f0-9]{32}$/.test(plan.confirmationId) ||
    !Array.isArray(plan.files) ||
    !Array.isArray(plan.preimages) ||
    plan.files.length === 0
  ) {
    throw new Error("Invalid team plan");
  }
  if (plan.files.length > 256) {
    throw new Error("Plan exceeds the 256-file transaction limit");
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
    if (!["create", "update", "delete", "verify"].includes(file.action)) {
      throw new Error(`Invalid planned action: ${file.relativePath}`);
    }
    if (
      file.action === "delete" &&
      [
        projectConfig,
        "AGENTS.md",
        ".codex/codsemble/manifest.json",
      ].includes(file.relativePath)
    ) {
      throw new Error(
        `Codsemble never deletes protected project metadata: ${file.relativePath}`,
      );
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
    if (
      file.action === "verify" &&
      (file.beforeSha256 === null ||
        file.beforeSha256 !== file.afterSha256)
    ) {
      throw new Error(`Invalid verification image: ${file.relativePath}`);
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
  plan: TeamPlan,
): void {
  if (agentPathPattern.test(relativePath)) {
    const parsed = validateToml(content);
    const validated = generatedAgentSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(
        `Generated agent has an invalid schema: ${validated.error.message}`,
      );
    }
    const roleId = path.posix.basename(relativePath, ".toml");
    const role = plan.roles.find(({ id }) => id === roleId);
    if (
      role === undefined ||
      validated.data.name !== role.id.replaceAll("-", "_") ||
      validated.data.description !== role.description ||
      validated.data.developer_instructions !== role.developerInstructions ||
      validated.data.model !== role.model ||
      validated.data.model_reasoning_effort !== role.reasoningEffort ||
      validated.data.sandbox_mode !== role.sandbox
    ) {
      throw new Error(`Generated agent is not bound to plan role: ${roleId}`);
    }
  } else if (relativePath === ".codex/codsemble/manifest.json") {
    const parsed = generatedManifestSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      throw new Error(
        `Generated Codsemble manifest has an invalid schema: ${parsed.error.message}`,
      );
    }
    const expectedAgentFiles = plan.roles
      .map(({ id }) => `.codex/agents/${id}.toml`)
      .sort();
    const ownedAgentFiles = [...parsed.data.ownership.agentFiles].sort();
    const expectedRoles = plan.roles.map((role) => ({
      id: role.id,
      name: role.name,
      modelProfile: role.modelProfile,
      ...(role.model ? { model: role.model } : {}),
      ...(role.reasoningEffort
        ? { reasoningEffort: role.reasoningEffort }
        : {}),
      sandbox: role.sandbox,
      source: role.source,
    }));
    if (
      parsed.data.planId !== plan.planId ||
      parsed.data.auditFingerprint !== plan.auditFingerprint ||
      parsed.data.proposal.maxConcurrentWorkers !==
        plan.concurrency.requestedWorkers ||
      stableStringify(parsed.data.roles) !== stableStringify(expectedRoles) ||
      stableStringify(ownedAgentFiles) !== stableStringify(expectedAgentFiles) ||
      Object.keys(parsed.data.ownership.agentSha256).sort().join("\n") !==
        expectedAgentFiles.join("\n")
    ) {
      throw new Error("Generated Codsemble manifest is not bound to the plan");
    }
    for (const relativeAgentPath of expectedAgentFiles) {
      const plannedAgent = plan.files.find(
        ({ relativePath: candidate, action }) =>
          candidate === relativeAgentPath && action !== "delete",
      );
      if (
        plannedAgent !== undefined &&
        plannedAgent.afterSha256 !==
          parsed.data.ownership.agentSha256[relativeAgentPath]
      ) {
        throw new Error(
          `Generated Codsemble manifest ownership hash mismatch: ${relativeAgentPath}`,
        );
      }
    }
  } else if (relativePath === "AGENTS.md") {
    const starts = content.split("<!-- codsemble:start -->").length - 1;
    const ends = content.split("<!-- codsemble:end -->").length - 1;
    if (starts !== 1 || ends !== 1) {
      throw new Error("Generated AGENTS.md must contain exactly one managed block");
    }
  }
}

function validateProjectConfigOutput(
  plan: TeamPlan,
  before: string,
  after: string,
): void {
  if (
    plan.concurrency.configMode !== "apply-project" ||
    plan.concurrency.willApply !== true ||
    plan.concurrency.adapter !== "agents-v1"
  ) {
    throw new Error(
      "Generated project config is forbidden unless an apply-project agents-v1 change is confirmed",
    );
  }
  const expected = patchConcurrencyToml(
    before,
    plan.concurrency.requestedWorkers,
    "agents-v1",
  );
  if (!expected.changed || expected.content !== after) {
    throw new Error(
      "Generated project config is not the exact supported concurrency patch",
    );
  }
}

function validateProjectConfigVerification(
  plan: TeamPlan,
  content: string,
): void {
  if (
    !["preview", "apply-project"].includes(plan.concurrency.configMode) ||
    plan.concurrency.adapter !== "agents-v1"
  ) {
    throw new Error(
      "Project config verification requires a capability-confirmed agents-v1 plan",
    );
  }
  if (
    patchConcurrencyToml(
      content,
      plan.concurrency.requestedWorkers,
      "agents-v1",
    ).changed
  ) {
    throw new Error(
      "Verified project config does not satisfy the requested concurrency ceiling",
    );
  }
}

async function validateUnchangedManifestOwnership(
  root: string,
  plan: TeamPlan,
): Promise<void> {
  const manifestFile = plan.files.find(
    ({ relativePath, action }) =>
      relativePath === ".codex/codsemble/manifest.json" &&
      action !== "delete",
  );
  if (manifestFile?.content === null || manifestFile?.content === undefined) {
    return;
  }
  const manifest = generatedManifestSchema.parse(JSON.parse(manifestFile.content));
  for (const relativePath of manifest.ownership.agentFiles) {
    const planned = plan.files.find(
      ({ relativePath: candidate, action }) =>
        candidate === relativePath && action !== "delete",
    );
    if (planned !== undefined) continue;
    const target = await safeTarget(root, relativePath);
    const current = await readSafeRegularFile(target);
    if (
      current.content === null ||
      sha256(current.content) !== manifest.ownership.agentSha256[relativePath]
    ) {
      throw new Error(
        `Generated manifest ownership hash does not match unchanged agent: ${relativePath}`,
      );
    }
  }
}

async function validateAgentDeletes(
  root: string,
  plan: TeamPlan,
): Promise<void> {
  const deletedAgents = plan.files.filter(
    ({ relativePath, action }) =>
      action === "delete" && agentPathPattern.test(relativePath),
  );
  if (deletedAgents.length === 0) return;

  const nextManifestFile = plan.files.find(
    ({ relativePath, action }) =>
      relativePath === ".codex/codsemble/manifest.json" &&
      action !== "delete",
  );
  if (nextManifestFile?.content === null || nextManifestFile?.content === undefined) {
    throw new Error(
      "Deleting generated agents requires a strict manifest transition",
    );
  }
  const nextManifest = generatedManifestSchema.parse(
    JSON.parse(nextManifestFile.content),
  );
  const currentManifestPath = await safeTarget(
    root,
    ".codex/codsemble/manifest.json",
  );
  const currentManifestState = await readSafeRegularFile(currentManifestPath);
  if (currentManifestState.content === null) {
    throw new Error(
      "Deleting generated agents requires a current strict ownership manifest",
    );
  }
  let currentManifest: ReturnType<typeof generatedManifestSchema.parse>;
  try {
    currentManifest = generatedManifestSchema.parse(
      JSON.parse(
        decodeUtf8(
          currentManifestState.content,
          ".codex/codsemble/manifest.json",
        ),
      ),
    );
  } catch (error) {
    throw new Error(
      "Deleting generated agents requires a current strict ownership manifest",
      { cause: error },
    );
  }

  for (const file of deletedAgents) {
    if (
      !currentManifest.ownership.agentFiles.includes(file.relativePath) ||
      currentManifest.ownership.agentSha256[file.relativePath] !==
        file.beforeSha256
    ) {
      throw new Error(
        `Agent deletion is not proven by current manifest ownership: ${file.relativePath}`,
      );
    }
    if (
      nextManifest.ownership.agentFiles.includes(file.relativePath) ||
      file.relativePath in nextManifest.ownership.agentSha256
    ) {
      throw new Error(
        `Deleted agent remains owned by the next manifest: ${file.relativePath}`,
      );
    }
  }
}

export function assertValidTransactionRecord(
  record: unknown,
): asserts record is TransactionRecord {
  const parsed = transactionRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new Error(`Invalid transaction record: ${parsed.error.message}`);
  }
  const paths = new Set<string>();
  for (const file of parsed.data.files) {
    if (
      !isCodsembleOwnedOutput(file.relativePath) ||
      paths.has(file.relativePath)
    ) {
      throw new Error("Invalid transaction file record");
    }
    const expectedBackup =
      file.beforeSha256 === null
        ? null
        : `${transactionRoot}/${parsed.data.transactionId}.backups/${file.relativePath}`;
    if (file.backupRelativePath !== expectedBackup) {
      throw new Error("Transaction backup path is outside its scoped directory");
    }
    const expectedQuarantine =
      file.beforeSha256 === null
        ? null
        : `${transactionRoot}/${parsed.data.transactionId}.quarantines/${file.relativePath}`;
    if (file.quarantineRelativePath !== expectedQuarantine) {
      throw new Error("Transaction quarantine path is outside its scoped location");
    }
    paths.add(file.relativePath);
  }
}

export function assertValidRollbackMarker(
  marker: unknown,
): asserts marker is RollbackMarker {
  const parsed = rollbackMarkerSchema.safeParse(marker);
  if (!parsed.success) {
    throw new Error(`Invalid rollback marker: ${parsed.error.message}`);
  }
  const expectedPrefix =
    `${transactionRoot}/${parsed.data.transactionId}.rollback.quarantines/`;
  const paths = new Set<string>();
  for (const quarantineRelativePath of parsed.data.quarantineRelativePaths) {
    if (
      !quarantineRelativePath.startsWith(expectedPrefix) ||
      !isCodsembleOwnedOutput(
        quarantineRelativePath.slice(expectedPrefix.length),
      ) ||
      paths.has(quarantineRelativePath)
    ) {
      throw new Error("Invalid rollback quarantine path");
    }
    paths.add(quarantineRelativePath);
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
