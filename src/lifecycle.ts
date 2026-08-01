import { z } from "zod";

import type { TransactionRecord } from "./types.js";

export const TRANSACTION_ROOT = ".codex/codsemble/transactions";
export const AGENT_PATH_PATTERN =
  /^\.codex\/agents\/[a-z][a-z0-9-]{1,63}\.toml$/;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
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
  .superRefine((file, context) => {
    if (file.beforeSha256 === null && file.afterSha256 === null) {
      context.addIssue({
        code: "custom",
        message: "transaction file must have a preimage or postimage",
      });
    }
    if (
      file.beforeSha256 === null &&
      (file.backupRelativePath !== null ||
        file.quarantineRelativePath !== null ||
        file.mode !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "created transaction files cannot have recovery paths or a prior mode",
      });
    }
    if (
      file.beforeSha256 !== null &&
      (file.backupRelativePath === null ||
        file.quarantineRelativePath === null ||
        file.mode === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "existing transaction files require scoped recovery paths and a prior mode",
      });
    }
  });
const transactionRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    transactionId: transactionIdSchema,
    planId: z.string().regex(/^[a-f0-9]{24}$/),
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

export interface RollbackMarker {
  schemaVersion: 1;
  transactionId: string;
  rolledBackAt: string;
  quarantineRelativePaths: string[];
}

export interface ReceiptValidationOptions {
  fileName?: string;
}

export function assertValidTransactionRecord(
  record: unknown,
  options: ReceiptValidationOptions = {},
): asserts record is TransactionRecord {
  const parsed = transactionRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new Error(`Invalid transaction record: ${parsed.error.message}`);
  }
  if (
    options.fileName !== undefined &&
    options.fileName !== `${parsed.data.transactionId}.json`
  ) {
    throw new Error("transaction receipt filename does not match its id");
  }
  const paths = new Set<string>();
  for (const file of parsed.data.files) {
    if (
      !isCodesembleOwnedOutput(file.relativePath) ||
      paths.has(file.relativePath)
    ) {
      throw new Error("Invalid transaction file record");
    }
    const expectedBackup =
      file.beforeSha256 === null
        ? null
        : `${TRANSACTION_ROOT}/${parsed.data.transactionId}.backups/${file.relativePath}`;
    if (file.backupRelativePath !== expectedBackup) {
      throw new Error("Transaction backup path is outside its scoped directory");
    }
    const expectedQuarantine =
      file.beforeSha256 === null
        ? null
        : `${TRANSACTION_ROOT}/${parsed.data.transactionId}.quarantines/${file.relativePath}`;
    if (file.quarantineRelativePath !== expectedQuarantine) {
      throw new Error("Transaction quarantine path is outside its scoped location");
    }
    paths.add(file.relativePath);
  }
}

export function assertValidRollbackMarker(
  marker: unknown,
  options: { fileName?: string } = {},
): asserts marker is RollbackMarker {
  const parsed = rollbackMarkerSchema.safeParse(marker);
  if (!parsed.success) {
    throw new Error(`Invalid rollback marker: ${parsed.error.message}`);
  }
  if (
    options.fileName !== undefined &&
    options.fileName !== `${parsed.data.transactionId}.rollback.json`
  ) {
    throw new Error("rollback marker filename does not match its id");
  }
  const expectedPrefix =
    `${TRANSACTION_ROOT}/${parsed.data.transactionId}.rollback.quarantines/`;
  const paths = new Set<string>();
  for (const quarantineRelativePath of parsed.data.quarantineRelativePaths) {
    if (
      !quarantineRelativePath.startsWith(expectedPrefix) ||
      !isCodesembleOwnedOutput(
        quarantineRelativePath.slice(expectedPrefix.length),
      ) ||
      paths.has(quarantineRelativePath)
    ) {
      throw new Error("Invalid rollback quarantine path");
    }
    paths.add(quarantineRelativePath);
  }
}

export function receiptBindsManifest(
  receipt: TransactionRecord,
  binding: { planId: string; manifestSha256: string },
): boolean {
  return (
    receipt.planId === binding.planId &&
    receipt.files.filter(
      ({ relativePath, afterSha256 }) =>
        relativePath === ".codex/codsemble/manifest.json" &&
        afterSha256 === binding.manifestSha256,
    ).length === 1
  );
}

export function isCodesembleOwnedOutput(relativePath: string): boolean {
  return (
    relativePath === "AGENTS.md" ||
    relativePath === ".codex/config.toml" ||
    relativePath === ".codex/codsemble/manifest.json" ||
    AGENT_PATH_PATTERN.test(relativePath)
  );
}
