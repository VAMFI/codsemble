import { z } from "zod";

import { AGENT_PATH_PATTERN } from "./lifecycle.js";
import { MAX_PROJECT_WORKER_CEILING } from "./schemas.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const generatedManifestSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    generator: z
      .object({ name: z.literal("codsemble"), version: z.string().min(1) })
      .strict(),
    catalogVersion: z.string().min(1),
    planId: z.string().regex(/^[a-f0-9]{24}$/),
    auditFingerprint: digestSchema,
    proposal: z
      .object({
        kind: z.enum([
          "lean",
          "balanced",
          "full",
          "focused",
          "recommended",
          "extended",
        ]),
        maxConcurrentWorkers: z
          .number()
          .int()
          .min(1)
          .max(MAX_PROJECT_WORKER_CEILING),
      })
      .strict(),
    capabilities: z
      .object({
        configAdapter: z.literal("agents-v1").nullable(),
        modelCapabilities: z.array(
          z
            .object({
              id: z.string().min(1).max(200).regex(/^[^\s]+$/),
              supportedReasoningEfforts: z.array(
                z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/),
              ),
            })
            .strict(),
        ),
        availableTools: z.array(
          z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
        ),
      })
      .strict(),
    roles: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
          name: z.string().min(1),
          modelProfile: z.enum(["inherit", "deep", "balanced", "fast"]),
          model: z.string().min(1).max(200).regex(/^[^\s]+$/).optional(),
          reasoningEffort: z
            .enum(["low", "medium", "high", "xhigh"])
            .optional(),
          sandbox: z.enum(["read-only", "workspace-write"]),
          source: z.enum(["custom", "catalog", "generated"]),
          workPackageIds: z
            .array(z.string().regex(/^wp-[a-z0-9-]{1,96}$/))
            .optional(),
          evidenceRefs: z
            .array(z.string().regex(/^(?:ev|goal|context)-[a-f0-9]{16}$/))
            .optional(),
        })
        .strict(),
    ),
    design: z
      .object({
        schemaVersion: z.literal(2),
        designId: z.string().regex(/^[a-f0-9]{24}$/),
        digest: digestSchema,
        capabilityMapDigest: digestSchema,
        workPackagesDigest: digestSchema,
        policyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
      })
      .strict()
      .optional(),
    ownership: z
      .object({
        agentsBlock: z
          .object({
            path: z.literal("AGENTS.md"),
            start: z.literal("<!-- codsemble:start -->"),
            end: z.literal("<!-- codsemble:end -->"),
          })
          .strict(),
        agentFiles: z
          .array(z.string().regex(AGENT_PATH_PATTERN))
          .refine((paths) => new Set(paths).size === paths.length, {
            message: "agentFiles must be unique",
          }),
        agentSha256: z.record(z.string().regex(AGENT_PATH_PATTERN), digestSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ownedPaths = [...manifest.ownership.agentFiles].sort();
    const hashedPaths = Object.keys(manifest.ownership.agentSha256).sort();
    if (JSON.stringify(ownedPaths) !== JSON.stringify(hashedPaths)) {
      context.addIssue({
        code: "custom",
        message: "agent ownership hashes must exactly match agentFiles",
      });
    }
    if (manifest.schemaVersion === 1) {
      if (
        manifest.design !== undefined ||
        !["lean", "balanced", "full"].includes(manifest.proposal.kind) ||
        manifest.roles.some(
          (role) =>
            role.source === "generated" ||
            role.workPackageIds !== undefined ||
            role.evidenceRefs !== undefined,
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "schemaVersion 1 manifest contains v2 team-design fields",
        });
      }
    } else if (
      manifest.design === undefined ||
      !["focused", "recommended", "extended"].includes(manifest.proposal.kind) ||
      manifest.roles.some(
        (role) =>
          role.source === "generated" &&
          (role.workPackageIds === undefined || role.evidenceRefs === undefined),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "schemaVersion 2 manifest is missing admitted team-design bindings",
      });
    }
  });
