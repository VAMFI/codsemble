import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { compileProjectTeamDesign } from "../src/capability-compiler.js";
import type {
  AuditReport,
  IntakeAnswers,
  RoleBlueprint,
  TeamDesign,
} from "../src/types.js";

interface Fixture {
  id: string;
  goals: string[];
  stage: IntakeAnswers["projectStage"];
  signals: Array<[string, string, string, string]>;
  truncated?: boolean;
  warning?: string;
}

const fixtures = JSON.parse(
  await readFile("tests/fixtures/pcc/projects.json", "utf8"),
) as Fixture[];

describe("Project Capability Compiler properties", () => {
  it("is invariant across seeded audit, goal, and primitive permutations", () => {
    const fixture = requireFixture("polyglot-monorepo");
    const baseAudit = auditFor(fixture);
    const baseAnswers = answersFor(fixture);
    const primitives = Array.from({ length: 7 }, (_, index) =>
      primitive(`primitive-${String(index).padStart(2, "0")}`),
    );
    const baseline = compileProjectTeamDesign(
      baseAudit,
      baseAnswers,
      primitives,
    );

    for (let seed = 1; seed <= 64; seed += 1) {
      const random = seededRandom(seed);
      const shuffledAudit: AuditReport = {
        ...baseAudit,
        inspectedFiles: shuffle(baseAudit.inspectedFiles, random),
        inspectedFileDigests: shuffle(
          baseAudit.inspectedFileDigests ?? [],
          random,
        ),
        signals: shuffle(baseAudit.signals, random).map((signal) => ({
          ...signal,
          values: shuffle(signal.values, random),
          evidence: shuffle(signal.evidence, random),
        })),
      };
      const shuffledAnswers = {
        ...baseAnswers,
        goals: shuffle(baseAnswers.goals, random),
      };
      expect(
        compileProjectTeamDesign(
          shuffledAudit,
          shuffledAnswers,
          shuffle(primitives, random),
        ),
      ).toEqual(baseline);
    }
  });

  it("maintains coverage, minimality, tier, identity, and atomicity invariants", () => {
    for (const fixture of fixtures) {
      assertDesignInvariants(
        compileProjectTeamDesign(
          auditFor(fixture),
          answersFor(fixture),
          [primitive("primitive-00")],
        ),
      );
    }
  });

  it("accepts arbitrary non-empty primitive-library sizes without sizing the team", () => {
    const fixture = requireFixture("next-supabase");
    const report = auditFor(fixture);
    const answers = answersFor(fixture);
    const results = [1, 2, 17].map((count) =>
      compileProjectTeamDesign(
        report,
        answers,
        Array.from({ length: count }, (_, index) =>
          primitive(`primitive-${String(index).padStart(2, "0")}`),
        ),
      ),
    );
    expect(results.map(({ proposals }) => proposals[0]?.roleIds.length))
      .toEqual([3, 3, 3]);
    expect(
      results.map(({ proposals }) =>
        proposals.map(({ maxConcurrentWorkers }) => maxConcurrentWorkers),
      ),
    ).toEqual([
      [4, 4, 4],
      [4, 4, 4],
      [4, 4, 4],
    ]);
  });
});

function assertDesignInvariants(design: TeamDesign): void {
  const capabilityIds = design.capabilityMap.capabilities.map(({ id }) => id);
  const evidenceIds = design.capabilityMap.evidence.map(({ id }) => id);
  const workPackageIds = design.workPackages.map(({ id }) => id);
  const roleIds = design.roles.map(({ id }) => id);
  expect(new Set(capabilityIds).size).toBe(capabilityIds.length);
  expect(new Set(evidenceIds).size).toBe(evidenceIds.length);
  expect(new Set(workPackageIds).size).toBe(workPackageIds.length);
  expect(new Set(roleIds).size).toBe(roleIds.length);
  expect(
    design.capabilityMap.evidence.every(
      ({ relativePaths }) => relativePaths.length <= 1,
    ),
  ).toBe(true);

  const focused = design.proposals[0];
  const recommended = design.proposals[1];
  const extended = design.proposals[2];
  if (!focused || !recommended || !extended) {
    throw new Error("three proposal tiers are required");
  }
  expect(new Set(recommended.roleIds)).toEqual(
    new Set([...focused.roleIds, ...recommended.roleIds]),
  );
  expect(new Set(extended.roleIds)).toEqual(
    new Set([...recommended.roleIds, ...extended.roleIds]),
  );
  expect(focused.uncoveredCapabilityIds).toEqual([]);

  const packageById = new Map(
    design.workPackages.map((workPackage) => [workPackage.id, workPackage]),
  );
  const focusedRoles = focused.roleIds.map((id) => {
    const role = design.roles.find(({ id: candidate }) => candidate === id);
    if (!role) throw new Error(`focused role missing: ${id}`);
    return role;
  });
  for (const capability of design.capabilityMap.capabilities.filter(
    ({ required }) => required,
  )) {
    const owners = focusedRoles.filter(({ workPackageIds: owned }) =>
      owned.some((id) =>
        packageById.get(id)?.capabilityIds.includes(capability.id),
      ),
    );
    expect(owners).toHaveLength(1);
  }
  for (const removed of focusedRoles) {
    const remainingCoverage = new Set(
      focusedRoles
        .filter(({ id }) => id !== removed.id)
        .flatMap(({ workPackageIds: owned }) =>
          owned.flatMap((id) => packageById.get(id)?.capabilityIds ?? []),
        ),
    );
    expect(
      design.capabilityMap.capabilities
        .filter(({ required }) => required)
        .some(({ id }) => !remainingCoverage.has(id)),
    ).toBe(true);
  }
}

function auditFor(fixture: Fixture): AuditReport {
  const inspectedFiles = [...new Set(fixture.signals.map(([, , file]) => file))];
  return {
    schemaVersion: 1,
    workspace: ".",
    workspaceName: fixture.id,
    gitRepository: true,
    dirtyWorktree: false,
    inspectedFiles,
    inspectedFileDigests: inspectedFiles.map((file, index) => ({
      path: file,
      sha256: index.toString(16).padStart(64, "0"),
    })),
    skipped: [],
    truncated: fixture.truncated ?? false,
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
    warnings: fixture.warning ? [fixture.warning] : [],
  };
}

function answersFor(fixture: Fixture): IntakeAnswers {
  return {
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
}

function primitive(id: string): RoleBlueprint {
  return {
    id,
    name: "Project specialist",
    family: "Architecture and Engineering",
    summary: "Owns a bounded project capability.",
    jobToBeDone: "Deliver a bounded capability.",
    useWhen: ["An explicit goal activates work."],
    avoidWhen: ["No goal activates work."],
    responsibilities: ["Own a Work Package."],
    deliverables: ["A verified result."],
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
    permissionProfile: "Read-only.",
    externalWritePolicy: "confirm",
    costClass: "medium",
    maximumFanout: 0,
    catalogVersion: "0.1.0",
  };
}

function requireFixture(id: string): Fixture {
  const fixture = fixtures.find(({ id: candidate }) => candidate === id);
  if (!fixture) throw new Error(`fixture not found: ${id}`);
  return fixture;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [
      result[other] as T,
      result[index] as T,
    ];
  }
  return result;
}
