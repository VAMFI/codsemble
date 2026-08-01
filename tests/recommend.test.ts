import { describe, expect, it } from "vitest";

import { loadCatalog } from "../src/catalog.js";
import { recommendTeams } from "../src/recommend.js";
import type {
  AuditReport,
  IntakeAnswers,
  RoleBlueprint,
} from "../src/types.js";

function role(
  id: string,
  overrides: Partial<RoleBlueprint> = {},
): RoleBlueprint {
  return {
    id,
    name: id.replaceAll("-", " "),
    family: "Engineering",
    summary: `The ${id} specialist owns a bounded engineering concern.`,
    jobToBeDone: `Own the bounded ${id} workflow and report evidence.`,
    useWhen: ["The repository has matching work."],
    avoidWhen: ["No matching work exists."],
    responsibilities: [`Own ${id} decisions and implementation evidence.`],
    deliverables: [`A verified ${id} result.`],
    repoSignals: [],
    goalTags: [],
    defaultModelProfile: "balanced",
    defaultReasoningEffort: "medium",
    defaultSandbox: "read-only",
    requiredTools: [],
    optionalTools: [],
    dependencies: [],
    conflicts: [],
    handoffs: [],
    qualityGates: ["Cite verification evidence."],
    permissionProfile: "read-only",
    externalWritePolicy: "forbidden",
    costClass: "medium",
    maximumFanout: 0,
    catalogVersion: "1.0.0",
    ...overrides,
  };
}

const audit: AuditReport = {
  schemaVersion: 1,
  workspace: ".",
  workspaceName: "fixture",
  gitRepository: true,
  dirtyWorktree: false,
  inspectedFiles: ["package.json"],
  skipped: [],
  truncated: false,
  signals: [
    {
      key: "language",
      values: ["typescript"],
      confidence: "high",
      evidence: [
        {
          path: "package.json",
          detector: "manifest",
          detail: "TypeScript dependency detected",
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

function answers(
  overrides: Partial<IntakeAnswers> = {},
): IntakeAnswers {
  return {
    goals: ["quality"],
    projectStage: "active",
    desiredRoleCount: 3,
    maxConcurrentWorkers: 2,
    optimizeFor: "balanced",
    configMode: "preview",
    configAdapter: "agents-v1",
    prohibitedActions: [],
    requiredRoles: [],
    excludedRoles: [],
    customRoles: [],
    availableTools: ["workspace-read"],
    modelCapabilities: [],
    verifiedModels: {},
    allowHighConcurrency: false,
    ...overrides,
  };
}

describe("recommendTeams", () => {
  it("uses the offline catalog as primitives while generating a project role", async () => {
    const catalog = await loadCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    expect(new Set(catalog.map(({ id }) => id)).size).toBe(catalog.length);

    const frameworkAudit: AuditReport = {
      ...audit,
      signals: [
        {
          key: "framework",
          values: ["react"],
          confidence: "high",
          evidence: [
            {
              path: "package.json",
              detector: "package-dependency",
              detail: "react",
            },
          ],
        },
      ],
    };
    const proposal = recommendTeams(
      frameworkAudit,
      answers({ desiredRoleCount: 2, goals: ["frontend"] }),
      catalog,
    ).proposals[0];
    expect(proposal?.kind).toBe("focused");
    expect(proposal?.roles).toHaveLength(1);
    expect(proposal?.roles[0]?.roleId).toMatch(/react-implementation-specialist/);
    const result = recommendTeams(
      frameworkAudit,
      answers({ desiredRoleCount: 2, goals: ["frontend"] }),
      catalog,
    );
    const generated = result.teamDesign?.roles[0];
    expect(generated?.sourcePrimitives).toContain("frontend-engineer");
    expect(generated?.evidenceRefs.length).toBeGreaterThan(1);
  });

  it("produces deterministic focused, recommended, and extended coverage teams", () => {
    const roles = [
      role("docs"),
      role("typescript", {
        repoSignals: ["language:typescript"],
      }),
      role("quality", { goalTags: ["quality"] }),
      role("release"),
      role("security"),
      role("support"),
    ];

    const first = recommendTeams(audit, answers(), roles);
    const second = recommendTeams(audit, answers(), [...roles].reverse());

    expect(first).toEqual(second);
    expect(first.proposals.map(({ kind }) => kind)).toEqual([
      "focused",
      "recommended",
      "extended",
    ]);
    expect(first.proposals.map(({ roles: selected }) => selected.length)).toEqual([
      1, 1, 1,
    ]);
    expect(first.proposals[0]?.roles[0]?.reasons.join(" ")).toContain(
      "Bound to evidence references",
    );
    expect(first.teamDesign?.capabilityMap.capabilities.some(
      ({ kind, required }) => kind === "verification" && required,
    )).toBe(true);
    expect(first.teamDesign?.roles[0]?.workPackageIds.length).toBeGreaterThan(0);
    expect(
      first.proposals.every(
        (proposal) => proposal.maxConcurrentWorkers === 2,
      ),
    ).toBe(true);
  });

  it("honors required, excluded, and custom roles", () => {
    const result = recommendTeams(
      audit,
      answers({
        desiredRoleCount: 2,
        requiredRoles: ["security"],
        excludedRoles: ["quality"],
        customRoles: [
          {
            id: "domain-expert",
            name: "Domain expert",
            jobToBeDone: "Validate domain-specific behavior and terminology.",
            successCriteria: ["Domain rules are documented."],
            allowedPaths: [],
            prohibitedActions: ["Do not publish."],
            modelProfile: "inherit",
            reasoningEffort: "inherit",
            sandbox: "read-only",
          },
        ],
      }),
      [role("quality"), role("security"), role("typescript")],
    );

    for (const proposal of result.proposals) {
      expect(proposal.roles.map(({ roleId }) => roleId)).toContain("security");
      expect(proposal.roles.map(({ roleId }) => roleId)).toContain(
        "domain-expert",
      );
      expect(proposal.roles.map(({ roleId }) => roleId)).not.toContain(
        "quality",
      );
      expect(proposal.rationale).toContain(
        "Explicit user-selected roles: 2.",
      );
      expect(proposal.rationale).toContain(
        `Total proposed roles: ${proposal.roles.length}.`,
      );
    }
  });

  it("does not add filler roles and rejects contradictory input", () => {
    const conflictingRoles = [
      role("alpha", { conflicts: ["beta"], goalTags: ["quality"] }),
      role("beta", { conflicts: ["alpha"], goalTags: ["quality"] }),
      role("gamma", { goalTags: ["quality"] }),
    ];
    const result = recommendTeams(
      audit,
      answers({ desiredRoleCount: 20 }),
      conflictingRoles,
    );

    expect(result.proposals.every(({ roles }) => roles.length === 1)).toBe(true);
    expect(result.proposals.flatMap(({ roles }) => roles.map(({ roleId }) => roleId)))
      .not.toContain("alpha");
    expect(() =>
      recommendTeams(
        audit,
        answers({
          requiredRoles: ["alpha"],
          excludedRoles: ["alpha"],
        }),
        conflictingRoles,
      ),
    ).toThrow(/both required and excluded/);
  });
});
