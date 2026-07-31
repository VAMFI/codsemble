export type ModelProfile = "inherit" | "deep" | "balanced" | "fast";
export type ReasoningEffort = "inherit" | "low" | "medium" | "high" | "xhigh";
export type SandboxProfile = "read-only" | "workspace-write";
export type OptimizeFor = "balanced" | "quality" | "speed" | "cost";
export type ConfigMode = "preview" | "apply-project" | "manual" | "unchanged";

export interface RoleBlueprint {
  id: string;
  name: string;
  family: string;
  summary: string;
  jobToBeDone: string;
  useWhen: string[];
  avoidWhen: string[];
  responsibilities: string[];
  deliverables: string[];
  repoSignals: string[];
  goalTags: string[];
  defaultModelProfile: ModelProfile;
  defaultReasoningEffort: ReasoningEffort;
  defaultSandbox: SandboxProfile;
  requiredTools: string[];
  optionalTools: string[];
  dependencies: string[];
  conflicts: string[];
  handoffs: string[];
  qualityGates: string[];
  permissionProfile: string;
  externalWritePolicy: "forbidden" | "confirm";
  costClass: "low" | "medium" | "high";
  maximumFanout: number;
  catalogVersion: string;
}

export interface AuditEvidence {
  path: string;
  detector: string;
  detail: string;
}

export interface AuditSignal {
  key: string;
  values: string[];
  confidence: "low" | "medium" | "high";
  evidence: AuditEvidence[];
}

export interface AuditSkipSummary {
  reason: string;
  count: number;
}

export interface ExistingCodexState {
  agentsMd: boolean;
  projectConfig: boolean;
  agentFiles: string[];
  teamManifest: boolean;
}

export interface AuditReport {
  schemaVersion: 1;
  workspace: ".";
  workspaceName: string;
  gitRepository: boolean;
  dirtyWorktree: boolean | null;
  inspectedFiles: string[];
  skipped: AuditSkipSummary[];
  truncated: boolean;
  signals: AuditSignal[];
  existingCodex: ExistingCodexState;
  warnings: string[];
}

export interface CustomRoleInput {
  id: string;
  name: string;
  jobToBeDone: string;
  successCriteria: string[];
  allowedPaths: string[];
  prohibitedActions: string[];
  modelProfile: ModelProfile;
  reasoningEffort: ReasoningEffort;
  sandbox: SandboxProfile;
}

export interface IntakeAnswers {
  goals: string[];
  projectStage: "idea" | "prototype" | "active" | "production" | "legacy";
  desiredRoleCount: number;
  maxConcurrentWorkers: number;
  optimizeFor: OptimizeFor;
  configMode: ConfigMode;
  prohibitedActions: string[];
  requiredRoles: string[];
  excludedRoles: string[];
  customRoles: CustomRoleInput[];
  verifiedModels: Partial<Record<ModelProfile, string>>;
  allowHighConcurrency: boolean;
}

export interface RoleScore {
  roleId: string;
  score: number;
  reasons: string[];
  warnings: string[];
}

export interface TeamProposal {
  kind: "lean" | "balanced" | "full";
  roles: RoleScore[];
  maxConcurrentWorkers: number;
  rationale: string;
}

export interface RecommendationResult {
  schemaVersion: 1;
  auditFingerprint: string;
  proposals: TeamProposal[];
}

export interface ResolvedRole {
  id: string;
  name: string;
  description: string;
  developerInstructions: string;
  modelProfile: ModelProfile;
  model?: string;
  reasoningEffort?: Exclude<ReasoningEffort, "inherit">;
  sandbox: SandboxProfile;
}

export interface FilePreimage {
  relativePath: string;
  exists: boolean;
  sha256: string | null;
  mode: number | null;
}

export interface PlannedFile {
  relativePath: string;
  action: "create" | "update";
  beforeSha256: string | null;
  afterSha256: string;
  content: string;
}

export interface ConcurrencyPlan {
  requestedWorkers: number;
  effectiveCurrentValue: number | null;
  adapter: "agents-v1" | "multi-agent-v2";
  configMode: ConfigMode;
  warning?: string;
}

export interface TeamPlan {
  schemaVersion: 1;
  planId: string;
  auditFingerprint: string;
  roles: ResolvedRole[];
  concurrency: ConcurrencyPlan;
  preimages: FilePreimage[];
  files: PlannedFile[];
}

export interface TransactionRecord {
  schemaVersion: 1;
  transactionId: string;
  planId: string;
  createdAt: string;
  files: Array<{
    relativePath: string;
    beforeSha256: string | null;
    afterSha256: string;
    backupRelativePath: string | null;
    mode: number | null;
  }>;
}

export interface DoctorCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  details?: string[];
}

export interface DoctorReport {
  schemaVersion: 1;
  overallStatus: "pass" | "warn" | "fail";
  checks: DoctorCheck[];
}
