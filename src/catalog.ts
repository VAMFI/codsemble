import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { roleCatalogSchema } from "./schemas.js";
import type { RoleBlueprint } from "./types.js";

const CATALOG_RELATIVE_PATH = path.join(
  "plugins",
  "codsemble",
  "catalog",
  "roles.json",
);

/**
 * Load and validate the immutable role catalog. Catalog loading is deliberately
 * filesystem-only: initialization must not depend on a registry or network.
 */
export async function loadCatalog(
  catalogPath?: string,
): Promise<RoleBlueprint[]> {
  const resolvedPath = catalogPath
    ? path.resolve(catalogPath)
    : await findDefaultCatalog();
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(resolvedPath, "utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load role catalog at ${resolvedPath}: ${detail}`);
  }

  const catalog = roleCatalogSchema.parse(parsed);
  const ids = new Set<string>();
  for (const role of catalog) {
    if (ids.has(role.id)) {
      throw new Error(`Role catalog contains duplicate id: ${role.id}`);
    }
    ids.add(role.id);
  }

  for (const role of catalog) {
    for (const referencedId of [
      ...role.dependencies,
      ...role.conflicts,
      ...role.handoffs,
    ]) {
      if (!ids.has(referencedId)) {
        throw new Error(
          `Role ${role.id} references unknown role ${referencedId}`,
        );
      }
    }
    if (role.conflicts.includes(role.id)) {
      throw new Error(`Role ${role.id} cannot conflict with itself`);
    }
  }

  return catalog;
}

async function findDefaultCatalog(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), CATALOG_RELATIVE_PATH),
    // Bundled plugin CLI: plugins/codsemble/scripts/codsemble.mjs.
    path.resolve(moduleDirectory, "..", "catalog", "roles.json"),
    path.resolve(moduleDirectory, "..", CATALOG_RELATIVE_PATH),
    path.resolve(moduleDirectory, "..", "..", CATALOG_RELATIVE_PATH),
  ];

  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Try the next deterministic local location.
    }
  }

  throw new Error(
    `Unable to find ${CATALOG_RELATIVE_PATH}; pass an explicit catalog path`,
  );
}
