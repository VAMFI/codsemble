import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import ignore, { type Ignore } from "ignore";

import type {
  AuditEvidence,
  AuditReport,
  AuditSignal,
  AuditSkipSummary,
  ExistingCodexState,
} from "./types.js";
import { assertContainedPath, assertWorkspaceRoot, toPosix } from "./util.js";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_DEPTH = 12;
const HARD_MAX_FILES = 10_000;
const HARD_MAX_FILE_BYTES = 1024 * 1024;
const HARD_MAX_DEPTH = 32;
const PROBE_BYTES = 8 * 1024;

const GENERATED_DIRECTORIES = new Set([
  ".cache",
  ".dart_tool",
  ".gradle",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".pytest_cache",
  ".terraform",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "deriveddata",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".class",
  ".dmg",
  ".doc",
  ".docx",
  ".exe",
  ".gif",
  ".gz",
  ".heic",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".png",
  ".pyc",
  ".so",
  ".tar",
  ".tgz",
  ".ttf",
  ".wav",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".zip",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".dart",
  ".ex",
  ".exs",
  ".go",
  ".gradle",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".md",
  ".mjs",
  ".mts",
  ".php",
  ".plist",
  ".properties",
  ".proto",
  ".py",
  ".rb",
  ".rs",
  ".scala",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

const ALLOWED_BASENAMES = new Set([
  ".dockerignore",
  ".gitignore",
  "agents.md",
  "brewfile",
  "build.gradle",
  "build.gradle.kts",
  "cargo.toml",
  "cmakelists.txt",
  "code_of_conduct",
  "code_of_conduct.md",
  "contributing",
  "contributing.md",
  "dockerfile",
  "gemfile",
  "go.mod",
  "go.sum",
  "gradlew",
  "justfile",
  "license",
  "license.md",
  "makefile",
  "package-lock.json",
  "package.json",
  "package.swift",
  "pnpm-lock.yaml",
  "podfile",
  "pom.xml",
  "pubspec.lock",
  "pubspec.yaml",
  "pyproject.toml",
  "readme",
  "readme.md",
  "requirements.txt",
  "security.md",
  "settings.gradle",
  "settings.gradle.kts",
  "tsconfig.json",
  "vercel.json",
  "yarn.lock",
]);

const MANIFEST_DETECTORS: ReadonlyArray<{
  pattern: RegExp;
  manifest: string;
  stack: string;
}> = [
  { pattern: /(^|\/)package\.json$/i, manifest: "npm", stack: "nodejs" },
  { pattern: /(^|\/)tsconfig(?:\.[^/]+)?\.json$/i, manifest: "typescript-config", stack: "typescript" },
  { pattern: /(^|\/)pyproject\.toml$/i, manifest: "pyproject", stack: "python" },
  { pattern: /(^|\/)requirements[^/]*\.txt$/i, manifest: "python-requirements", stack: "python" },
  { pattern: /(^|\/)cargo\.toml$/i, manifest: "cargo", stack: "rust" },
  { pattern: /(^|\/)go\.mod$/i, manifest: "go-modules", stack: "go" },
  { pattern: /(^|\/)pom\.xml$/i, manifest: "maven", stack: "java" },
  { pattern: /(^|\/)build\.gradle(?:\.kts)?$/i, manifest: "gradle", stack: "jvm" },
  { pattern: /(^|\/)package\.swift$/i, manifest: "swift-package", stack: "swift" },
  { pattern: /(^|\/)pubspec\.yaml$/i, manifest: "dart-pub", stack: "dart" },
  { pattern: /(^|\/)gemfile$/i, manifest: "bundler", stack: "ruby" },
  { pattern: /(^|\/)composer\.json$/i, manifest: "composer", stack: "php" },
];

const PACKAGE_FRAMEWORKS: Readonly<Record<string, readonly [string, string]>> = {
  "@angular/core": ["framework", "angular"],
  "@nestjs/core": ["framework", "nestjs"],
  "@playwright/test": ["testing", "playwright"],
  "@sveltejs/kit": ["framework", "sveltekit"],
  "@vitejs/plugin-react": ["framework", "react"],
  jest: ["testing", "jest"],
  next: ["framework", "nextjs"],
  react: ["framework", "react"],
  typescript: ["stack", "typescript"],
  vite: ["build-system", "vite"],
  vitest: ["testing", "vitest"],
  vue: ["framework", "vue"],
};

export interface AuditOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  maxDepth?: number;
}

interface ResolvedAuditOptions {
  maxFiles: number;
  maxFileBytes: number;
  maxDepth: number;
}

interface Candidate {
  relativePath: string;
  source: "tracked" | "untracked" | "scan";
}

interface GitContext {
  topLevel: string;
  workspacePrefix: string;
}

interface SignalAccumulator {
  values: Map<string, AuditEvidence[]>;
}

export async function auditWorkspace(
  workspace: string,
  options: AuditOptions = {},
): Promise<AuditReport> {
  const limits = resolveOptions(options);
  const requestedRoot = path.resolve(workspace);
  const requestedStats = await lstat(requestedRoot);
  if (requestedStats.isSymbolicLink()) {
    throw new Error("Workspace must be a real directory, not a symlink");
  }
  const root = await assertWorkspaceRoot(requestedRoot);
  const workspaceName = path.basename(root);
  const skips = new Map<string, number>();
  const warnings: string[] = [];
  const signals = new Map<string, SignalAccumulator>();
  const git = await detectGit(root);
  let dirtyWorktree: boolean | null = null;
  let candidates: Candidate[];

  if (git) {
    const enumeration = await enumerateGitCandidates(root, git, skips);
    candidates = enumeration.candidates;
    dirtyWorktree = enumeration.dirty;
    if (enumeration.warning) {
      warnings.push(enumeration.warning);
    }
  } else {
    const matcher = await loadRootIgnore(root, limits.maxFileBytes);
    candidates = await enumerateNonGitCandidates(root, limits, matcher, skips);
  }

  const inspectedFiles: string[] = [];
  let truncated = false;
  for (const candidate of candidates) {
    if (inspectedFiles.length >= limits.maxFiles) {
      truncated = true;
      increment(skips, "file-limit");
      break;
    }

    const relativePath = normalizeRelativePath(candidate.relativePath);
    if (!relativePath) {
      increment(skips, "invalid-path");
      continue;
    }
    if (isSecretLike(relativePath)) {
      increment(skips, "secret-like");
      continue;
    }
    if (hasGeneratedSegment(relativePath)) {
      increment(skips, "generated");
      continue;
    }
    if (!isAllowlisted(relativePath)) {
      increment(skips, "not-allowlisted");
      continue;
    }
    if (isAuxiliaryEvidencePath(relativePath)) {
      increment(skips, "fixture-or-example");
      continue;
    }
    if (BINARY_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())) {
      increment(skips, "binary");
      continue;
    }

    let absolutePath: string;
    try {
      absolutePath = await assertContainedPath(root, relativePath);
    } catch {
      increment(skips, "path-escape");
      continue;
    }

    let stats;
    try {
      stats = await lstat(absolutePath);
    } catch {
      increment(skips, "unreadable");
      continue;
    }
    if (stats.isSymbolicLink()) {
      increment(skips, "symlink");
      continue;
    }
    if (!stats.isFile()) {
      increment(skips, "not-file");
      continue;
    }
    if (stats.size > limits.maxFileBytes) {
      increment(skips, "oversized");
      continue;
    }
    let content: Buffer;
    try {
      content = await readWithoutFollowing(absolutePath, limits.maxFileBytes);
    } catch {
      increment(skips, "unreadable");
      continue;
    }
    if (looksBinary(content)) {
      increment(skips, "binary");
      continue;
    }

    inspectedFiles.push(relativePath);
    detectPathSignals(relativePath, signals);
    if (isPackageJson(relativePath)) {
      detectPackageSignals(content, relativePath, signals, warnings);
    }
  }

  const sortedInspectedFiles = [...inspectedFiles].sort(compareText);
  const existingCodex = detectCodexState(sortedInspectedFiles);
  addCodexSignals(existingCodex, signals);
  if (truncated) {
    warnings.push(
      `Audit reached the ${limits.maxFiles}-file inspection limit; recommendations may be incomplete.`,
    );
  }

  return {
    schemaVersion: 1,
    workspace: ".",
    workspaceName,
    gitRepository: git !== null,
    dirtyWorktree,
    inspectedFiles: sortedInspectedFiles,
    skipped: toSkipSummary(skips),
    truncated,
    signals: materializeSignals(signals),
    existingCodex,
    warnings: [...new Set(warnings)].sort(compareText),
  };
}

