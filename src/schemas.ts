import { z } from "zod";

const modelProfile = z.enum(["inherit", "deep", "balanced", "fast"]);
const reasoningEffort = z.enum(["inherit", "low", "medium", "high", "xhigh"]);
const sandboxProfile = z.enum(["read-only", "workspace-write"]);

export const roleBlueprintSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    name: z.string().min(2).max(80),
    family: z.string().min(2).max(80),
    summary: z.string().min(10).max(240),
    jobToBeDone: z.string().min(10).max(500),
    useWhen: z.array(z.string().min(2)).min(1),
    avoidWhen: z.array(z.string().min(2)).min(1),
    responsibilities: z.array(z.string().min(2)).min(1),
    deliverables: z.array(z.string().min(2)).min(1),
    repoSignals: z.array(z.string().regex(/^[a-z0-9:_-]+$/)),
    goalTags: z.array(z.string().regex(/^[a-z0-9:_-]+$/)),
    defaultModelProfile: modelProfile,
    defaultReasoningEffort: reasoningEffort,
    defaultSandbox: sandboxProfile,
    requiredTools: z.array(z.string()),
    optionalTools: z.array(z.string()),
    dependencies: z.array(z.string()),
    conflicts: z.array(z.string()),
    handoffs: z.array(z.string()),
    qualityGates: z.array(z.string()).min(1),
    permissionProfile: z.string().min(2),
    externalWritePolicy: z.enum(["forbidden", "confirm"]),
    costClass: z.enum(["low", "medium", "high"]),
    maximumFanout: z.number().int().min(0).max(8),
    catalogVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  })
  .strict();

export const roleCatalogSchema = z.array(roleBlueprintSchema).length(111);

export const customRoleInputSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    name: z.string().min(2).max(80),
    jobToBeDone: z.string().min(10).max(500),
    successCriteria: z.array(z.string().min(2)).min(1),
    allowedPaths: z.array(z.string()),
    prohibitedActions: z.array(z.string()),
    modelProfile,
    reasoningEffort,
    sandbox: sandboxProfile,
  })
  .strict();

export const intakeAnswersSchema = z
  .object({
    goals: z.array(z.string().regex(/^[a-z0-9:_-]+$/)).min(1),
    projectStage: z.enum(["idea", "prototype", "active", "production", "legacy"]),
    desiredRoleCount: z.number().int().min(1).max(40),
    maxConcurrentWorkers: z.number().int().min(1).max(111),
    optimizeFor: z.enum(["balanced", "quality", "speed", "cost"]),
    configMode: z.enum(["preview", "apply-project", "manual", "unchanged"]),
    prohibitedActions: z.array(z.string()),
    requiredRoles: z.array(z.string()),
    excludedRoles: z.array(z.string()),
    customRoles: z.array(customRoleInputSchema).max(20),
    verifiedModels: z
      .object({
        inherit: z.string().optional(),
        deep: z.string().optional(),
        balanced: z.string().optional(),
        fast: z.string().optional(),
      })
      .strict(),
    allowHighConcurrency: z.boolean(),
  })
  .strict()
  .superRefine((answers, context) => {
    if (answers.maxConcurrentWorkers > 16 && !answers.allowHighConcurrency) {
      context.addIssue({
        code: "custom",
        message:
          "Concurrency above 16 requires allowHighConcurrency=true after an explicit warning",
        path: ["maxConcurrentWorkers"],
      });
    }
  });
