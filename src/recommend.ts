import { compileProjectTeamDesign } from "./capability-compiler.js";
import type {
  AuditReport,
  IntakeAnswers,
  RecommendationResult,
  RoleBlueprint,
  RoleScore,
  TeamProposal,
} from "./types.js";

export function recommendTeams(
  audit: AuditReport,
  answers: IntakeAnswers,
  primitives: RoleBlueprint[],
): RecommendationResult {
  validateSelectionInputs(answers, primitives);
  const teamDesign = compileProjectTeamDesign(audit, answers, primitives);
  const requiredScores: RoleScore[] = answers.requiredRoles.map((roleId) => ({
    roleId,
    score: 20_000,
    reasons: [`User explicitly required primitive role "${roleId}".`],
    warnings: [],
  }));
  const customScores: RoleScore[] = answers.customRoles.map((custom) => ({
    roleId: custom.id,
    score: 30_000,
    reasons: [`User supplied the specialized role "${custom.name}".`],
    warnings: [],
  }));
  const explicitRoleIds = new Set(
    [...requiredScores, ...customScores].map(({ roleId }) => roleId),
  );
  const proposals: TeamProposal[] = teamDesign.proposals.map((proposal) => {
    const generated = proposal.roleIds.map((roleId, index) => {
      const role = teamDesign.roles.find(({ id }) => id === roleId);
      return {
        roleId,
        score: 10_000 - index,
        reasons: [
          `Generated for work packages: ${role?.workPackageIds.join(", ") ?? "none"}.`,
          `Bound to evidence references: ${role?.evidenceRefs.join(", ") || "confirmed user context"}.`,
        ],
        warnings: [],
      } satisfies RoleScore;
    });
    const selected = new Map<string, RoleScore>();
    for (const score of [...generated, ...requiredScores, ...customScores]) {
      selected.set(score.roleId, score);
    }
    const explicitSelected = [...selected.keys()].filter((roleId) =>
      explicitRoleIds.has(roleId),
    ).length;
    return {
      kind: proposal.kind,
      roles: [...selected.values()].sort(
        (left, right) =>
          right.score - left.score || compare(left.roleId, right.roleId),
      ),
      maxConcurrentWorkers: proposal.maxConcurrentWorkers,
      rationale: `${proposal.rationale} Explicit user-selected roles: ${explicitSelected}. Total proposed roles: ${selected.size}.`,
      teamDesignId: teamDesign.designId,
      coveredCapabilityIds: proposal.coveredCapabilityIds,
      uncoveredCapabilityIds: proposal.uncoveredCapabilityIds,
    };
  });

  return {
    schemaVersion: 2,
    auditFingerprint: teamDesign.auditFingerprint,
    proposals,
    teamDesign,
  };
}

function validateSelectionInputs(
  answers: IntakeAnswers,
  primitives: RoleBlueprint[],
): void {
  const primitiveIds = new Set(primitives.map(({ id }) => id));
  const availableTools = new Set(answers.availableTools);
  const customIds = new Set<string>();

  for (const custom of answers.customRoles) {
    if (primitiveIds.has(custom.id) || customIds.has(custom.id)) {
      throw new Error(`Custom role id is not unique: ${custom.id}`);
    }
    customIds.add(custom.id);
  }
  for (const id of [...answers.requiredRoles, ...answers.excludedRoles]) {
    if (!primitiveIds.has(id) && !customIds.has(id)) {
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
    const role = primitives.find((candidate) => candidate.id === id);
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

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
