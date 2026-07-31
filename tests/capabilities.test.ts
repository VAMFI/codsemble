import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  detectCodexCapabilities,
  type CapabilityRunner,
} from "../src/capabilities.js";

describe("detectCodexCapabilities", () => {
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
});
