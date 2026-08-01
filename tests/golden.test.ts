import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadCatalog } from "../src/catalog.js";
import { compileTeamPlan } from "../src/compiler.js";
import { recommendTeams } from "../src/recommend.js";
import { intakeAnswersSchema } from "../src/schemas.js";
import type { AuditReport, IntakeAnswers } from "../src/types.js";

const audit: AuditReport = {
  schemaVersion: 1,
  workspace: ".",
  workspaceName: "golden-empty-project",
  gitRepository: false,
  dirtyWorktree: null,
  inspectedFiles: [],
  skipped: [],
  truncated: false,
  signals: [],
  existingCodex: {
    agentsMd: false,
    projectConfig: false,
    agentFiles: [],
    teamManifest: false,
  },
  warnings: [],
};

describe("generated team golden", () => {
  it("keeps the semantic focused team design stable and plan-bound", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "codsemble-golden-"));
    const answers = intakeAnswersSchema.parse(
      JSON.parse(await readFile("examples/intake.preview.json", "utf8")),
    ) as IntakeAnswers;
    const catalog = await loadCatalog();
    const recommendation = recommendTeams(audit, answers, catalog);
    const focused = recommendation.proposals.find(({ kind }) => kind === "focused");
    if (!focused || !recommendation.teamDesign) {
      throw new Error("focused team design missing");
    }

    const plan = await compileTeamPlan(
      workspace,
      audit,
      answers,
      focused,
      catalog,
      {},
      recommendation.teamDesign,
    );
    expect(recommendation.teamDesign.capabilityMap.capabilities
      .filter(({ required }) => required)
      .map(({ kind }) => kind)).toEqual([
      "implementation",
      "implementation",
      "verification",
    ]);
    expect(recommendation.teamDesign.proposals[0]?.uncoveredCapabilityIds).toEqual([]);
    expect(plan.roles.every(({ source }) => source === "generated")).toBe(true);
    expect(plan.teamDesignId).toBe(recommendation.teamDesign.designId);
    expect(plan.teamDesignDigest).toMatch(/^[a-f0-9]{64}$/);
    const manifest = JSON.parse(
      plan.files.find(({ relativePath }) =>
        relativePath === ".codex/codsemble/manifest.json")?.content ?? "{}",
    ) as { schemaVersion?: number; design?: { designId?: string; digest?: string } };
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.design?.designId).toBe(plan.teamDesignId);
    expect(manifest.design?.digest).toBe(plan.teamDesignDigest);
  });
});
