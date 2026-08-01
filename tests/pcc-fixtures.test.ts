import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { compileProjectTeamDesign } from "../src/capability-compiler.js";
import type {
  AuditReport,
  CapabilityKind,
  IntakeAnswers,
  RoleBlueprint,
} from "../src/types.js";

interface Fixture {
  id: string;
  goals: string[];
  stage: IntakeAnswers["projectStage"];
  signals: Array<[string, string, string, string]>;
  requiredKinds: CapabilityKind[];
  focusedRoles: number;
  recommendedRoles: number;
  forbiddenRoleTerms: string[];
  truncated?: boolean;
  existingManagedTeam?: boolean;
  warning?: string;
  requiredUnitIds?: string[];
  expectedGapTerms?: string[];
  forbiddenGeneratedText?: string[];
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

describe("representative Project Capability Compiler fixtures", () => {
  for (const fixture of fixtures) {
    it(fixture.id, () => {
      const inspectedFiles = [...new Set(fixture.signals.map(([, , file]) => file))];
      const audit: AuditReport = {
        schemaVersion: 1,
        workspace: ".",
        workspaceName: fixture.id,
        gitRepository: true,
        dirtyWorktree: false,
        inspectedFiles,
        skipped: [],
        truncated: fixture.truncated ?? false,
        signals: fixture.signals.map(([key, value, file, detector]) => ({
          key,
          values: [value],
          confidence: "high" as const,
          evidence: [{ path: file, detector, detail: value }],
        })),
        existingCodex: {
          agentsMd: fixture.existingManagedTeam ?? false,
          projectConfig: fixture.existingManagedTeam ?? false,
          agentFiles: fixture.existingManagedTeam
            ? [".codex/agents/existing.toml"]
            : [],
          teamManifest: fixture.existingManagedTeam ?? false,
        },
        warnings: fixture.warning ? [fixture.warning] : [],
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
      const design = compileProjectTeamDesign(audit, answers, [primitive]);
      const requiredKinds = [
        ...new Set(
          design.capabilityMap.capabilities
            .filter(({ required }) => required)
            .map(({ kind }) => kind),
        ),
      ].sort();

      expect(requiredKinds).toEqual([...fixture.requiredKinds].sort());
      expect(design.proposals[0]?.roleIds).toHaveLength(fixture.focusedRoles);
      expect(design.proposals[1]?.roleIds).toHaveLength(fixture.recommendedRoles);
      expect(design.proposals[0]?.uncoveredCapabilityIds).toEqual([]);
      if (fixture.requiredUnitIds) {
        expect(
          [...new Set(
            design.capabilityMap.capabilities
              .filter(({ required }) => required)
              .map(({ unitId }) => unitId),
          )].sort(),
        ).toEqual([...fixture.requiredUnitIds].sort());
      }
      for (const term of fixture.expectedGapTerms ?? []) {
        expect(design.capabilityMap.gaps.join(" ").toLowerCase())
          .toContain(term.toLowerCase());
      }
      const names = design.roles.map(({ name }) => name).join(" ").toLowerCase();
      for (const term of fixture.forbiddenRoleTerms) {
        expect(names).not.toContain(term.toLowerCase());
      }
      const generatedControlText = JSON.stringify(design.roles);
      for (const term of fixture.forbiddenGeneratedText ?? []) {
        expect(generatedControlText).not.toContain(term);
      }
    });
  }
});