function isAuxiliaryEvidencePath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return (
    /(^|\/)(?:fixtures?|examples?|snapshots?)(\/|$)/.test(lower) ||
    /(^|\/)__fixtures__(\/|$)/.test(lower)
  );
}

function resolveOptions(options: AuditOptions): ResolvedAuditOptions {
  return {
    maxFiles: boundedInteger(options.maxFiles, DEFAULT_MAX_FILES, 1, HARD_MAX_FILES, "maxFiles"),
    maxFileBytes: boundedInteger(
      options.maxFileBytes,
      DEFAULT_MAX_FILE_BYTES,
      PROBE_BYTES,
      HARD_MAX_FILE_BYTES,
      "maxFileBytes",
    ),
    maxDepth: boundedInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 1, HARD_MAX_DEPTH, "maxDepth"),
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

async function detectGit(root: string): Promise<GitContext | null> {
  try {
    const result = await runGit(root, ["rev-parse", "--show-toplevel"]);
    const topLevel = await realpath(result.trim());
    const relative = path.relative(topLevel, root);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return null;
    }
    return {
      topLevel,
      workspacePrefix: toPosix(relative),
    };
  } catch {
    return null;
  }
}

async function enumerateGitCandidates(
  root: string,
  git: GitContext,
  skips: Map<string, number>,
): Promise<{ candidates: Candidate[]; dirty: boolean | null; warning?: string }> {
  const pathspec = git.workspacePrefix || ".";
  try {
    const [trackedOutput, untrackedOutput, statusOutput] = await Promise.all([
      runGit(git.topLevel, ["ls-files", "-z", "--cached", "--", pathspec]),
      runGit(git.topLevel, [
        "ls-files",
        "-z",
        "--others",
        "--exclude-standard",
        "--",
        pathspec,
      ]),
      runGit(git.topLevel, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=normal",
        "--",
        pathspec,
      ]),
    ]);
    const tracked = parseGitPaths(trackedOutput, git.workspacePrefix)
      .sort(compareText)
      .map((relativePath) => ({ relativePath, source: "tracked" as const }));
    const trackedSet = new Set(tracked.map(({ relativePath }) => relativePath));
    const untracked = parseGitPaths(untrackedOutput, git.workspacePrefix)
      .filter((relativePath) => !trackedSet.has(relativePath))
      .sort(compareText);
    const managedUntracked = untracked
      .filter(isCodexStateCandidate)
      .map((relativePath) => ({ relativePath, source: "untracked" as const }));
    const excludedUntracked = untracked.length - managedUntracked.length;
    if (excludedUntracked > 0) {
      increment(skips, "untracked", excludedUntracked);
    }
    return {
      candidates: [...tracked, ...managedUntracked],
      dirty: statusOutput.length > 0,
    };
  } catch {
    return {
      candidates: await enumerateNonGitCandidates(
        root,
        resolveOptions({}),
        await loadRootIgnore(root, DEFAULT_MAX_FILE_BYTES),
        new Map(),
      ),
      dirty: null,
      warning: "Git metadata was detected but could not be queried; used a bounded filesystem scan.",
    };
  }
}

