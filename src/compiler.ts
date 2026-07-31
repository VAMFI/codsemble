import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { patchConcurrencyToml } from "./config.js";
import type {
  AuditReport,
  CustomRoleInput,
  FilePreimage,
  IntakeAnswers,
  PlannedFile,
  ResolvedRole,
  RoleBlueprint,
  TeamPlan,
  TeamProposal,
} from "./types.js";
import {
  assertContainedPath,
  assertSafeIdentifier,
  assertWorkspaceRoot,
  escapeTomlBasicString,
  escapeTomlMultiline,
  managedBlock,
  sha256,
  stableStringify,
} from "./util.js";

const AGENTS_START = "<!-- codsemble:start -->";
const AGENTS_END = "<!-- codsemble:end -->";

export type ExistingFiles = Readonly<Record<string, string>>;

export async function compileTeamPlan(
  workspaceRoot: string,
  audit: AuditReport,
  answers: IntakeAnswers,
  proposal: TeamProposal,
  roles: RoleBlueprint[],
  existingFiles?: ExistingFiles,
): Promise<TeamPlan> {
  const root = await assertWorkspaceRoot(workspaceRoot);
  if (proposal.maxConcurrentWorkers !== answers.maxConcurrentWorkers) {
    throw new Error(
      "Proposal worker ceiling does not match the confirmed intake answer",
    );
  }
  const resolvedRoles = resolveRoles(proposal, answers, roles);
  const auditFingerprint = sha256(stableStringify(audit));
  const desiredFiles = new Map<string, string>();

  for (const role of resolvedRoles) {
    desiredFiles.set(`.codex/agents/${role.id}.toml`, renderRoleToml(role));
  }

  const agentsPath = "AGENTS.md";
  const existingAgents = await getExistingContent(
    root,
    agentsPath,
    existingFiles,
  );
  desiredFiles.set(
    agentsPath,
    mergeManagedAgentsBlock(
      existingAgents,
      renderManagedAgentsBody(resolvedRoles, proposal),
    ),
  );

  const configPath = ".codex/config.toml";
  const existingConfig = await getExistingContent(
    root,
    configPath,
    existingFiles,
  );
  const concurrencyPatch = patchConcurrencyToml(
    existingConfig ?? "",
    answers.maxConcurrentWorkers,
    "agents-v1",
  );
  const shouldPlanConfig =
    answers.configMode === "preview" ||
    answers.configMode === "apply-project";
  const shouldRaiseConcurrency =
    concurrencyPatch.currentValue === null ||
    concurrencyPatch.currentValue < answers.maxConcurrentWorkers;
  if (shouldPlanConfig && shouldRaiseConcurrency) {
    desiredFiles.set(configPath, concurrencyPatch.content);
  }

  const concurrency = {
    requestedWorkers: answers.maxConcurrentWorkers,
    effectiveCurrentValue: concurrencyPatch.currentValue,
    adapter: "agents-v1" as const,
    configMode: answers.configMode,
    ...buildConcurrencyWarning(
      answers,
      resolvedRoles.length,
      concurrencyPatch.currentValue,
    ),
  };
  const planSeed = {
    auditFingerprint,
    proposal: proposal.kind,
    roles: resolvedRoles,
    concurrency,
    outputs: [...desiredFiles]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relativePath, content]) => ({
        relativePath,
        afterSha256: sha256(content),
      })),
  };
  const planId = sha256(stableStringify(planSeed)).slice(0, 24);

  const manifest = {
    schemaVersion: 1,
    generator: "codsemble",
    planId,
    auditFingerprint,
    proposal: {
      kind: proposal.kind,
      maxConcurrentWorkers: proposal.maxConcurrentWorkers,
    },
    roles: resolvedRoles.map((role) => ({
      id: role.id,
      name: role.name,
      modelProfile: role.modelProfile,
      ...(role.model ? { model: role.model } : {}),
      ...(role.reasoningEffort
        ? { reasoningEffort: role.reasoningEffort }
        : {}),
      sandbox: role.sandbox,
      source: answers.customRoles.some(({ id }) => id === role.id)
        ? "custom"
        : "catalog",
    })),
    ownership: {
      agentsBlock: { path: "AGENTS.md", start: AGENTS_START, end: AGENTS_END },
      agentFiles: resolvedRoles.map(
        ({ id }) => `.codex/agents/${id}.toml`,
      ),
    },
  };
  desiredFiles.set(
    ".codex/codsemble/manifest.json",
    stableStringify(manifest),
  );

  const preimages: FilePreimage[] = [];
  const files: PlannedFile[] = [];
  for (const [relativePath, content] of [...desiredFiles].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const before = await getExistingFile(root, relativePath, existingFiles);
    const afterSha256 = sha256(content);
    preimages.push({
      relativePath,
      exists: before.content !== undefined,
      sha256:
        before.content === undefined ? null : sha256(Buffer.from(before.content)),
      mode: before.mode,
    });
    if (before.content !== content) {
      files.push({
        relativePath,
        action: before.content === undefined ? "create" : "update",
        beforeSha256:
          before.content === undefined ? null : sha256(Buffer.from(before.content)),
        afterSha256,
        content,
      });
    }
  }

  return {
    schemaVersion: 1,
    planId,
    auditFingerprint,
    roles: resolvedRoles,
    concurrency,
    preimages,
    files,
  };
}

