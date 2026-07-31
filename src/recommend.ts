import type {
  AuditReport,
  IntakeAnswers,
  RecommendationResult,
  RoleBlueprint,
  RoleScore,
  TeamProposal,
} from "./types.js";
import { sha256, stableStringify } from "./util.js";

interface ScoredCandidate {
  role: RoleBlueprint;
  baseScore: number;
  reasons: string[];
  warnings: string[];
}

const KIND_MULTIPLIER = {
  lean: 0.6,
  balanced: 1,
  full: 1.5,
} as const;

export function recommendTeams(
  audit: AuditReport,
  answers: IntakeAnswers,
  roles: RoleBlueprint[],
): RecommendationResult {
  validateSelectionInputs(answers, roles);
  const candidates = scoreCandidates(audit, answers, roles);
  const customCount = answers.customRoles.length;
  const requiredCount =
    new Set([...answers.requiredRoles, ...answers.customRoles.map(({ id }) => id)])
      .size;
  const availableCount =
    candidates.length + customCount;

  const proposals = (
    Object.keys(KIND_MULTIPLIER) as TeamProposal["kind"][]
  ).map((kind) => {
    const requested = Math.round(
      answers.desiredRoleCount * KIND_MULTIPLIER[kind],
    );
    const count = Math.min(
      availableCount,
      Math.max(requiredCount, requested, 1),
    );
    const selected = selectRoles(candidates, answers, count - customCount);
    const customScores: RoleScore[] = answers.customRoles.map((custom) => ({
      roleId: custom.id,
      score: 10_000,
      reasons: [
        `User supplied the custom role "${custom.name}" for: ${custom.jobToBeDone}`,
      ],
      warnings: [],
    }));
    const proposalRoles = [...selected, ...customScores].sort(
      (left, right) =>
        right.score - left.score || left.roleId.localeCompare(right.roleId),
    );

    return {
      kind,
      roles: proposalRoles,
      maxConcurrentWorkers: answers.maxConcurrentWorkers,
      rationale:
        `${capitalize(kind)} installs ${proposalRoles.length} specialist role` +
        `${proposalRoles.length === 1 ? "" : "s"} while keeping the worker ceiling ` +
        `separate at ${answers.maxConcurrentWorkers}.`,
    };
  });

  return {
    schemaVersion: 1,
    auditFingerprint: sha256(stableStringify(audit)),
    proposals,
  };
}

function validateSelectionInputs(
  answers: IntakeAnswers,
  roles: RoleBlueprint[],
): void {
  const catalogIds = new Set(roles.map(({ id }) => id));
  const availableTools = new Set(answers.availableTools);
  const customIds = new Set<string>();

  for (const custom of answers.customRoles) {
    if (catalogIds.has(custom.id) || customIds.has(custom.id)) {
      throw new Error(`Custom role id is not unique: ${custom.id}`);
    }
    customIds.add(custom.id);
  }

  for (const id of [...answers.requiredRoles, ...answers.excludedRoles]) {
    if (!catalogIds.has(id) && !customIds.has(id)) {
      throw new Error(`Unknown selected role: ${id}`);
    }
  }

  const excluded = new Set(answers.excludedRoles);
  for (const id of [
    ...answers.requiredRoles,
    ...answers.customRoles.map(({ id }) => id),
  ]) {
    if (excluded.has(id)) {
      throw new Error(`Role cannot be both required and excluded: ${id}`);
    }
  }
  for (const id of answers.requiredRoles) {
    const role = roles.find((candidate) => candidate.id === id);
    const missing = role?.requiredTools.filter(
      (tool) => !availableTools.has(tool),
    );
    if (missing && missing.length > 0) {
      throw new Error(
        `Required role ${id} needs unavailable tools: ${missing.join(", ")}`,
      );
    }
  }
}