function isCodexStateCandidate(relativePath: string): boolean {
  return (
    relativePath === "AGENTS.md" ||
    relativePath === ".codex/config.toml" ||
    relativePath === ".codex/codsemble/manifest.json" ||
    /^\.codex\/agents\/[^/]+\.toml$/.test(relativePath)
  );
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-c", "core.quotepath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000,
    windowsHide: true,
  });
  return result.stdout;
}

function parseGitPaths(output: string, workspacePrefix: string): string[] {
  const prefix = workspacePrefix ? `${workspacePrefix.replace(/\/+$/, "")}/` : "";
  return output
    .split("\0")
    .filter(Boolean)
    .map(toPosix)
    .flatMap((repoRelative) => {
      if (!prefix) {
        return [repoRelative];
      }
      return repoRelative.startsWith(prefix)
        ? [repoRelative.slice(prefix.length)]
        : [];
    });
}

async function loadRootIgnore(root: string, maxFileBytes: number): Promise<Ignore> {
  const matcher = ignore();
  matcher.add([...GENERATED_DIRECTORIES].map((directory) => `${directory}/`));
  const ignorePath = path.join(root, ".gitignore");
  try {
    const stats = await lstat(ignorePath);
    if (stats.isFile() && !stats.isSymbolicLink() && stats.size <= maxFileBytes) {
      const content = await readWithoutFollowing(ignorePath, maxFileBytes);
      if (!looksBinary(content)) {
        matcher.add(content.toString("utf8"));
      }
    }
  } catch {
    // A workspace does not need a .gitignore.
  }
  return matcher;
}

