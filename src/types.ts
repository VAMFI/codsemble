export type ModelProfile = "inherit" | "deep" | "balanced" | "fast";
export type ReasoningEffort =
  | "inherit"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";
export type SandboxProfile = "read-only" | "workspace-write";
export type OptimizeFor = "balanced" | "quality" | "speed" | "cost";
export type ConfigMode = "preview" | "apply-project" | "manual" | "unchanged";
export type ProposalKind =
  | "focused"
  | "recommended"
  | "extended"
  | "lean"
  | "balanced"
  | "full";

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
  inspectedFileDigests?: Array<{ path: string; sha256: string }>;
  skipped: AuditSkipSummary[];
  truncated: boolean;
  signals: AuditSignal[];
  existingCodex: ExistingCodexState;
  warnings: string[];
}

export type EvidenceKind =
  | "repository-signal"
  | "repository-path"
  | "user-goal"
  | "user-context";

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  detector: string;
  value: string;
  confidence: "low" | "medium" | "high";
  relativePaths: string[];
  contentDigest?: string | null;
  digest: string;
}

export type CapabilityKind =
  | "implementation"
  | "verification"
  | "security"
  | "delivery"
  | "documentation"
  | "operations"
  | "coordination";

export interface ProjectCapability {
  id: string;
  unitId: string;
  name: string;
  kind: CapabilityKind;
  required: boolean;
  risk: "low" | "medium" | "high";
  evidenceRefs: string[];
  goalRefs: string[];
}

export interface ProjectCapabilityMap {
  schemaVersion: 1;
  projectName: string;
  auditFingerprint: string;
  evidence: EvidenceRef[];
  capabilities: ProjectCapability[];
  gaps: string[];
  warnings: string[];
}

export interface WorkPackage {
  id: string;
  unitId: string;
  title: string;
  outcome: string;
  capabilityIds: string[];
  required: boolean;
  risk: "low" | "medium" | "high";
  scopes: string[];
  evidenceRefs: string[];
  goalRefs: string[];
  dependsOn: string[];
  validation: string[];
}

export interface GeneratedRoleSpec {
  id: string;
  name: string;
  summary: string;
  mission: string;
  responsibilities: string[];
  deliverables: string[];
  qualityGates: string[];
  allowedPaths: string[];
  prohibitedActions: string[];
  requiredTools: string[];
  optionalTools: string[];
  modelProfile: ModelProfile;
  reasoningEffort: ReasoningEffort;
  sandbox: SandboxProfile;
  workPackageIds: string[];
  evidenceRefs: string[];
  sourcePrimitives: string[];
  permissionProfile: string;
  externalWritePolicy: "forbidden";
  costClass: "low" | "medium" | "high";
}

export interface TeamDesignProposal {
  kind: "focused" | "recommended" | "extended";
  roleIds: string[];
  workPackageIds: string[];
  coveredCapabilityIds: string[];
  uncoveredCapabilityIds: string[];
  maxConcurrentWorkers: number;
  rationale: string;
}

export interface TeamDesign {
  schemaVersion: 2;
  designId: string;
  auditFingerprint: string;
  compiler: {
    name: "codsemble-project-capability-compiler";
    version: "1.0.0";
    mode: "deterministic";
  };
  capabilityMap: ProjectCapabilityMap;
  workPackages: WorkPackage[];
  roles: GeneratedRoleSpec[];
  proposals: TeamDesignProposal[];
  uncoveredRequirements: string[];
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
  configAdapter: "agents-v1" | null;
  prohibitedActions: string[];
  requiredRoles: string[];
  excludedRoles: string[];
  customRoles: CustomRoleInput[];
  availableTools: string[];
  modelCapabilities: Array<{
    id: string;
    supportedReasoningEfforts: string[];
  }>;
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
  kind: ProposalKind;
  roles: RoleScore[];
  maxConcurrentWorkers: number;
  rationale: string;
  teamDesignId?: string;
  coveredCapabilityIds?: string[];
  uncoveredCapabilityIds?: string[];
}

export interface RecommendationResult {
  schemaVersion: 1 | 2;
  auditFingerprint: string;
  proposals: TeamProposal[];
  teamDesign?: TeamDesign;
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
  source: "catalog" | "custom" | "generated";
  workPackageIds?: string[];
  evidenceRefs?: string[];
}

export interface FilePreimage {
  relativePath: string;
  exists: boolean;
  sha256: string | null;
  mode: number | null;
}

export interface PlannedFile {
  relativePath: string;
  action: "create" | "update" | "delete" | "verify";
  beforeSha256: string | null;
  afterSha256: string | null;
  content: string | null;
}

export interface ConcurrencyPlan {
  requestedWorkers: number;
  projectCurrentValue: number | null;
  adapter: "agents-v1" | null;
  configMode: ConfigMode;
  willApply: boolean;
  manualSnippet: string | null;
  warning?: string;
}

export interface TeamPlan {
  schemaVersion: 1;
  planId: string;
  confirmationId: string;
  auditFingerprint: string;
  teamDesignId?: string;
  teamDesignDigest?: string;
  evidencePreconditions?: Array<{
    id: string;
    digest: string;
    relativePaths: string[];
  }>;
  lineagePreconditions?: FilePreimage[];
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
    afterSha256: string | null;
    backupRelativePath: string | null;
    quarantineRelativePath: string | null;
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
