import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { compileProjectTeamDesign } from "../src/capability-compiler.js";
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

const primitive: RoleBlueprint = {
  id: "project-specialist",
  name: "Project specialist",
  family: "Architecture and Engineering",
  summary: "Owns a bounded project capability and its validation evidence.",
  jobToBeDone: "Deliver one bounded project capability with exact evidence.",
  useWhen: ["An explicit goal activates the capability."],
  avoidWhen: ["No explicit goal activates the capability."],
  responsibilities: ["Own the assigned Work Package."],
  deliverables: ["A verified bounded result."],
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
  qualityGates: ["Cite boundary-matched validation."],
  permissionProfile: "Read-only project analysis with no external writes.",
  externalWritePolicy: "confirm",
  costClass: "medium",
  maximumFanout: 0,
  catalogVersion: "0.1.0",
};

describe("Project Capability Compiler semantic goldens", () => {
  for (const fixtureId of ["polyglot-monorepo", "regulated-delivery"]) {
    it(fixtureId, async () => {
      const fixture = fixtures.find(({ id }) => id === fixtureId);
      if (!fixture) throw new Error(`fixture not found: ${fixtureId}`);
      const design = designForFixture(fixture);
      const projection = {
        scenario: fixture.id,
        designId: design.designId,
        auditFingerprint: design.auditFingerprint,
        capabilities: design.capabilityMap.capabilities.map((capability) => ({
          id: capability.id,
          unitId: capability.unitId,
          kind: capability.kind,
          required: capability.required,
          risk: capability.risk,
        })),
        workPackages: design.workPackages.map((workPackage) => ({
          id: workPackage.id,
          unitId: workPackage.unitId,
          capabilityIds: workPackage.capabilityIds,
          required: workPackage.required,
          risk: workPackage.risk,
          scopes: workPackage.scopes,
        })),
        roles: design.roles.map((role) => ({
          id: role.id,
          sandbox: role.sandbox,
          workPackageIds: role.workPackageIds,
          sourcePrimitives: role.sourcePrimitives,
        })),
        proposals: design.proposals.map((proposal) => ({
          kind: proposal.kind,
          roleIds: proposal.roleIds,
          workPackageIds: proposal.workPackageIds,
          coveredCapabilityIds: proposal.coveredCapabilityIds,
          uncoveredCapabilityIds: proposal.uncoveredCapabilityIds,
          maxConcurrentWorkers: proposal.maxConcurrentWorkers,
        })),
      };
      if (process.env.PRINT_PCC_GOLDEN === fixtureId) {
        console.log(JSON.stringify(projection, null, 2));
        return;
      }
      const expected = JSON.parse(
        await readFile(
          `tests/fixtures/pcc/${fixtureId}.golden.json`,
          "utf8",
        ),
      ) as unknown;
      expect(projection).toEqual(expected);
    });
  }
});

function designForFixture(fixture: Fixture) {
  const audit: AuditReport = {
    schemaVersion: 1,
    workspace: ".",
    workspaceName: fixture.id,
    gitRepository: true,
    dirtyWorktree: false,
    inspectedFiles: [...new Set(fixture.signals.map(([, , file]) => file))],
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
    desiredRoleCount: 20,
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
  return compileProjectTeamDesign(audit, answers, [primitive]);
}