async function enumerateNonGitCandidates(
  root: string,
  limits: ResolvedAuditOptions,
  matcher: Ignore,
  skips: Map<string, number>,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const visit = async (relativeDirectory: string, depth: number): Promise<void> => {
    if (depth > limits.maxDepth) {
      increment(skips, "depth-limit");
      return;
    }
    const directoryPath = await assertContainedPath(root, relativeDirectory || ".");
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      increment(skips, "unreadable");
      return;
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const relativePath = toPosix(path.join(relativeDirectory, entry.name));
      if (entry.isSymbolicLink()) {
        increment(skips, "symlink");
        continue;
      }
      if (isSecretLike(relativePath)) {
        increment(skips, "secret-like");
        continue;
      }
      if (hasGeneratedSegment(relativePath)) {
        increment(skips, "generated");
        continue;
      }
      const ignoreCandidate = entry.isDirectory() ? `${relativePath}/` : relativePath;
      if (matcher.ignores(ignoreCandidate)) {
        increment(skips, "ignored");
        continue;
      }
      if (entry.isDirectory()) {
        await visit(relativePath, depth + 1);
      } else if (entry.isFile()) {
        candidates.push({ relativePath, source: "scan" });
      }
    }
  };
  await visit("", 0);
  return candidates;
}

function normalizeRelativePath(value: string): string | null {
  if (value.includes("\0")) {
    return null;
  }
  const normalized = path.posix.normalize(toPosix(value)).replace(/^\.\//, "");
  if (
    normalized === "" ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isSecretLike(relativePath: string): boolean {
  const segments = relativePath.toLowerCase().split("/");
  return segments.some((segment) => {
    if (
      segment === ".env" ||
      segment.startsWith(".env.") ||
      segment === ".npmrc" ||
      segment === ".pypirc" ||
      segment === ".netrc" ||
      segment === "credentials" ||
      segment === "credentials.json" ||
      segment === "secrets.json" ||
      segment === "secrets.yaml" ||
      segment === "secrets.yml" ||
      segment === "id_rsa" ||
      segment === "id_ed25519"
    ) {
      return true;
    }
    return (
      /(?:^|[._-])(secret|secrets|credential|credentials)(?:[._-]|$)/.test(segment) ||
      /\.(?:key|pem|p12|pfx|jks|keystore)$/.test(segment)
    );
  });
}

function hasGeneratedSegment(relativePath: string): boolean {
  return relativePath
    .toLowerCase()
    .split("/")
    .some((segment) => GENERATED_DIRECTORIES.has(segment));
}

function isAllowlisted(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath).toLowerCase();
  if (ALLOWED_BASENAMES.has(basename)) {
    return true;
  }
  if (
    relativePath.startsWith(".github/workflows/") &&
    (basename.endsWith(".yml") || basename.endsWith(".yaml"))
  ) {
    return true;
  }
  return ALLOWED_EXTENSIONS.has(path.posix.extname(basename));
}

async function readWithoutFollowing(
  absolutePath: string,
  maxFileBytes: number,
): Promise<Buffer> {
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxFileBytes) {
      throw new Error("File changed type or exceeded the audit size limit");
    }
    const buffer = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function looksBinary(content: Buffer): boolean {
  return content.subarray(0, PROBE_BYTES).includes(0);
}

function detectPathSignals(
  relativePath: string,
  signals: Map<string, SignalAccumulator>,
): void {
  for (const detector of MANIFEST_DETECTORS) {
    if (detector.pattern.test(relativePath)) {
      addSignal(signals, "manifest", detector.manifest, relativePath, "manifest-path");
      addSignal(signals, "stack", detector.stack, relativePath, "manifest-path");
    }
  }

  const lower = relativePath.toLowerCase();
  const basename = path.posix.basename(lower);
  if (
    /(^|\/)(test|tests|spec|specs|__tests__)(\/|$)/.test(lower) ||
    /\.(?:test|spec)\.[^.]+$/.test(lower) ||
    /_(?:test|spec)\.[^.]+$/.test(lower)
  ) {
    addSignal(signals, "testing", "tests-present", relativePath, "test-path");
  }
  if (
    lower.startsWith(".github/workflows/") ||
    basename === ".gitlab-ci.yml" ||
    lower.startsWith(".circleci/")
  ) {
    const provider = lower.startsWith(".github/workflows/")
      ? "github-actions"
      : basename === ".gitlab-ci.yml"
        ? "gitlab-ci"
        : "circleci";
    addSignal(signals, "ci", provider, relativePath, "ci-path");
  }
  if (
    basename.startsWith("readme") ||
    basename.startsWith("contributing") ||
    basename === "security.md" ||
    basename.startsWith("code_of_conduct") ||
    lower.startsWith("docs/")
  ) {
    addSignal(signals, "documentation", "documentation-present", relativePath, "documentation-path");
  }
  if (basename === "dockerfile" || basename === "docker-compose.yml" || basename === "compose.yml") {
    addSignal(signals, "deployment", "docker", relativePath, "deployment-path");
  }
  if (basename === "vercel.json") {
    addSignal(signals, "deployment", "vercel", relativePath, "deployment-path");
  }
  if (basename === "fly.toml") {
    addSignal(signals, "deployment", "fly-io", relativePath, "deployment-path");
  }
  if (path.posix.extname(lower) === ".tf") {
    addSignal(signals, "infrastructure", "terraform", relativePath, "infrastructure-path");
  }
  if (
    /(^|\/)(k8s|kubernetes|helm)(\/|$)/.test(lower) ||
    basename === "chart.yaml"
  ) {
    addSignal(signals, "infrastructure", "kubernetes", relativePath, "infrastructure-path");
  }

  const extensionStack = extensionToStack(path.posix.extname(lower));
  if (extensionStack) {
    addSignal(signals, "stack", extensionStack, relativePath, "source-extension");
  }
}

function extensionToStack(extension: string): string | null {
  switch (extension) {
    case ".ts":
    case ".tsx":
    case ".mts":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
      return "javascript";
    case ".py":
      return "python";
    case ".rs":
      return "rust";
    case ".go":
      return "go";
    case ".swift":
      return "swift";
    case ".dart":
      return "dart";
    case ".java":
    case ".kt":
    case ".kts":
    case ".scala":
      return "jvm";
    case ".cs":
      return "dotnet";
    case ".rb":
      return "ruby";
    case ".php":
      return "php";
    default:
      return null;
  }
}

function isPackageJson(relativePath: string): boolean {
  return path.posix.basename(relativePath).toLowerCase() === "package.json";
}

function detectPackageSignals(
  content: Buffer,
  relativePath: string,
  signals: Map<string, SignalAccumulator>,
  warnings: string[],
): void {
  try {
    const parsed: unknown = JSON.parse(content.toString("utf8"));
    if (!isPlainObject(parsed)) {
      return;
    }
    const dependencies = {
      ...stringRecord(parsed["dependencies"]),
      ...stringRecord(parsed["devDependencies"]),
      ...stringRecord(parsed["peerDependencies"]),
    };
    for (const dependency of Object.keys(PACKAGE_FRAMEWORKS).sort(compareText)) {
      if (Object.hasOwn(dependencies, dependency)) {
        const mapping = PACKAGE_FRAMEWORKS[dependency];
        if (mapping) {
          addSignal(signals, mapping[0], mapping[1], relativePath, "package-dependency");
        }
      }
    }
  } catch {
    warnings.push(`Could not parse an allowlisted manifest: ${relativePath}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function detectCodexState(inspectedFiles: string[]): ExistingCodexState {
  const files = new Set(inspectedFiles);
  return {
    agentsMd: files.has("AGENTS.md"),
    projectConfig: files.has(".codex/config.toml"),
    agentFiles: inspectedFiles
      .filter((relativePath) => /^\.codex\/agents\/[^/]+\.toml$/.test(relativePath))
      .sort(compareText),
    teamManifest: files.has(".codex/codsemble/manifest.json"),
  };
}

function addCodexSignals(
  state: ExistingCodexState,
  signals: Map<string, SignalAccumulator>,
): void {
  if (state.agentsMd) {
    addSignal(signals, "codex", "agents-instructions", "AGENTS.md", "codex-path");
  }
  if (state.projectConfig) {
    addSignal(signals, "codex", "project-config", ".codex/config.toml", "codex-path");
  }
  for (const relativePath of state.agentFiles) {
    addSignal(signals, "codex", "specialist-agents", relativePath, "codex-path");
  }
  if (state.teamManifest) {
    addSignal(
      signals,
      "codex",
      "codsemble-managed-team",
      ".codex/codsemble/manifest.json",
      "codex-path",
    );
  }
}

function addSignal(
  signals: Map<string, SignalAccumulator>,
  key: string,
  value: string,
  relativePath: string,
  detector: string,
): void {
  const accumulator: SignalAccumulator = signals.get(key) ?? {
    values: new Map<string, AuditEvidence[]>(),
  };
  const evidence: AuditEvidence[] = accumulator.values.get(value) ?? [];
  if (!evidence.some((item) => item.path === relativePath && item.detector === detector)) {
    evidence.push({
      path: relativePath,
      detector,
      detail: value,
    });
  }
  accumulator.values.set(value, evidence);
  signals.set(key, accumulator);
}

function materializeSignals(signals: Map<string, SignalAccumulator>): AuditSignal[] {
  return [...signals.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, accumulator]) => {
      const values = [...accumulator.values.keys()].sort(compareText);
      const evidence = [...accumulator.values.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .flatMap(([, items]) =>
          [...items].sort((left, right) =>
            compareText(
              `${left.path}\0${left.detector}\0${left.detail}`,
              `${right.path}\0${right.detector}\0${right.detail}`,
            ),
          ),
        );
      return {
        key,
        values,
        confidence: confidenceForEvidence(evidence),
        evidence,
      };
    });
}

function confidenceForEvidence(
  evidence: AuditEvidence[],
): "low" | "medium" | "high" {
  if (evidence.some((item) => item.detector === "manifest-path" || item.detector === "codex-path")) {
    return "high";
  }
  if (evidence.some((item) => item.detector === "package-dependency")) {
    return "high";
  }
  return evidence.length >= 2 ? "medium" : "low";
}

function increment(
  counts: Map<string, number>,
  reason: string,
  amount = 1,
): void {
  counts.set(reason, (counts.get(reason) ?? 0) + amount);
}

function toSkipSummary(counts: Map<string, number>): AuditSkipSummary[] {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => compareText(left, right))
    .map(([reason, count]) => ({ reason, count }));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
