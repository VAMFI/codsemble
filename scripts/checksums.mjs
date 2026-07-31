import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputPath = "artifacts/CHECKSUMS.sha256";
const checking = process.argv.includes("--check");
const current = await readFile(outputPath, "utf8").catch(() => "");
const files = checking
  ? current
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(66))
  : await trackedSourceFiles();
const lines = [];
for (const file of files) {
  const digest = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  lines.push(`${digest}  ${file}`);
}
const expected = `${lines.join("\n")}\n`;

if (checking) {
  if (current !== expected) {
    console.error(`${outputPath} is stale`);
    process.exitCode = 1;
  } else {
    console.log(`Verified ${files.length} source payload checksums.`);
  }
} else {
  await writeFile(outputPath, expected, "utf8");
  console.log(`Wrote ${files.length} source payload checksums.`);
}

async function trackedSourceFiles() {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout
    .toString("utf8")
    .split("\0")
    .filter(
      (file) =>
        file.length > 0 &&
        file !== outputPath &&
        !file.startsWith("node_modules/"),
    )
    .sort((left, right) => left.localeCompare(right));
}
