import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const lockPath = "package-lock.json";
const outputPath = "artifacts/codsemble-0.1.0-rc.sbom.cdx.json";
const checking = process.argv.includes("--check");
const lockBytes = await readFile(lockPath);
const lock = JSON.parse(lockBytes.toString("utf8"));
const root = lock.packages?.[""];
if (!root || typeof root.name !== "string" || typeof root.version !== "string") {
  throw new Error("package-lock.json is missing root package metadata");
}

const components = Object.entries(lock.packages)
  .filter(([location]) => location !== "")
  .map(([location, entry]) => {
    const name = packageName(location);
    if (typeof entry.version !== "string") {
      throw new Error(`Locked package has no version: ${location}`);
    }
    return {
      "bom-ref": `${location}@${entry.version}`,
      type: "library",
      name,
      version: entry.version,
      scope: entry.optional ? "optional" : "required",
      purl: `pkg:npm/${purlName(name)}@${entry.version}`,
      properties: [
        {
          name: "codsemble:lockfile-path",
          value: location,
        },
        {
          name: "codsemble:development",
          value: String(Boolean(entry.dev)),
        },
      ],
    };
  })
  .sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));

const document = {
  $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: deterministicSerial(lockBytes),
  version: 1,
  metadata: {
    tools: {
      components: [
        {
          type: "application",
          name: "codsemble-lockfile-sbom",
          version: "1",
        },
      ],
    },
    component: {
      "bom-ref": `${root.name}@${root.version}`,
      type: "application",
      name: root.name,
      version: root.version,
      purl: `pkg:npm/${purlName(root.name)}@${root.version}`,
    },
    properties: [
      {
        name: "codsemble:source",
        value: "complete package-lock.json packages map",
      },
    ],
  },
  components,
};
const expected = `${JSON.stringify(document, null, 2)}\n`;

if (checking) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== expected) {
    console.error(`${outputPath} is stale`);
    process.exitCode = 1;
  } else {
    console.log(`Verified deterministic SBOM with ${components.length} components.`);
  }
} else {
  await writeFile(outputPath, expected, "utf8");
  console.log(`Wrote deterministic SBOM with ${components.length} components.`);
}

function packageName(location) {
  const marker = "node_modules/";
  const index = location.lastIndexOf(marker);
  if (index < 0) throw new Error(`Unexpected lockfile package path: ${location}`);
  return location.slice(index + marker.length);
}

function purlName(name) {
  if (!name.startsWith("@")) return encodeURIComponent(name);
  const slash = name.indexOf("/");
  return `${encodeURIComponent(name.slice(0, slash))}/${encodeURIComponent(
    name.slice(slash + 1),
  )}`;
}

function deterministicSerial(bytes) {
  const hex = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13)}`;
  const variant = (
    (Number.parseInt(versioned[16], 16) & 0x3) |
    0x8
  ).toString(16);
  const value = `${versioned.slice(0, 16)}${variant}${versioned.slice(17)}`;
  return `urn:uuid:${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(
    12,
    16,
  )}-${value.slice(16, 20)}-${value.slice(20)}`;
}
