import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = "plugins/codsemble";
const files = await walk(root);
const digest = createHash("sha256");
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const content = await readFile(file);
  digest.update(relative, "utf8");
  digest.update("\0");
  digest.update(String(content.length), "utf8");
  digest.update("\0");
  digest.update(content);
  digest.update("\0");
}
console.log(
  JSON.stringify({
    algorithm: "sha256(path-nul-length-nul-content-nul)",
    root,
    fileCount: files.length,
    sha256: digest.digest("hex"),
  }),
);

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walk(candidate)));
    } else if (entry.isFile()) {
      result.push(candidate);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}