function scoreCandidates(
  audit: AuditReport,
  answers: IntakeAnswers,
  roles: RoleBlueprint[],
): ScoredCandidate[] {
  const excluded = new Set(answers.excludedRoles);
  const required = new Set(answers.requiredRoles);
  const availableTools = new Set(answers.availableTools);
  const goals = new Set(answers.goals);
  const signalTokens = new Map<string, string[]>();

  for (const signal of audit.signals) {
    const evidence = signal.evidence
      .map(({ path, detail }) => `${path}: ${detail}`)
      .sort();
    signalTokens.set(signal.key, evidence);
    for (const value of signal.values) {
      signalTokens.set(`${signal.key}:${value}`, evidence);
      signalTokens.set(value, evidence);
      signalTokens.set(`signal:${value}`, evidence);
      for (const derived of deriveSignalAliases(signal.key, value)) {
        signalTokens.set(derived, evidence);
      }
    }
  }
  for (const inspectedPath of audit.inspectedFiles) {
    const citation = [`${inspectedPath}: inspected path`];
    for (const token of derivePathTokens(inspectedPath)) {
      const previous = signalTokens.get(token) ?? [];
      signalTokens.set(token, [...new Set([...previous, ...citation])].sort());
    }
  }

  return roles
    .filter(
      ({ id, requiredTools }) =>
        !excluded.has(id) &&
        requiredTools.every((tool) => availableTools.has(tool)),
    )
    .map((role) => {
      let score = 0;
      const reasons: string[] = [];
      const warnings: string[] = [];

      if (required.has(role.id)) {
        score += 10_000;
        reasons.push(`User explicitly required role "${role.id}".`);
      }

      for (const tag of role.goalTags) {
        if (goals.has(tag)) {
          score += 30;
          reasons.push(`User goal "${tag}" matches this role.`);
        }
      }

      for (const token of role.repoSignals) {
        const evidence = signalTokens.get(token);
        if (evidence) {
          score += 24;
          const citation =
            evidence[0] ?? `typed audit signal "${token}" (no file path)`;
          reasons.push(`Audit signal "${token}" is supported by ${citation}.`);
        }
      }

      if (role.goalTags.includes(`stage:${answers.projectStage}`)) {
        score += 10;
        reasons.push(
          `User selected project stage "${answers.projectStage}".`,
        );
      }

      if (answers.optimizeFor === "cost") {
        score += role.costClass === "low" ? 8 : role.costClass === "high" ? -8 : 0;
      } else if (answers.optimizeFor === "speed") {
        score += role.defaultModelProfile === "fast" ? 8 : 0;
      } else if (answers.optimizeFor === "quality") {
        score += role.defaultModelProfile === "deep" ? 8 : 0;
      }

      if (reasons.length === 0) {
        reasons.push(
          `User requested a ${answers.desiredRoleCount}-role team optimized for ${answers.optimizeFor}.`,
        );
      }

      return { role, baseScore: score, reasons, warnings };
    });
}

