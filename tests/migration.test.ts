import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileProjectTeamDesign } from "../src/capability-compiler.js";
import { compileTeamPlan } from "../src/compiler.js";
import { doctorWorkspace } from "../src/doctor.js";
import { applyTeamPlan, rollbackTransaction } from "../src/transaction.js";
import type {
  AuditReport,
  IntakeAnswers,
  RoleBlueprint,
  TeamProposal,
} from "../src/types.js";

const audit: AuditReport = {
  schemaVersion: 1,
  workspace: ".",
  workspaceName: "migration-fixture",
  gitRepository: true,
  dirtyWorktree: false,
  inspectedFiles: ["package.json"],
  inspectedFileDigests: [
    { path: "package.json", sha256: "a".repeat(64) },
  ],
  skipped: [],
  truncated: false,
  signals: [
    {
      key: "stack",
      values: ["typescript"],
      confidence: "high",
      evidence: [
        {
          path: "package.json",
          detector: "manifest-path",
          detail: "typescript",
        },
      ],
    },
  ],
  existingCodex: {
    agentsMd: false,
    projectConfig: false,
    agentFiles: [],
    teamManifest: false,
  },
  warnings: [],
};

const primitive: RoleBlueprint = {
  id: "planner",
  name: "Planner",
  family: "Orchestration",
  summary: "Plans a bounded project change.",
  jobToBeDone: "Turn the goal into bounded, verifiable work.",
  useWhen: ["A project needs a plan."],
  avoidWhen: ["No goal is confirmed."],
  responsibilities: ["Plan the bounded work."],
  deliverables: ["A verification-bound plan."],
  repoSignals: ["signal:typescript"],
  goalTags: ["engineering"],
  defaultModelProfile: "balanced",
  defaultReasoningEffort: "medium",
  defaultSandbox: "read-only",
  requiredTools: ["workspace-read"],
  optionalTools: [],
  dependencies: [],
  conflicts: [],
  handoffs: [],
  qualityGates: ["Report exact evidence."],
  permissionProfile: "Read-only project analysis.",
  externalWritePolicy: "forbidden",
  costClass: "medium",
  maximumFanout: 0,
  catalogVersion: "0.1.0",
};

function answers(): IntakeAnswers {
  return {
    goals: ["engineering"],
    projectStage: "legacy",
    desiredRoleCount: 1,
    maxConcurrentWorkers: 2,
    optimizeFor: "balanced",
    configMode: "unchanged",
    configAdapter: null,
    prohibitedActions: [],
    requiredRoles: [],
    excludedRoles: [],
    customRoles: [],
    availableTools: ["workspace-read"],
    modelCapabilities: [],
    verifiedModels: {},
    allowHighConcurrency: false,
  };
}

describe("v0.1 to v0.2 lifecycle migration", () => {
  it("updates a receipted v1 team to v2, converges, and restores exact v1 bytes", async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), "codsemble-migration-"),
    );
    const inputAnswers = answers();
    const legacyProposal: TeamProposal = {
      kind: "balanced",
      roles: [
        { roleId: primitive.id, score: 1, reasons: ["fixture"], warnings: [] },
      ],
      maxConcurrentWorkers: inputAnswers.maxConcurrentWorkers,
      rationale: "Legacy v0.1 fixture.",
    };
    const legacyPlan = await compileTeamPlan(
      workspace,
      audit,
      inputAnswers,
      legacyProposal,
      [primitive],
    );
    await applyTeamPlan(workspace, legacyPlan);

    const legacyPaths = [
      "AGENTS.md",
      ".codex/agents/planner.toml",
      ".codex/codsemble/manifest.json",
    ];
    const legacyBytes = new Map(
      await Promise.all(
        legacyPaths.map(async (relativePath) => [
          relativePath,
          await readFile(path.join(workspace, relativePath), "utf8"),
        ] as const),
      ),
    );
    expect(
      JSON.parse(legacyBytes.get(".codex/codsemble/manifest.json") ?? "{}")
        .schemaVersion,
    ).toBe(1);

    const design = compileProjectTeamDesign(audit, inputAnswers, [primitive]);
    const focused = design.proposals.find(({ kind }) => kind === "focused");
    if (!focused) throw new Error("focused migration proposal missing");
    const v2Proposal: TeamProposal = {
      kind: "focused",
      roles: focused.roleIds.map((roleId) => ({
        roleId,
        score: 1,
        reasons: ["capability-coverage"],
        warnings: [],
      })),
      maxConcurrentWorkers: inputAnswers.maxConcurrentWorkers,
      rationale: focused.rationale,
      teamDesignId: design.designId,
      coveredCapabilityIds: focused.coveredCapabilityIds,
      uncoveredCapabilityIds: focused.uncoveredCapabilityIds,
    };
    const v2Plan = await compileTeamPlan(
      workspace,
      audit,
      inputAnswers,
      v2Proposal,
      [primitive],
      undefined,
      design,
    );
    expect(v2Plan.files).toContainEqual(
      expect.objectContaining({
        relativePath: ".codex/agents/planner.toml",
        action: "delete",
      }),
    );
    const v2Transaction = await applyTeamPlan(workspace, v2Plan);

    const v2Manifest = JSON.parse(
      await readFile(
        path.join(workspace, ".codex/codsemble/manifest.json"),
        "utf8",
      ),
    ) as { schemaVersion: number; design?: { designId?: string } };
    expect(v2Manifest.schemaVersion).toBe(2);
    expect(v2Manifest.design?.designId).toBe(design.designId);
    expect(
      (await doctorWorkspace(workspace)).checks.find(
        ({ id }) => id === "codsemble-manifest",
      )?.status,
    ).toBe("pass");

    const converged = await compileTeamPlan(
      workspace,
      audit,
      inputAnswers,
      v2Proposal,
      [primitive],
      undefined,
      design,
    );
    expect(converged.planId).toBe(v2Plan.planId);
    expect(converged.files.every(({ action }) => action === "verify")).toBe(true);

    await rollbackTransaction(workspace, v2Transaction.transactionId);
    for (const relativePath of legacyPaths) {
      expect(await readFile(path.join(workspace, relativePath), "utf8")).toBe(
        legacyBytes.get(relativePath),
      );
    }
  });
});
