import { readFile } from "node:fs/promises";

const path = new URL("../plugins/codsemble/catalog/roles.json", import.meta.url);
const roles = JSON.parse(await readFile(path, "utf8"));
const ids = new Set(roles.map((role) => role.id));

if (roles.length !== 111) {
  throw new Error(`Expected exactly 111 roles, found ${roles.length}`);
}
if (ids.size !== roles.length) {
  throw new Error("Role ids must be unique");
}

process.stdout.write(`catalog ok: ${roles.length} unique roles\n`);
