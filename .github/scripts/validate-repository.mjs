import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const failures = [];

const requiredDocs = [
  "README.md",
  "LICENSE",
  "NOTICE",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CHANGELOG.md",
  "ROADMAP.md",
  "GOVERNANCE.md",
  "docs/PRIVACY.md",
  "docs/CONFIG_SAFETY.md",
  "docs/USAGE.md",
  "docs/VALIDATION.md",
];

const requiredFiles = [
  ...requiredDocs,
  "plugins/codsemble/scripts/codsemble.mjs",
];

for (const relative of requiredFiles) {
  try {
    const info = await stat(path.join(root, relative));
    if (!info.isFile()) failures.push(`${relative} is not a file`);
  } catch {
    failures.push(`${relative} is missing`);
  }
}

const skillsRoot = path.join(root, "plugins", "codsemble", "skills");
const expectedSkills = [
  "initialize-team",
  "rollback-team",
  "team-doctor",
  "update-team",
];
const foundSkills = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (JSON.stringify(foundSkills) !== JSON.stringify(expectedSkills)) {
  failures.push(
    `expected skills ${expectedSkills.join(", ")}, found ${foundSkills.join(", ")}`,
  );
}

for (const skill of foundSkills) {
  const skillPath = path.join(skillsRoot, skill, "SKILL.md");
  const source = await readFile(skillPath, "utf8");
  const match = source.match(
    /^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n/,
  );
  if (!match) {
    failures.push(`${skill}/SKILL.md has invalid frontmatter`);
    continue;
  }
  if (match[1] !== skill) {
    failures.push(`${skill}/SKILL.md name is ${match[1]}`);
  }
  if (match[2].length < 40 || match[2].length > 500) {
    failures.push(`${skill}/SKILL.md description length is invalid`);
  }
  if (!source.includes("<plugin-root>/scripts/codsemble.mjs")) {
    failures.push(`${skill}/SKILL.md does not use the bundled CLI`);
  }
  if (source.includes("~/.codex/config.toml") && !source.match(/never|Never/)) {
    failures.push(`${skill}/SKILL.md may permit global config mutation`);
  }

  const uiPath = path.join(skillsRoot, skill, "agents", "openai.yaml");
  const ui = await readFile(uiPath, "utf8");
  if (!ui.includes(`$${skill}`)) {
    failures.push(`${skill}/agents/openai.yaml lacks a skill-qualified prompt`);
  }
}

const textFiles = [
  ...requiredDocs,
  ...foundSkills.flatMap((skill) => [
    `plugins/codsemble/skills/${skill}/SKILL.md`,
    `plugins/codsemble/skills/${skill}/agents/openai.yaml`,
  ]),
];

for (const relative of textFiles) {
  const source = await readFile(path.join(root, relative), "utf8");
  if (/\[(?:TODO|FIXME)(?::[^\]]*)?\]/i.test(source)) {
    failures.push(`${relative} contains an unresolved placeholder`);
  }
  const absoluteLeak =
    /\/(?:Users|home)\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/;
  if (absoluteLeak.test(source)) {
    failures.push(`${relative} contains an absolute personal path`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${foundSkills.length} skills and ${requiredDocs.length} documents.`);
}
