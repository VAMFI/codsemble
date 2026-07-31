import { execFile } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { assertWorkspaceRoot } from "./util.js";
import type { IntakeAnswers, TeamPlan } from "./types.js";

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
  return runCodexCommand(arguments_, workspace);
};

export async function runCodexCommand(
  arguments_: string[],
  workspace: string,
): Promise<CapabilityCommandResult> {
  if (
    arguments_.some(
      (argument) => !/^[A-Za-z0-9._=-]+$/.test(argument),
    )
  ) {
    throw new Error("Refusing an unsafe Codex probe argument");
  }
  const executable = await resolveCodexExecutable(workspace);
  const isWindowsScript =
    process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
  const command = isWindowsScript
    ? await resolveWindowsCommand(executable, arguments_, workspace)
    : { executable, arguments: arguments_ };
  const result = await execFileAsync(command.executable, command.arguments, {
    cwd: workspace,
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    // cmd.exe parses its /c payload itself. Letting Node quote that payload
    // with the C runtime rules turns the launcher's quotes into literal
    // characters on Windows, so a resolved .cmd/.bat shim is never executed.
    windowsVerbatimArguments: isWindowsScript,
  });
  return { stdout: result.stdout };
}

export async function resolveCodexExecutable(
  workspace: string,
  options: {
    platform?: NodeJS.Platform;
    pathValue?: string;
  } = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const root = await realpath(workspace);
  const names =
    platform === "win32"
      ? ["codex.exe", "codex.cmd", "codex.bat", "codex"]
      : ["codex"];
  for (const rawDirectory of (options.pathValue ?? process.env.PATH ?? "").split(
    path.delimiter,
  )) {
    const directory = rawDirectory.replace(/^"|"$/g, "");
    if (directory === "" || !path.isAbsolute(directory)) continue;
    let resolvedDirectory: string;
    try {
      resolvedDirectory = await realpath(directory);
    } catch {
      continue;
    }
    if (isWithin(root, resolvedDirectory)) continue;
    for (const name of names) {
      const candidate = path.join(resolvedDirectory, name);
      try {
        const resolvedCandidate = await realpath(candidate);
        if (isWithin(root, resolvedCandidate)) continue;
        const metadata = await stat(resolvedCandidate);
        if (!metadata.isFile()) continue;
        if (platform !== "win32") {
          await access(resolvedCandidate, 0o1);
        }
        return resolvedCandidate;
      } catch {
        continue;
      }
    }
  }
  throw new Error(
    "Codex executable was not found in a trusted absolute PATH directory outside the workspace",
  );
}

async function resolveWindowsCommand(
  executable: string,
  arguments_: string[],
  workspace: string,
): Promise<{ executable: string; arguments: string[] }> {
  if (/[%!^&|<>()"]/.test(executable)) {
    throw new Error(
      "Refusing a Windows Codex launcher path containing command metacharacters",
    );
  }
  const commandInterpreter = process.env.ComSpec;
  if (!commandInterpreter || !path.win32.isAbsolute(commandInterpreter)) {
    throw new Error("A trusted absolute Windows command interpreter is required");
  }
  const resolvedInterpreter = await realpath(commandInterpreter);
  if (
    isWithin(await realpath(workspace), resolvedInterpreter) ||
    !(await stat(resolvedInterpreter)).isFile()
  ) {
    throw new Error("Windows command interpreter is not trusted");
  }
  return {
    executable: resolvedInterpreter,
    arguments: [
      "/d",
      "/s",
      "/c",
      // The first and last quotes delimit cmd.exe's /c command string; the
      // inner pair quotes the trusted launcher path. Probe arguments have
      // already been restricted to a shell-metacharacter-free alphabet.
      `""${executable}" ${arguments_.join(" ")}"`,
    ],
  };
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

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

export function bindIntakeCapabilities(
  answers: IntakeAnswers,
  report: CodexCapabilityReport,
): IntakeAnswers {
  assertNativeRuntime(report, "Plan");
  const liveAdapter = report.multiAgent.configAdapter;
  if (
    answers.configAdapter !== null &&
    answers.configAdapter !== liveAdapter
  ) {
    throw new Error(
      `Plan capability check failed: answers claim ${answers.configAdapter}, but the local runtime did not confirm it`,
    );
  }
  if (
    (answers.configMode === "preview" ||
      answers.configMode === "apply-project") &&
    liveAdapter !== "agents-v1"
  ) {
    throw new Error(
      "Plan capability check failed: project concurrency requires a live agents-v1 adapter",
    );
  }
  const liveModels = report.models.entries.map(
    ({ id, supportedReasoningEfforts }) => ({
      id,
      supportedReasoningEfforts: [...supportedReasoningEfforts],
    }),
  );
  const liveById = new Map(liveModels.map((model) => [model.id, model]));
  for (const [profile, model] of Object.entries(answers.verifiedModels)) {
    if (model !== undefined && !liveById.has(model)) {
      throw new Error(
        `Plan capability check failed: ${profile} model ${model} is absent from the live local model catalog`,
      );
    }
  }
  return {
    ...answers,
    configAdapter: liveAdapter,
    modelCapabilities: liveModels,
  };
}

export function assertPlanCapabilities(
  plan: Pick<TeamPlan, "roles" | "concurrency">,
  report: CodexCapabilityReport,
  phase: "plan" | "apply",
): void {
  const label = phase === "plan" ? "Plan" : "Apply";
  assertNativeRuntime(report, label);
  if (
    plan.concurrency.adapter !== null &&
    plan.concurrency.adapter !== report.multiAgent.configAdapter
  ) {
    throw new Error(
      `${label} capability check failed: required adapter ${plan.concurrency.adapter} is not live`,
    );
  }
  if (
    plan.concurrency.configMode === "apply-project" &&
    report.multiAgent.configAdapter !== "agents-v1"
  ) {
    throw new Error(
      `${label} capability check failed: project concurrency requires a live agents-v1 adapter`,
    );
  }
  const models = new Map(
    report.models.entries.map((model) => [model.id, model]),
  );
  for (const role of plan.roles) {
    if (role.model === undefined) continue;
    const live = models.get(role.model);
    if (live === undefined) {
      throw new Error(
        `${label} capability check failed: role ${role.id} requires unavailable model ${role.model}`,
      );
    }
    if (
      role.reasoningEffort !== undefined &&
      !live.supportedReasoningEfforts.includes(role.reasoningEffort)
    ) {
      throw new Error(
        `${label} capability check failed: model ${role.model} does not support ${role.reasoningEffort}`,
      );
    }
  }
}

function assertNativeRuntime(
  report: CodexCapabilityReport,
  label: "Plan" | "Apply",
): void {
  if (!report.codex.available) {
    throw new Error(
      `${label} capability check failed: the local Codex runtime is unavailable`,
    );
  }
  if (report.multiAgent.enabled !== true) {
    throw new Error(
      `${label} capability check failed: native multi-agent support is not enabled`,
    );
  }
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
