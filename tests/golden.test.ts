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
  it("keeps the lean empty-project team and owned output hashes stable", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "codsemble-golden-"));
    const answers = intakeAnswersSchema.parse(
      JSON.parse(await readFile("examples/intake.preview.json", "utf8")),
    ) as IntakeAnswers;
    const catalog = await loadCatalog();
    const recommendation = recommendTeams(audit, answers, catalog);
    const lean = recommendation.proposals.find(({ kind }) => kind === "lean");
    if (!lean) throw new Error("lean proposal missing");

    const plan = await compileTeamPlan(
      workspace,
      audit,
      answers,
      lean,
      catalog,
      {},
    );
    const hashes = Object.fromEntries(
      plan.files
        .filter(
          ({ relativePath }) =>
            relativePath !== ".codex/codsemble/manifest.json",
        )
        .map(({ relativePath, afterSha256 }) => [relativePath, afterSha256]),
    );

    expect(plan.roles.map(({ id }) => id)).toEqual([
      "delivery-planner",
      "end-to-end-test-engineer",
    ]);
    expect(hashes).toEqual({
      ".codex/agents/delivery-planner.toml":
        "cccaae61ddd6dab3890baafe0b071831ebae9818a10c1cb827ab2772c4c87bf5",
      ".codex/agents/end-to-end-test-engineer.toml":
        "1888af36587dac3dade90ce463b269c4fb0432899f226dfe0017d518a0a9b59d",
      ".codex/config.toml":
        "94df6d9753a820e91b6795b30d77be256a0cf849d789b1f0313c07d27439440f",
      "AGENTS.md":
        "9ca0bc8f30b14ee17101569a1be9439a1e7b2e915bf4c34815e195749aa2affa",
    });
  });
});
