import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const pluginRoot = "plugins/codsemble";
const outputPath = "artifacts/codsemble-0.2.0-plugin.tgz";
const checking = process.argv.includes("--check");

const files = await walk(pluginRoot);
const chunks = [];
for (const file of files) {
  const content = await readFile(file);
  assertSafePayload(file, content);
  chunks.push(tarHeader(file, content.length, file.endsWith(".mjs") ? 0o755 : 0o644));
  chunks.push(content);
  chunks.push(Buffer.alloc(padding(content.length)));
}
chunks.push(Buffer.alloc(1024));
const archive = gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
const digest = createHash("sha256").update(archive).digest("hex");

if (checking) {
  const current = await readFile(outputPath).catch(() => Buffer.alloc(0));
  if (!current.equals(archive)) {
    console.error(`${outputPath} is stale`);
    process.exitCode = 1;
  } else {
    console.log(`Verified deterministic ${files.length}-file plugin archive ${digest}.`);
  }
} else {
  await writeFile(outputPath, archive);
  console.log(`Wrote deterministic ${files.length}-file plugin archive ${digest}.`);
}

async function walk(directory) {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => compare(left.name, right.name),
  )) {
    const candidate = path.posix.join(directory, entry.name);
    const metadata = await lstat(candidate);
    if (entry.isSymbolicLink() || !metadata.isFile() && !metadata.isDirectory()) {
      throw new Error(`Plugin payload contains an unsupported entry: ${candidate}`);
    }
    if (metadata.isDirectory()) {
      result.push(...(await walk(candidate)));
    } else {
      result.push(candidate);
    }
  }
  return result.sort(compare);
}

function tarHeader(name, size, mode) {
  const normalized = name.replaceAll("\\", "/");
  if (Buffer.byteLength(normalized) > 100) {
    throw new Error(`Plugin archive path exceeds the portable tar limit: ${name}`);
  }
  const header = Buffer.alloc(512);
  writeText(header, normalized, 0, 100);
  writeOctal(header, mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeText(header, "ustar\0", 257, 6);
  writeText(header, "00", 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeText(header, checksumText, 148, 6);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeText(buffer, value, offset, length) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`Tar field overflow: ${value}`);
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, value, offset, length) {
  const text = value.toString(8).padStart(length - 1, "0");
  if (text.length >= length) throw new Error(`Tar numeric field overflow: ${value}`);
  writeText(buffer, `${text}\0`, offset, length);
}

function padding(size) {
  return (512 - size % 512) % 512;
}

function assertSafePayload(file, content) {
  if (file.includes("..") || path.isAbsolute(file)) {
    throw new Error(`Unsafe plugin payload path: ${file}`);
  }
  if (content.includes(Buffer.from("/Users/")) || content.includes(Buffer.from("/Volumes/DevData/"))) {
    throw new Error(`Plugin payload contains an absolute developer path: ${file}`);
  }
  const text = content.toString("utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    throw new Error(`Plugin payload contains private-key material: ${file}`);
  }
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
