import { describe, expect, it } from "vitest";

import {
  assertValidTransactionRecord,
  receiptBindsManifest,
} from "../src/lifecycle.js";
import type { TransactionRecord } from "../src/types.js";

const digest = "a".repeat(64);

function receipt(): TransactionRecord {
  return {
    schemaVersion: 1,
    transactionId: "tx-1",
    planId: "b".repeat(24),
    createdAt: "2026-08-01T12:00:00.000Z",
    files: [
      {
        relativePath: ".codex/codsemble/manifest.json",
        beforeSha256: null,
        afterSha256: digest,
        backupRelativePath: null,
        quarantineRelativePath: null,
        mode: null,
      },
    ],
  };
}

describe("strict lifecycle records", () => {
  it("binds the filename, plan, and exact manifest postimage", () => {
    const current = receipt();
    expect(() =>
      assertValidTransactionRecord(current, { fileName: "tx-1.json" }),
    ).not.toThrow();
    expect(
      receiptBindsManifest(current, {
        planId: "b".repeat(24),
        manifestSha256: digest,
      }),
    ).toBe(true);
    expect(
      receiptBindsManifest(current, {
        planId: "c".repeat(24),
        manifestSha256: digest,
      }),
    ).toBe(false);
    expect(() =>
      assertValidTransactionRecord(current, { fileName: "other.json" }),
    ).toThrow("filename does not match");
  });

  it("rejects shallow, unknown-field, duplicate, and unsafe receipts", () => {
    expect(() =>
      assertValidTransactionRecord({
        schemaVersion: 1,
        planId: "b".repeat(24),
        files: [{ relativePath: ".codex/codsemble/manifest.json", afterSha256: digest }],
      }),
    ).toThrow("Invalid transaction record");
    expect(() =>
      assertValidTransactionRecord({ ...receipt(), unexpected: true }),
    ).toThrow("Invalid transaction record");
    const duplicate = receipt();
    duplicate.files.push({ ...duplicate.files[0]! });
    expect(() => assertValidTransactionRecord(duplicate)).toThrow(
      "Invalid transaction file record",
    );
    const unsafe = receipt();
    unsafe.files[0] = { ...unsafe.files[0]!, relativePath: "README.md" };
    expect(() => assertValidTransactionRecord(unsafe)).toThrow(
      "Invalid transaction file record",
    );
  });

  it("enforces recovery-path and prior-mode relationships", () => {
    const createdWithMode = receipt();
    createdWithMode.files[0] = { ...createdWithMode.files[0]!, mode: 0o600 };
    expect(() => assertValidTransactionRecord(createdWithMode)).toThrow(
      "Invalid transaction record",
    );

    const updated = receipt();
    updated.files[0] = {
      ...updated.files[0]!,
      beforeSha256: "c".repeat(64),
      backupRelativePath:
        ".codex/codsemble/transactions/tx-1.backups/.codex/codsemble/manifest.json",
      quarantineRelativePath:
        ".codex/codsemble/transactions/tx-1.quarantines/.codex/codsemble/manifest.json",
      mode: 0o600,
    };
    expect(() => assertValidTransactionRecord(updated)).not.toThrow();
    updated.files[0]!.backupRelativePath =
      ".codex/codsemble/transactions/other.backups/.codex/codsemble/manifest.json";
    expect(() => assertValidTransactionRecord(updated)).toThrow(
      "backup path is outside",
    );
  });
});
