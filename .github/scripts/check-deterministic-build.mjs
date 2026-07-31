import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputs = [
  "plugins/codsemble/scripts/codsemble.mjs",
];

async function fingerprints() {
  const result = new Map();
  for (const relative of outputs) {
    const content = await readFile(path.join(root, relative));
    result.set(relative, createHash("sha256").update(content).digest("hex"));
  }
  return result;
}

const before = await fingerprints();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npm, ["run", "build"], { cwd: root, stdio: "inherit" });
const after = await fingerprints();

for (const relative of outputs) {
  if (before.get(relative) !== after.get(relative)) {
    console.error(`Non-deterministic build output: ${relative}`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) {
  console.log(`Deterministic build verified for ${outputs.length} files.`);
  execFileSync(process.execPath, [path.join(root, outputs[0]), "--help"], {
    cwd: root,
    stdio: "pipe",
  });
  console.log("Bundled CLI smoke test passed.");
}
