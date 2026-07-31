import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";

import { compileTeamPlan } from "../src/compiler.js";
import type {
  AuditReport,
  IntakeAnswers,
  RoleBlueprint,
  TeamProposal,
} from "../src/types.js";

const audit: AuditReport = {
  schemaVersion: 1,
  workspace: ".",
  workspaceName: "fixture",
  gitRepository: true,
  dirtyWorktree: false,
  inspectedFiles: [],
  skipped: [],
  truncated: false,
  signals: [],
  existingCodex: {
    agentsMd: true,
    projectConfig: false,
    agentFiles: [],
    teamManifest: false,
  },
  warnings: [],
};

const blueprint: RoleBlueprint = {
  id: "planner",
  name: "Planner",
  family: "Orchestration",
  summary: "Plans bounded work and records clear verification contracts.",
  jobToBeDone: "Turn goals into bounded tasks with explicit evidence gates.",
  useWhen: ["The work has multiple dependent stages."],
  avoidWhen: ["The task is trivial."],
  responsibilities: ["Create a staged plan."],
  deliverables: ["A bounded implementation plan."],
  repoSignals: [],
  goalTags: ["planning"],
  defaultModelProfile: "deep",
  defaultReasoningEffort: "high",
  defaultSandbox: "read-only",
  requiredTools: [],
  optionalTools: [],
  dependencies: [],
  conflicts: [],
  handoffs: [],
  qualityGates: ["Every claim has matching evidence."],
  permissionProfile: "read-only",
  externalWritePolicy: "forbidden",
  costClass: "high",
  maximumFanout: 4,
  catalogVersion: "1.0.0",
};