function derivePathTokens(inspectedPath: string): string[] {
  const lower = inspectedPath.toLowerCase();
  const parts = lower.split("/");
  const basename = parts.at(-1) ?? lower;
  const normalize = (value: string) =>
    value.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const tokens = new Set<string>([
    `file:${normalize(basename)}`,
    ...parts.slice(0, -1).map((part) => `dir:${normalize(part)}`),
  ]);
  const aliases: Array<[RegExp, string[]]> = [
    [/(^|\/)agents\.md$/, ["file:agents-md", "signal:multi-agent"]],
    [/(^|\/)security\.md$/, ["file:security-policy"]],
    [/(^|\/)code[_-]of[_-]conduct(?:\.md)?$/, ["file:code-of-conduct"]],
    [/(^|\/)contributing(?:\.md)?$/, ["file:contributing"]],
    [/(^|\/)changelog(?:\.md)?$/, ["file:changelog"]],
    [/(^|\/)license(?:\.md)?$/, ["file:license"]],
    [/(^|\/)project_goal\.md$/, ["file:project-goal", "file:project-plan"]],
    [/(^|\/)tsconfig(?:\.[^/]+)?\.json$/, ["file:build-config"]],
    [/(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/, ["file:dependency-lock"]],
    [/(^|\/)(?:test|tests|spec|specs|__tests__)(\/|$)/, ["dir:unit-tests"]],
    [/(^|\/)(?:integration-tests|integration_tests)(\/|$)/, ["dir:integration-tests"]],
    [/(^|\/)docs(\/|$)/, ["dir:docs"]],
    [/(^|\/)(?:migrations?|db)(\/|$)/, ["dir:migrations", "dir:database"]],
    [/(^|\/)(?:infra|infrastructure)(\/|$)/, ["dir:infrastructure"]],
    [/(^|\/)(?:notebooks?)(\/|$)/, ["dir:notebooks"]],
    [/(^|\/)build\.gradle(?:\.kts)?$/, ["file:android-gradle", "file:build-config"]],
    [/\.xcodeproj(\/|$)/, ["file:xcode-project"]],
  ];
  for (const [pattern, derived] of aliases) {
    if (pattern.test(lower)) {
      for (const token of derived) tokens.add(token);
    }
  }
  return [...tokens];
}

function deriveSignalAliases(key: string, value: string): string[] {
  const tokens = new Set<string>();
  if (
    key === "framework" &&
    ["angular", "nextjs", "react", "sveltekit", "vue"].includes(value)
  ) {
    tokens.add("signal:frontend");
  }
  if (key === "framework" && ["nestjs"].includes(value)) {
    tokens.add("signal:backend");
  }
  if (key === "stack" && ["rust", "go"].includes(value)) {
    tokens.add("signal:systems-language");
  }
  if (key === "stack" && value === "dart") {
    tokens.add("signal:cross-platform-mobile");
  }
  if (key === "codex" && ["specialist-agents", "codsemble-managed-team"].includes(value)) {
    tokens.add("signal:multi-agent");
  }
  if (key === "testing") {
    tokens.add("file:test-config");
    tokens.add("signal:qa-checklist");
  }
  return [...tokens];
}

function selectRoles(
  candidates: ScoredCandidate[],
  answers: IntakeAnswers,
  targetCount: number,
): RoleScore[] {
  const required = new Set(answers.requiredRoles);
  const remaining = [...candidates];
  const selected: ScoredCandidate[] = [];
  const result: RoleScore[] = [];

  while (selected.length < targetCount && remaining.length > 0) {
    const ranked = remaining
      .map((candidate) => {
        let adjustment = 0;
        const warnings = [...candidate.warnings];
        const selectedFamilies = selected.filter(
          (prior) => prior.role.family === candidate.role.family,
        ).length;
        if (selectedFamilies > 0) {
          adjustment -= 12 * selectedFamilies;
          warnings.push(
            `The proposal already contains ${selectedFamilies} role(s) from "${candidate.role.family}".`,
          );
        }

        const requestedGoals = new Set(answers.goals);
        const coveredGoals = new Set(
          selected.flatMap(({ role }) =>
            role.goalTags.filter((tag) => requestedGoals.has(tag)),
          ),
        );
        const candidateGoals = candidate.role.goalTags.filter((tag) =>
          requestedGoals.has(tag),
        );
        for (const goal of candidateGoals) {
          adjustment += coveredGoals.has(goal) ? -8 : 18;
        }

        for (const prior of selected) {
          if (
            candidate.role.conflicts.includes(prior.role.id) ||
            prior.role.conflicts.includes(candidate.role.id)
          ) {
            adjustment -= 1_000;
            warnings.push(`Conflicts with selected role "${prior.role.id}".`);
          }
          const overlap = responsibilityOverlap(candidate.role, prior.role);
          if (overlap >= 0.6) {
            adjustment -= 18;
            warnings.push(
              `Ownership substantially overlaps selected role "${prior.role.id}".`,
            );
          }
          if (candidate.role.dependencies.includes(prior.role.id)) {
            adjustment += 4;
          }
        }

        return {
          candidate,
          score: candidate.baseScore + adjustment,
          warnings,
        };
      })
      .sort(
        (left, right) =>
          Number(required.has(right.candidate.role.id)) -
            Number(required.has(left.candidate.role.id)) ||
          right.score - left.score ||
          left.candidate.role.id.localeCompare(right.candidate.role.id),
      );
    const next = ranked[0];
    if (!next) break;
    selected.push(next.candidate);
    result.push({
      roleId: next.candidate.role.id,
      score: next.score,
      reasons: next.candidate.reasons,
      warnings: next.warnings,
    });
    remaining.splice(remaining.indexOf(next.candidate), 1);
  }

  return result;
}

function responsibilityOverlap(
  left: RoleBlueprint,
  right: RoleBlueprint,
): number {
  const leftTokens = tokenize(left.responsibilities.join(" "));
  const rightTokens = tokenize(right.responsibilities.join(" "));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token));
  const union = new Set([...leftTokens, ...rightTokens]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 3),
  );
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
