import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { assertWorkspaceRoot } from "./util.js";

const execFileAsync = promisify(execFile);

export interface CodexModelCapability {
  id: string;
  displayName: string;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: string[];
}

export interface CodexCapabilityReport {
  schemaVersion: 1;
  probe: "local-read-only";
  codex: { available: boolean; version: string | null };
  multiAgent: {
    enabled: boolean | null;
    configAdapter: "agents-v1" | null;
  };
  models: {
    status: "available" | "unavailable";
    entries: CodexModelCapability[];
  };
  permissions: {
    enforcement: "inherited-from-parent-session";
    canGrantPermissions: false;
    supportedSandboxModes: ["read-only", "workspace-write"];
  };
  tools: {
    intrinsic: ["workspace-read"];
    sessionDependent: ["workspace-edit", "local-validation"];
  };
  warnings: string[];
}

export interface CapabilityCommandResult {
  stdout: string;
}

export type CapabilityRunner = (
  arguments_: string[],
  workspace: string,
) => Promise<CapabilityCommandResult>;

const defaultRunner: CapabilityRunner = async (arguments_, workspace) => {
  const result = await execFileAsync("codex", arguments_, {
    cwd: workspace,
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout: result.stdout };
};

/**
 * Probe only the local Codex executable. Raw model records are intentionally
 * discarded because they may contain large provider instructions.
 */
export async function detectCodexCapabilities(
  workspace: string,
  runner: CapabilityRunner = defaultRunner,
): Promise<CodexCapabilityReport> {
  const root = await assertWorkspaceRoot(workspace);
  const warnings: string[] = [];
  let version: string | null = null;
  let featureOutput: string | null = null;
  let modelOutput: string | null = null;

  try {
    version = parseCodexVersion((await runner(["--version"], root)).stdout);
    if (version === null) {
      warnings.push("Codex returned an unrecognized version string.");
    }
  } catch (error) {
    warnings.push(`Codex version probe failed: ${errorMessage(error)}`);
  }

  if (version !== null) {
    try {
      featureOutput = (await runner(["features", "list"], root)).stdout;
    } catch (error) {
      warnings.push(`Codex feature probe failed: ${errorMessage(error)}`);
    }
    try {
      modelOutput = (await runner(["debug", "models"], root)).stdout;
    } catch (error) {
      warnings.push(`Codex model probe failed: ${errorMessage(error)}`);
    }
  }

  const multiAgent = parseFeature(featureOutput, "multi_agent");
  const adapterSupported =
    multiAgent === true && version !== null && supportsAgentsV1(version);
  const models = parseModels(modelOutput, warnings);
  if (multiAgent !== true) {
    warnings.push(
      "Native multi-agent support was not confirmed; do not apply a concurrency setting until the active Codex runtime reports it enabled.",
    );
  } else if (!adapterSupported) {
    warnings.push(
      `Codex ${version ?? "unknown"} is outside Codsemble's tested config-adapter range; use manual or unchanged config mode.`,
    );
  }

  return {
    schemaVersion: 1,
    probe: "local-read-only",
    codex: { available: version !== null, version },
    multiAgent: {
      enabled: multiAgent,
      configAdapter: adapterSupported ? "agents-v1" : null,
    },
    models: {
      status: modelOutput === null ? "unavailable" : "available",
      entries: models,
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
    warnings,
  };
}

function supportsAgentsV1(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 0 && minor === 145;
}

function parseCodexVersion(output: string): string | null {
  const match = output
    .trim()
    .match(/^codex-cli\s+([0-9]+\.[0-9]+\.[0-9]+(?:[-+][^\s]+)?)$/);
  return match?.[1] ?? null;
}

function parseFeature(
  output: string | null,
  feature: string,
): boolean | null {
  if (output === null) return null;
  const line = output
    .split(/\r?\n/)
    .find((candidate) => candidate.trimStart().startsWith(`${feature} `));
  if (!line) return null;
  const value = line.trim().split(/\s+/).at(-1);
  return value === "true" ? true : value === "false" ? false : null;
}

function parseModels(
  output: string | null,
  warnings: string[],
): CodexModelCapability[] {
  if (output === null) return [];
  try {
    const parsed = JSON.parse(output) as {
      models?: Array<{
        slug?: unknown;
        display_name?: unknown;
        default_reasoning_level?: unknown;
        supported_reasoning_levels?: Array<{ effort?: unknown }>;
      }>;
    };
    if (!Array.isArray(parsed.models)) {
      throw new Error("model catalog has no models array");
    }
    return parsed.models
      .filter(
        (model): model is typeof model & { slug: string } =>
          typeof model.slug === "string" && model.slug.length > 0,
      )
      .map((model) => ({
        id: model.slug,
        displayName:
          typeof model.display_name === "string"
            ? model.display_name
            : model.slug,
        defaultReasoningEffort:
          typeof model.default_reasoning_level === "string"
            ? model.default_reasoning_level
            : null,
        supportedReasoningEfforts: Array.isArray(
          model.supported_reasoning_levels,
        )
          ? model.supported_reasoning_levels
              .map(({ effort }) => effort)
              .filter((effort): effort is string => typeof effort === "string")
          : [],
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  } catch (error) {
    warnings.push(`Codex model catalog could not be parsed: ${errorMessage(error)}`);
    return [];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