function buildConcurrencyWarning(
  answers: IntakeAnswers,
  roleCount: number,
  currentValue: number | null,
): { warning?: string } {
  const warnings: string[] = [];
  if (answers.maxConcurrentWorkers > roleCount) {
    warnings.push(
      `Worker ceiling ${answers.maxConcurrentWorkers} exceeds the ${roleCount} installed roles; roles and concurrency are independent.`,
    );
  }
  if (
    currentValue !== null &&
    currentValue >= answers.maxConcurrentWorkers
  ) {
    warnings.push(
      `Existing worker ceiling ${currentValue} is already at or above the requested value and will not be lowered.`,
    );
  }
  if (
    answers.configMode === "manual" ||
    answers.configMode === "unchanged"
  ) {
    warnings.push(
      `Project config mode is ${answers.configMode}; no .codex/config.toml change is planned.`,
    );
  }
  return warnings.length > 0 ? { warning: warnings.join(" ") } : {};
}

function resolveRoles(
  proposal: TeamProposal,
  answers: IntakeAnswers,
  catalog: RoleBlueprint[],
): ResolvedRole[] {
  const catalogById = new Map(catalog.map((role) => [role.id, role]));
  const customById = new Map(answers.customRoles.map((role) => [role.id, role]));
  const seen = new Set<string>();

  return proposal.roles.map(({ roleId }) => {
    assertSafeIdentifier(roleId, "Role id");
    if (seen.has(roleId)) {
      throw new Error(`Proposal contains duplicate role: ${roleId}`);
    }
    seen.add(roleId);

    const blueprint = catalogById.get(roleId);
    const custom = customById.get(roleId);
    if (!blueprint && !custom) {
      throw new Error(`Proposal contains unknown role: ${roleId}`);
    }
    return blueprint
      ? resolveCatalogRole(blueprint, answers)
      : resolveCustomRole(custom as CustomRoleInput, answers);
  });
}

function resolveCatalogRole(
  role: RoleBlueprint,
  answers: IntakeAnswers,
): ResolvedRole {
  const model = resolveModel(role.defaultModelProfile, answers);
  return {
    id: role.id,
    name: role.name,
    description: role.summary,
    developerInstructions: [
      `You are the ${role.name} for this workspace.`,
      "",
      `Mission: ${role.jobToBeDone}`,
      "",
      "Responsibilities:",
      ...role.responsibilities.map((item) => `- ${item}`),
      "",
      "Required deliverables:",
      ...role.deliverables.map((item) => `- ${item}`),
      "",
      "Quality gates:",
      ...role.qualityGates.map((item) => `- ${item}`),
      "",
      `External writes: ${role.externalWritePolicy}.`,
      `Permission profile: ${role.permissionProfile}.`,
      "Stay within the task delegated by the primary thread. Report evidence, uncertainty, and unresolved gates.",
    ].join("\n"),
    modelProfile: role.defaultModelProfile,
    ...(model ? { model } : {}),
    ...(model && role.defaultReasoningEffort !== "inherit"
      ? { reasoningEffort: role.defaultReasoningEffort }
      : {}),
    sandbox: role.defaultSandbox,
  };
}

