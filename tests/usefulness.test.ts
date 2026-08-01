import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { compileProjectTeamDesign } from "../src/capability-compiler.js";
import { loadCatalog } from "../src/catalog.js";
import type {
  AuditReport,
  IntakeAnswers,
  RoleBlueprint,
} from "../src/types.js";

interface Fixture {
  id: string;
  goals: string[];
  stage: IntakeAnswers["projectStage"];
  signals: Array<[string, string, string, string]>;
}

const fixtures = JSON.parse(
  await readFile("tests/fixtures/pcc/projects.json", "utf8"),
) as Fixture[];

describe("bounded structural usefulness comparison", () => {
  it("uses fewer admitted roles than the compatibility library without losing coverage", async () => {
    const catalog = await loadCatalog();
    for (const fixtureId of [
      "docs-only-project",
      "polyglot-monorepo",
      "regulated-delivery",
    ]) {
      const design = compileFixture(fixtureId, catalog);
      const focused = design.proposals[0];
      if (!focused) throw new Error("focused proposal missing");
      expect(focused.uncoveredCapabilityIds).toEqual([]);
      expect(focused.roleIds.length).toBeLessThan(catalog.length);
      expect(focused.roleIds.length).toBeLessThanOrEqual(
        design.capabilityMap.capabilities.filter(({ required }) => required)
          .length,
      );
    }
  });

  it("keeps unit isolation where a single-primary baseline cannot", async () => {
    const catalog = await loadCatalog();
    const design = compileFixture("polyglot-monorepo", catalog);
    const packageById = new Map(
      design.workPackages.map((workPackage) => [workPackage.id, workPackage]),
    );
    const focused = design.proposals[0];
    if (!focused) throw new Error("focused proposal missing");
    const units = new Set(
      focused.workPackageIds.map((id) => packageById.get(id)?.unitId),
    );
    expect(units).toEqual(new Set(["apps/web", "services/api"]));
    for (const roleId of focused.roleIds) {
      const role = design.roles.find(({ id }) => id === roleId);
      expect(
        new Set(
          role?.workPackageIds.map((id) => packageById.get(id)?.unitId) ?? [],
        ).size,
      ).toBe(1);
    }
    expect(units.size).toBeGreaterThan(1);
  });

  it("adds a distinct validator only where the single-primary baseline cannot provide independence", async () => {
    const catalog = await loadCatalog();
    const design = compileFixture("regulated-delivery", catalog);
    const focused = design.proposals[0];
    const recommended = design.proposals[1];
    if (!focused || !recommended) throw new Error("proposal tiers missing");
    expect(recommended.roleIds.length).toBe(focused.roleIds.length + 1);
    const validator = design.roles.find(({ id }) =>
      recommended.roleIds.includes(id) && !focused.roleIds.includes(id),
    );
    expect(validator?.name).toContain("Independent Risk Validator");
    expect(validator?.sandbox).toBe("read-only");
  });
});

function compileFixture(fixtureId: string, catalog: RoleBlueprint[]) {
  const fixture = fixtures.find(({ id }) => id === fixtureId);
  if (!fixture) throw new Error(`fixture not found: ${fixtureId}`);
  const inspectedFiles = [...new Set(fixture.signals.map(([, , file]) => file))];
  const audit: AuditReport = {
    schemaVersion: 1,
    workspace: ".",
    workspaceName: fixture.id,
    gitRepository: true,
    dirtyWorktree: false,
    inspectedFiles,
    skipped: [],
    truncated: false,
    signals: fixture.signals.map(([key, value, file, detector]) => ({
      key,
      values: [value],
      confidence: "high" as const,
      evidence: [{ path: file, detector, detail: value }],
    })),
    existingCodex: {
      agentsMd: false,
      projectConfig: false,
      agentFiles: [],
      teamManifest: false,
    },
    warnings: [],
  };
  const answers: IntakeAnswers = {
    goals: fixture.goals,
    projectStage: fixture.stage,
    desiredRoleCount: 100,
    maxConcurrentWorkers: 4,
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
  return compileProjectTeamDesign(audit, answers, catalog);
}
