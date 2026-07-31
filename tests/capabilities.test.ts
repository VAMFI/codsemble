import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPlanCapabilities,
  bindIntakeCapabilities,
  detectCodexCapabilities,
  resolveCodexExecutable,
  type CapabilityRunner,
  type CodexCapabilityReport,
} from "../src/capabilities.js";
import type { IntakeAnswers, TeamPlan } from "../src/types.js";

describe("detectCodexCapabilities", () => {
  it("ignores a workspace-local Codex launcher when resolving PATH", async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), "codsemble-capabilities-workspace-"),
    );
    const trustedBin = await mkdtemp(
      path.join(os.tmpdir(), "codsemble-capabilities-bin-"),
    );
    const executableName =
      process.platform === "win32" ? "codex.cmd" : "codex";
    const untrusted = path.join(workspace, executableName);
    const trusted = path.join(trustedBin, executableName);
    await mkdir(workspace, { recursive: true });
    await writeFile(untrusted, "malicious workspace launcher");
    await writeFile(trusted, "trusted test launcher");
    if (process.platform !== "win32") {
      await chmod(untrusted, 0o755);
      await chmod(trusted, 0o755);
    }

    await expect(
      resolveCodexExecutable(workspace, {
        pathValue: `${workspace}${path.delimiter}${trustedBin}`,
      }),
    ).resolves.toBe(await realpath(trusted));
  });

  it("returns a bounded report without retaining raw model instructions", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "codsemble-capabilities-"));
    const runner: CapabilityRunner = async (arguments_) => {
      switch (arguments_.join(" ")) {
        case "--version":
          return { stdout: "codex-cli 0.145.0\n" };
        case "features list":
          return {
            stdout:
              "plugins stable true\nmulti_agent stable true\nmulti_agent_v2 stable false\n",
          };
        case "debug models":
          return {
            stdout: JSON.stringify({
              models: [
                {
                  slug: "gpt-test-sol",
                  display_name: "Test Sol",
                  default_reasoning_level: "low",
                  supported_reasoning_levels: [
                    { effort: "low", description: "fast" },
                    { effort: "high", description: "deep" },
                  ],
                  base_instructions: "SECRET-LIKE RAW PROVIDER INSTRUCTIONS",
                },
              ],
            }),
          };
        default:
          throw new Error("unexpected command");
      }
    };

    const report = await detectCodexCapabilities(workspace, runner);

    expect(report).toMatchObject({
      codex: { available: true, version: "0.145.0" },
      multiAgent: { enabled: true, configAdapter: "agents-v1" },
      permissions: {
        enforcement: "inherited-from-parent-session",
        canGrantPermissions: false,
      },
      models: {
        status: "available",
        entries: [
          {
            id: "gpt-test-sol",
            displayName: "Test Sol",
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: ["low", "high"],
          },
        ],
      },
    });
    expect(JSON.stringify(report)).not.toContain("RAW PROVIDER");
  });

  it("fails closed when Codex is unavailable", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "codsemble-capabilities-"));
    const report = await detectCodexCapabilities(workspace, async () => {
      throw new Error("ENOENT");
    });

    expect(report.codex).toEqual({ available: false, version: null });
    expect(report.multiAgent).toEqual({
      enabled: null,
      configAdapter: null,
    });
    expect(report.models).toEqual({ status: "unavailable", entries: [] });
    expect(report.warnings.join(" ")).toContain("do not apply");
  });

  it("refuses to guess a config adapter for an untested Codex version", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "codsemble-capabilities-"));
    const report = await detectCodexCapabilities(
      workspace,
      async (arguments_) => {
        if (arguments_[0] === "--version") {
          return { stdout: "codex-cli 9.0.0\n" };
        }
        if (arguments_[0] === "features") {
          return { stdout: "multi_agent stable true\n" };
        }
        return { stdout: '{"models":[]}' };
      },
    );

    expect(report.multiAgent).toEqual({
      enabled: true,
      configAdapter: null,
    });
    expect(report.warnings.join(" ")).toContain("outside Codsemble's tested");
  });

  it("replaces untrusted intake capability claims with the live probe", () => {
    const input = intake({
      modelCapabilities: [{
        id: "claimed-model",
        supportedReasoningEfforts: ["high"],
      }],
      verifiedModels: {},
    });
    const bound = bindIntakeCapabilities(input, capabilityReport());

    expect(bound.configAdapter).toBe("agents-v1");
    expect(bound.modelCapabilities).toEqual([{
      id: "live-model",
      supportedReasoningEfforts: ["low"],
    }]);
    expect(() =>
      bindIntakeCapabilities(
        { ...input, verifiedModels: { deep: "claimed-model" } },
        capabilityReport(),
      ),
    ).toThrow("absent from the live local model catalog");
  });

  it("refuses apply when model effort or adapter support drifted", () => {
    const plan = {
      roles: [{
        id: "planner",
        name: "planner",
        description: "Plan work",
        developerInstructions: "Report evidence.",
        modelProfile: "deep",
        model: "live-model",
        reasoningEffort: "high",
        sandbox: "read-only",
        source: "catalog",
      }],
      concurrency: {
        requestedWorkers: 2,
        projectCurrentValue: null,
        adapter: "agents-v1",
        configMode: "apply-project",
        willApply: true,
        manualSnippet: "[agents]\nmax_concurrent_threads_per_session = 2\n",
      },
    } satisfies Pick<TeamPlan, "roles" | "concurrency">;

    expect(() =>
      assertPlanCapabilities(plan, capabilityReport(), "apply"),
    ).toThrow("does not support high");
    expect(() =>
      assertPlanCapabilities(
        plan,
        capabilityReport({ configAdapter: null }),
        "apply",
      ),
    ).toThrow("required adapter agents-v1 is not live");
  });
});

function capabilityReport(
  override: { configAdapter?: "agents-v1" | null } = {},
): CodexCapabilityReport {
  return {
    schemaVersion: 1,
    probe: "local-read-only",
    codex: { available: true, version: "0.145.0" },
    multiAgent: {
      enabled: true,
      configAdapter:
        override.configAdapter === undefined
          ? "agents-v1"
          : override.configAdapter,
    },
    models: {
      status: "available",
      entries: [{
        id: "live-model",
        displayName: "Live model",
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: ["low"],
      }],
    },
    permissions: {
      enforcement: "inherited-from-parent-session",
      canGrantPermissions: false,
      supportedSandboxModes: ["read-only", "workspace-write"],
    },
    tools: {
      intrinsic: ["workspace-read"],
      sessionDependent: ["workspace-edit", "local-validation"],
    },
    warnings: [],
  };
}

function intake(
  override: Partial<IntakeAnswers> = {},
): IntakeAnswers {
  return {
    goals: ["engineering"],
    projectStage: "active",
    desiredRoleCount: 2,
    maxConcurrentWorkers: 2,
    optimizeFor: "balanced",
    configMode: "apply-project",
    configAdapter: "agents-v1",
    prohibitedActions: [],
    requiredRoles: [],
    excludedRoles: [],
    customRoles: [],
    availableTools: ["workspace-read"],
    modelCapabilities: [],
    verifiedModels: {},
    allowHighConcurrency: false,
    ...override,
  };
}
