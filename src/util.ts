import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

export function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(value)) {
    throw new Error(`${label} must match ^[a-z][a-z0-9_-]{1,63}$`);
  }
}

export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export async function assertWorkspaceRoot(workspace: string): Promise<string> {
  const resolved = await realpath(workspace);
  const stats = await lstat(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Workspace must be a real directory, not a symlink");
  }
  return resolved;
}

export async function assertContainedPath(
  workspaceRoot: string,
  candidate: string,
): Promise<string> {
  const absolute = path.resolve(workspaceRoot, candidate);
  const relative = path.relative(workspaceRoot, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path escapes workspace: ${candidate}`);
  }
  return absolute;
}

export function escapeTomlBasicString(value: string): string {
  return JSON.stringify(value);
}

export function escapeTomlMultiline(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").replace(/"""/g, '\\"\\"\\"');
  return `"""${normalized.endsWith("\n") ? normalized : `${normalized}\n`}"""`;
}

export function managedBlock(
  startMarker: string,
  endMarker: string,
  body: string,
): string {
  return `${startMarker}\n${body.trim()}\n${endMarker}`;
}
