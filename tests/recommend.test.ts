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
    prohibitedActions: [],
    requiredRoles: [],
    excludedRoles: [],
    customRoles: [],
    verifiedModels: {},
    allowHighConcurrency: false,
    ...overrides,
  };
}

describe("recommendTeams", () => {
  it("loads the validated offline catalog", async () => {
    const catalog = await loadCatalog();
    expect(catalog).toHaveLength(111);
    expect(new Set(catalog.map(({ id }) => id)).size).toBe(111);

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
    expect(proposal?.roles.map(({ roleId }) => roleId)).toContain(
      "frontend-engineer",
    );
  });

  it("produces deterministic lean, balanced, and full evidence-backed teams", () => {
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
      "lean",
      "balanced",
      "full",
    ]);
    expect(first.proposals.map(({ roles: selected }) => selected.length)).toEqual([
      2, 3, 5,
    ]);
    expect(first.proposals[0]?.roles[0]?.reasons.join(" ")).toContain(
      'User goal "quality"',
    );
    expect(
      first.proposals[0]?.roles
        .find(({ roleId }) => roleId === "typescript")
        ?.reasons.join(" "),
    ).toContain("package.json");
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
    }
  });

  it("penalizes conflicting ownership and rejects contradictory input", () => {
    const conflictingRoles = [
      role("alpha", { conflicts: ["beta"], goalTags: ["quality"] }),
      role("beta", { conflicts: ["alpha"], goalTags: ["quality"] }),
      role("gamma", { goalTags: ["quality"] }),
    ];
    const proposal = recommendTeams(
      audit,
      answers({ desiredRoleCount: 2 }),
      conflictingRoles,
    ).proposals[1];

    expect(proposal?.roles.map(({ roleId }) => roleId)).toEqual([
      "alpha",
      "gamma",
    ]);
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
