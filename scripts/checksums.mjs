import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputPath = "artifacts/CHECKSUMS.sha256";
const checking = process.argv.includes("--check");
const current = await readFile(outputPath, "utf8").catch(() => "");
const manifestEntries = parseManifest(current);
const files = await sourcePayloadFiles();
if (checking) {
  const listed = manifestEntries.map(({ file }) => file);
  if (
    listed.length !== files.length ||
    listed.some((file, index) => file !== files[index])
  ) {
    console.error(`${outputPath} has an incomplete or unexpected path set`);
    process.exitCode = 1;
    process.exit();
  }
}
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
    ["ls-files", "-z", "--cached"],
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

async function sourcePayloadFiles() {
  try {
    return await trackedSourceFiles();
  } catch {
    return walkPayload(".");
  }
}

async function walkPayload(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === ".git" ||
      entry.name === "node_modules" ||
      entry.name === ".DS_Store"
    ) {
      continue;
    }
    const relative = path.posix.join(
      directory === "." ? "" : directory,
      entry.name,
    );
    if (relative === outputPath) continue;
    if (entry.isDirectory()) {
      result.push(...(await walkPayload(relative)));
    } else if (entry.isFile()) {
      result.push(relative);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function parseManifest(input) {
  if (input === "") return [];
  return input
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match) {
        throw new Error(`Invalid checksum manifest line: ${line}`);
      }
      return { digest: match[1], file: match[2] };
    });
}