function resolveCustomRole(
  role: CustomRoleInput,
  answers: IntakeAnswers,
): ResolvedRole {
  const model = resolveModel(role.modelProfile, answers);
  return {
    id: role.id,
    name: role.name,
    description: role.jobToBeDone,
    developerInstructions: [
      `You are the ${role.name} for this workspace.`,
      "",
      `Mission: ${role.jobToBeDone}`,
      "",
      "Success criteria:",
      ...role.successCriteria.map((item) => `- ${item}`),
      "",
      "Allowed paths:",
      ...(role.allowedPaths.length > 0
        ? role.allowedPaths.map((item) => `- ${item}`)
        : ["- No paths were explicitly granted; remain read-only."]),
      "",
      "Prohibited actions:",
      ...[...new Set([...answers.prohibitedActions, ...role.prohibitedActions])].map(
        (item) => `- ${item}`,
      ),
      "",
      "Stay within the task delegated by the primary thread. Report evidence, uncertainty, and unresolved gates.",
    ].join("\n"),
    modelProfile: role.modelProfile,
    ...(model ? { model } : {}),
    ...(role.reasoningEffort !== "inherit"
      ? { reasoningEffort: role.reasoningEffort }
      : {}),
    sandbox: role.sandbox,
  };
}

function resolveModel(
  profile: ResolvedRole["modelProfile"],
  answers: IntakeAnswers,
): string | undefined {
  if (profile === "inherit") return undefined;
  const verified = answers.verifiedModels[profile]?.trim();
  return verified ? verified : undefined;
}

function renderRoleToml(role: ResolvedRole): string {
  const lines = [
    `name = ${escapeTomlBasicString(nativeAgentName(role.id))}`,
    `description = ${escapeTomlBasicString(role.description)}`,
    `developer_instructions = ${escapeTomlMultiline(role.developerInstructions)}`,
  ];
  if (role.model) {
    lines.push(`model = ${escapeTomlBasicString(role.model)}`);
  }
  if (role.reasoningEffort) {
    lines.push(
      `model_reasoning_effort = ${escapeTomlBasicString(role.reasoningEffort)}`,
    );
  }
  lines.push(`sandbox_mode = ${escapeTomlBasicString(role.sandbox)}`);
  return `${lines.join("\n")}\n`;
}

function renderManagedAgentsBody(
  roles: ResolvedRole[],
  proposal: TeamProposal,
): string {
  return [
    "## Codsemble team",
    "",
    `Selected profile: ${proposal.kind}. Installed roles: ${roles.length}.`,
    "",
    ...roles.map(
      (role) =>
        `- \`${role.id}\` (spawn as \`${nativeAgentName(role.id)}\`): ${role.description} (sandbox: ${role.sandbox}; model: ${role.model ?? "inherit"})`,
    ),
    "",
    "Delegate only separable, bounded work. The primary thread owns scope, integration, authorization, and final claims.",
    "Treat the worker ceiling as capacity, not a target. Keep trivial or tightly coupled work on the primary thread.",
  ].join("\n");
}

function nativeAgentName(roleId: string): string {
  return roleId.replaceAll("-", "_");
}

function mergeManagedAgentsBlock(
  existing: string | undefined,
  body: string,
): string {
  const block = managedBlock(AGENTS_START, AGENTS_END, body);
  if (existing === undefined || existing.length === 0) {
    return `${block}\n`;
  }

  const start = existing.indexOf(AGENTS_START);
  const end = existing.indexOf(AGENTS_END);
  if ((start === -1) !== (end === -1) || end < start) {
    throw new Error("AGENTS.md contains malformed Codsemble managed markers");
  }
  if (start === -1) {
    return `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
  }
  if (
    existing.indexOf(AGENTS_START, start + AGENTS_START.length) !== -1 ||
    existing.indexOf(AGENTS_END, end + AGENTS_END.length) !== -1
  ) {
    throw new Error("AGENTS.md contains multiple Codsemble managed blocks");
  }
  return `${existing.slice(0, start)}${block}${existing.slice(
    end + AGENTS_END.length,
  )}`;
}

async function getExistingContent(
  root: string,
  relativePath: string,
  existingFiles?: ExistingFiles,
): Promise<string | undefined> {
  return (await getExistingFile(root, relativePath, existingFiles)).content;
}

async function getExistingFile(
  root: string,
  relativePath: string,
  existingFiles?: ExistingFiles,
): Promise<{ content: string | undefined; mode: number | null }> {
  if (existingFiles) {
    return {
      content: Object.prototype.hasOwnProperty.call(existingFiles, relativePath)
        ? existingFiles[relativePath]
        : undefined,
      mode: null,
    };
  }
  const absolute = await assertContainedPath(root, relativePath);
  try {
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Refusing non-regular output preimage: ${relativePath}`);
    }
    return {
      content: await readFile(absolute, "utf8"),
      mode: stats.mode & 0o777,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { content: undefined, mode: null };
    }
    throw error;
  }
}
