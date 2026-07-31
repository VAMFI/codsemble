import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { roleCatalogSchema } from "../src/schemas.js";
import type { RoleBlueprint } from "../src/types.js";

const catalogPath = new URL(
  "../plugins/codsemble/catalog/roles.json",
  import.meta.url,
);

const expectedFamilies = new Map([
  ["Orchestration and Governance", 9],
  ["Architecture and Engineering", 20],
  ["Quality, Security, and Reliability", 14],
  ["Data and AI", 12],
  ["Product, Design, and Research", 12],
  ["Documentation, DevRel, and Support", 10],
  ["Growth, Marketing, and Revenue", 12],
  ["Delivery, Operations, Legal, and Finance", 12],
  ["Domain Specialist Packs", 10],
]);

async function loadCatalog(): Promise<RoleBlueprint[]> {
  const input: unknown = JSON.parse(await readFile(catalogPath, "utf8"));
  return roleCatalogSchema.parse(input);
}

describe("role catalog", () => {
  it("contains exactly 111 schema-valid roles", async () => {
    const roles = await loadCatalog();
    expect(roles).toHaveLength(111);
    expect(roles.every((role) => role.catalogVersion === "0.1.0")).toBe(true);
  });

  it("has the agreed nine-family distribution", async () => {
    const roles = await loadCatalog();
    const actual = new Map<string, number>();
    for (const role of roles) {
      actual.set(role.family, (actual.get(role.family) ?? 0) + 1);
    }
    expect(actual).toEqual(expectedFamilies);
  });

  it("keeps identifiers and semantic ownership distinct", async () => {
    const roles = await loadCatalog();
    for (const field of ["id", "name", "summary", "jobToBeDone"] as const) {
      expect(new Set(roles.map((role) => role[field])).size).toBe(roles.length);
    }
  });

  it("routes every role from evidence and explicit goal tags", async () => {
    const roles = await loadCatalog();
    for (const role of roles) {
      expect(role.repoSignals.length, role.id).toBeGreaterThan(0);
      expect(role.goalTags.length, role.id).toBeGreaterThan(0);
      expect(role.useWhen.length, role.id).toBeGreaterThanOrEqual(2);
      expect(role.avoidWhen.length, role.id).toBeGreaterThanOrEqual(2);
      expect(role.repoSignals.every((signal) => /^(dir|file|signal):/.test(signal)), role.id).toBe(true);
    }
  });

  it("uses bounded, safe-by-default permissions", async () => {
    const roles = await loadCatalog();
    for (const role of roles) {
      expect(["read-only", "workspace-write"], role.id).toContain(role.defaultSandbox);
      expect(role.externalWritePolicy, role.id).toBe("confirm");
      expect(role.requiredTools, role.id).toEqual(["workspace-read"]);
      expect(role.permissionProfile, role.id).not.toMatch(/danger-full-access/i);
      expect(role.maximumFanout, role.id).toBeLessThanOrEqual(8);
      if (role.defaultSandbox === "read-only") {
        expect(role.optionalTools, role.id).not.toContain("workspace-edit");
      }
    }
  });

  it("includes complete handoff and quality metadata", async () => {
    const roles = await loadCatalog();
    for (const role of roles) {
      expect(role.responsibilities.length, role.id).toBeGreaterThanOrEqual(3);
      expect(role.deliverables.length, role.id).toBeGreaterThanOrEqual(2);
      expect(role.handoffs.length, role.id).toBeGreaterThan(0);
      expect(role.qualityGates.length, role.id).toBeGreaterThanOrEqual(2);
      expect(role.permissionProfile.length, role.id).toBeGreaterThan(20);
    }
  });
});
