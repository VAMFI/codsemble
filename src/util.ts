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
  const windowsStem = value.split(/[._-]/, 1)[0]?.toLowerCase();
  if (
    windowsStem !== undefined &&
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(windowsStem)
  ) {
    throw new Error(`${label} is reserved on Windows`);
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

export async function assertNoSymlinkAncestors(
  workspaceRoot: string,
  candidate: string,
): Promise<void> {
  const contained = await assertContainedPath(workspaceRoot, candidate);
  const relativeDirectory = path.relative(
    workspaceRoot,
    path.dirname(contained),
  );
  let cursor = workspaceRoot;
  for (const part of relativeDirectory === "" ? [] : relativeDirectory.split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const stats = await lstat(cursor);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Unsafe path ancestor: ${cursor}`);
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }
}

export function escapeTomlBasicString(value: string): string {
  return JSON.stringify(value);
}

export function escapeTomlMultiline(value: string): string {
  return JSON.stringify(value.replace(/\r\n?/g, "\n"));
}

export function managedBlock(
  startMarker: string,
  endMarker: string,
  body: string,
): string {
  return `${startMarker}\n${body.trim()}\n${endMarker}`;
}