function answers(
  overrides: Partial<IntakeAnswers> = {},
): IntakeAnswers {
  return {
    goals: ["planning"],
    projectStage: "active",
    desiredRoleCount: 1,
    maxConcurrentWorkers: 3,
    optimizeFor: "quality",
    configMode: "preview",
    configAdapter: "agents-v1",
    prohibitedActions: ["Do not publish."],
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

const proposal: TeamProposal = {
  kind: "balanced",
  roles: [{ roleId: "planner", score: 40, reasons: ["goal"], warnings: [] }],
  maxConcurrentWorkers: 3,
  rationale: "A bounded team.",
};

describe("compileTeamPlan", () => {
  it("renders parseable safe TOML, preserves unmanaged AGENTS content, and writes nothing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-compiler-"));
    const existingAgents =
      "# User rules\n\nKeep this exact.\n\n<!-- codsemble:start -->\nold\n<!-- codsemble:end -->\n";
    const plan = await compileTeamPlan(
      root,
      audit,
      answers(),
      proposal,
      [blueprint],
      { "AGENTS.md": existingAgents },
    );

    const agentFile = plan.files.find(
      ({ relativePath }) => relativePath === ".codex/agents/planner.toml",
    );
    expect(agentFile).toBeDefined();
    expect(parseToml(agentFile?.content ?? "")).toMatchObject({
      name: "planner",
      sandbox_mode: "read-only",
    });
    expect(parseToml(agentFile?.content ?? "")).not.toHaveProperty("model");
    expect(parseToml(agentFile?.content ?? "")).not.toHaveProperty(
      "model_reasoning_effort",
    );

    const agentsFile = plan.files.find(
      ({ relativePath }) => relativePath === "AGENTS.md",
    );
    expect(agentsFile?.content).toContain("Keep this exact.");
    expect(agentsFile?.content?.match(/codsemble:start/g)).toHaveLength(1);
    expect(plan.concurrency.requestedWorkers).toBe(3);
    expect(plan.roles).toHaveLength(1);
    expect(plan.concurrency.warning).toContain("roles and concurrency");
  });

  it("pins only a model supplied through verifiedModels", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-model-"));
    const inherited = await compileTeamPlan(
      root,
      audit,
      answers(),
      proposal,
      [blueprint],
      {},
    );
    const pinned = await compileTeamPlan(
      root,
      audit,
      answers({
        modelCapabilities: [
          {
            id: "gpt-verified-deep",
            supportedReasoningEfforts: ["high"],
          },
        ],
        verifiedModels: { deep: "gpt-verified-deep" },
      }),
      proposal,
      [blueprint],
      {},
    );
    const inheritedRole = inherited.roles[0];
    const pinnedRole = pinned.roles[0];

    expect(inheritedRole).not.toHaveProperty("model");
    expect(pinnedRole?.model).toBe("gpt-verified-deep");
    expect(pinnedRole?.reasoningEffort).toBe("high");
  });

  it("rejects a model not present in the bounded capability result", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-model-reject-"));
    await expect(
      compileTeamPlan(
        root,
        audit,
        answers({ verifiedModels: { deep: "unverified-model" } }),
        proposal,
        [blueprint],
        {},
      ),
    ).rejects.toThrow("not present in the local capability probe");
  });

  it("rejects an unsupported model reasoning effort", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-effort-reject-"));
    await expect(
      compileTeamPlan(
        root,
        audit,
        answers({
          modelCapabilities: [
            {
              id: "gpt-low-only",
              supportedReasoningEfforts: ["low"],
            },
          ],
          verifiedModels: { deep: "gpt-low-only" },
        }),
        proposal,
        [blueprint],
        {},
      ),
    ).rejects.toThrow("does not report reasoning effort high");
  });

  it("uses a Codex-safe identifier as the native agent name", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-native-name-"));
    const hyphenated = { ...blueprint, id: "delivery-planner" };
    const hyphenatedProposal: TeamProposal = {
      ...proposal,
      roles: [
        {
          roleId: "delivery-planner",
          score: 40,
          reasons: ["goal"],
          warnings: [],
        },
      ],
    };
    const plan = await compileTeamPlan(
      root,
      audit,
      answers(),
      hyphenatedProposal,
      [hyphenated],
      {},
    );
    const agent = plan.files.find(
      ({ relativePath }) =>
        relativePath === ".codex/agents/delivery-planner.toml",
    );
    expect(parseToml(agent?.content ?? "")).toMatchObject({
      name: "delivery_planner",
    });
    expect(
      plan.files.find(({ relativePath }) => relativePath === "AGENTS.md")
        ?.content,
    ).toContain("spawn as `delivery_planner`");
  });

  it("emits a deterministic manifest with its plan id and a config preview", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-manifest-"));
    const first = await compileTeamPlan(
      root,
      audit,
      answers(),
      proposal,
      [blueprint],
      {},
    );
    const second = await compileTeamPlan(
      root,
      audit,
      answers(),
      proposal,
      [blueprint],
      {},
    );
    const manifestFile = first.files.find(
      ({ relativePath }) =>
        relativePath === ".codex/codsemble/manifest.json",
    );
    const manifest = JSON.parse(manifestFile?.content ?? "{}") as {
      planId: string;
      ownership: { agentFiles: string[] };
      proposal: { maxConcurrentWorkers: number };
    };

    expect(first).toEqual(second);
    expect(manifest.ownership.agentFiles).toEqual([
      ".codex/agents/planner.toml",
    ]);
    expect(manifest.proposal.maxConcurrentWorkers).toBe(3);
    expect(manifest.planId).toBe(first.planId);
    expect(first.files.map(({ relativePath }) => relativePath)).toContain(
      ".codex/config.toml",
    );
    const config = first.files.find(
      ({ relativePath }) => relativePath === ".codex/config.toml",
    );
    expect(parseToml(config?.content ?? "")).toMatchObject({
      agents: { max_concurrent_threads_per_session: 3 },
    });
  });

  it("updates a lower ceiling but never lowers a higher ceiling", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-cap-"));
    const lower = await compileTeamPlan(
      root,
      audit,
      answers(),
      proposal,
      [blueprint],
      {
        ".codex/config.toml":
          "[agents]\nmax_concurrent_threads_per_session = 1 # keep\n",
      },
    );
    const higher = await compileTeamPlan(
      root,
      audit,
      answers(),
      proposal,
      [blueprint],
      {
        ".codex/config.toml":
          "[agents]\nmax_concurrent_threads_per_session = 8 # keep\n",
      },
    );

    expect(
      lower.files.find(
        ({ relativePath }) => relativePath === ".codex/config.toml",
      )?.content,
    ).toContain("= 3 # keep");
    expect(
      higher.files.some(
        ({ relativePath }) => relativePath === ".codex/config.toml",
      ),
    ).toBe(false);
    expect(higher.concurrency.projectCurrentValue).toBe(8);
    expect(higher.concurrency.warning).toContain("will not be lowered");
  });

  it("leaves config unplanned in manual and unchanged modes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-manual-"));
    for (const configMode of ["manual", "unchanged"] as const) {
      const plan = await compileTeamPlan(
        root,
        audit,
        answers({ configMode }),
        proposal,
        [blueprint],
        {},
      );
      expect(
        plan.files.some(
          ({ relativePath }) => relativePath === ".codex/config.toml",
        ),
      ).toBe(false);
      expect(plan.concurrency.warning).toContain(
        `Project config mode is ${configMode}`,
      );
    }
  });

  it("rejects malformed managed markers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-markers-"));
    await expect(
      compileTeamPlan(root, audit, answers(), proposal, [blueprint], {
        "AGENTS.md": "<!-- codsemble:start -->\nbroken\n",
      }),
    ).rejects.toThrow(/malformed/);
  });

  it("rejects cross-platform reserved agent identifiers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-reserved-name-"));
    const reserved = { ...blueprint, id: "con" };
    await expect(
      compileTeamPlan(
        root,
        audit,
        answers(),
        {
          ...proposal,
          roles: [{ roleId: "con", score: 1, reasons: [], warnings: [] }],
        },
        [reserved],
        {},
      ),
    ).rejects.toThrow("reserved on Windows");
  });

  it("deletes only stale agents owned by the prior manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-stale-agent-"));
    const manifest = JSON.stringify({
      schemaVersion: 1,
      planId: "prior",
      ownership: {
        agentFiles: [".codex/agents/stale-role.toml"],
      },
    });
    const plan = await compileTeamPlan(
      root,
      audit,
      answers(),
      proposal,
      [blueprint],
      {
        ".codex/codsemble/manifest.json": manifest,
        ".codex/agents/stale-role.toml": 'name = "stale_role"\n',
      },
    );

    expect(plan.files).toContainEqual(
      expect.objectContaining({
        relativePath: ".codex/agents/stale-role.toml",
        action: "delete",
        afterSha256: null,
        content: null,
      }),
    );
  });

  it("refuses to overwrite an agent not owned by the prior manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codsemble-owned-agent-"));
    await expect(
      compileTeamPlan(root, audit, answers(), proposal, [blueprint], {
        ".codex/agents/planner.toml": 'name = "user_planner"\n',
      }),
    ).rejects.toThrow("user-owned agent file");
  });
});
