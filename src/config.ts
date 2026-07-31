import { parse } from "smol-toml";

import type { ConcurrencyPlan } from "./types.js";

export interface CodexConfigAdapter {
  readonly id: NonNullable<ConcurrencyPlan["adapter"]>;
  readonly section: string;
  readonly key: string;
}

export interface ConcurrencyPatch {
  content: string;
  currentValue: number | null;
  changed: boolean;
}

/**
 * Adapters are deliberately explicit. Callers must select v2; Codesemble never
 * guesses that a future schema is active merely from an unfamiliar document.
 */
export const CONFIG_ADAPTERS: Readonly<
  Record<NonNullable<ConcurrencyPlan["adapter"]>, CodexConfigAdapter>
> = Object.freeze({
  "agents-v1": Object.freeze({
    id: "agents-v1",
    section: "agents",
    key: "max_concurrent_threads_per_session",
  }),
});

const bareKey = /^[A-Za-z0-9_-]+$/;

export function validateToml(input: string): Record<string, unknown> {
  const source = stripBom(input);
  try {
    const parsed = parse(source);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("root must be a table");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid TOML: ${detail}`, { cause: error });
  }
}

export function patchConcurrencyToml(
  input: string,
  workers: number,
  adapter: CodexConfigAdapter | NonNullable<ConcurrencyPlan["adapter"]>,
): ConcurrencyPatch {
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 111) {
    throw new Error("Worker concurrency must be an integer from 1 through 111");
  }

  const selected =
    typeof adapter === "string" ? CONFIG_ADAPTERS[adapter] : adapter;
  validateAdapter(selected);

  const bom = input.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = stripBom(input);
  const parsed = validateToml(source);
  const currentValue = readCurrentValue(parsed, selected);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = splitLines(source);
  const scan = scanTarget(lines, selected);

  if (scan.occurrences.length > 1) {
    throw new Error(
      `Ambiguous TOML: ${selected.section}.${selected.key} is assigned more than once`,
    );
  }

  if (currentValue !== null && scan.occurrences.length !== 1) {
    throw new Error(
      `Cannot safely patch non-scalar representation of ${selected.section}.${selected.key}`,
    );
  }

  let patchedLines: string[];
  if (scan.occurrences.length === 1) {
    const occurrence = scan.occurrences[0];
    if (occurrence === undefined) {
      throw new Error("Internal target scan failure");
    }
    patchedLines = [...lines];
    patchedLines[occurrence.line] = replaceIntegerAssignment(
      lines[occurrence.line] ?? "",
      workers,
    );
  } else if (scan.sectionRanges.length === 1) {
    const range = scan.sectionRanges[0];
    if (range === undefined) {
      throw new Error("Internal section scan failure");
    }
    patchedLines = insertIntoSection(
      lines,
      range.end,
      `${selected.key} = ${workers}`,
    );
  } else if (scan.sectionRanges.length > 1) {
    throw new Error(`Ambiguous TOML: [${selected.section}] appears more than once`);
  } else if (scan.sectionWasCreatedByDottedKey) {
    patchedLines = appendBlock(
      lines,
      `${selected.section}.${selected.key} = ${workers}`,
    );
  } else if (Object.prototype.hasOwnProperty.call(parsed, selected.section)) {
    throw new Error(
      `Cannot safely extend inline or array representation of ${selected.section}`,
    );
  } else {
    patchedLines = appendBlock(
      lines,
      `[${selected.section}]${newline}${selected.key} = ${workers}`,
    );
  }

  const content = `${bom}${joinLines(patchedLines, newline, source)}`;
  const after = validateToml(content);
  const afterValue = readCurrentValue(after, selected);
  if (afterValue !== workers) {
    throw new Error(
      `Patched TOML did not set ${selected.section}.${selected.key} to ${workers}`,
    );
  }

  return {
    content,
    currentValue,
    changed: content !== input,
  };
}

function validateAdapter(adapter: CodexConfigAdapter): void {
  if (
    !adapter ||
    !bareKey.test(adapter.section) ||
    !bareKey.test(adapter.key) ||
    !(adapter.id in CONFIG_ADAPTERS)
  ) {
    throw new Error("Invalid Codex configuration adapter");
  }
  const expected = CONFIG_ADAPTERS[adapter.id];
  if (
    expected.section !== adapter.section ||
    expected.key !== adapter.key
  ) {
    throw new Error(`Adapter ${adapter.id} does not match its registered schema`);
  }
}

function readCurrentValue(
  parsed: Record<string, unknown>,
  adapter: CodexConfigAdapter,
): number | null {
  const section = parsed[adapter.section];
  if (section === undefined) {
    return null;
  }
  if (section === null || typeof section !== "object" || Array.isArray(section)) {
    throw new Error(`[${adapter.section}] must be a TOML table`);
  }
  const value = (section as Record<string, unknown>)[adapter.key];
  if (value === undefined) {
    return null;
  }
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(
      `${adapter.section}.${adapter.key} must be a positive integer`,
    );
  }
  return value as number;
}

interface TargetOccurrence {
  line: number;
}

interface SectionRange {
  start: number;
  end: number;
}

function scanTarget(
  lines: string[],
  adapter: CodexConfigAdapter,
): {
  occurrences: TargetOccurrence[];
  sectionRanges: SectionRange[];
  sectionWasCreatedByDottedKey: boolean;
} {
  const occurrences: TargetOccurrence[] = [];
  const sectionRanges: SectionRange[] = [];
  let currentSection: string | null = null;
  let openRange: SectionRange | null = null;
  let sectionWasCreatedByDottedKey = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripTomlComment(lines[index] ?? "").trim();
    if (line === "") {
      continue;
    }

    const header = parseSimpleHeader(line);
    if (header !== null) {
      if (openRange !== null) {
        openRange.end = index;
      }
      currentSection = header.array ? null : header.path;
      openRange = null;
      if (!header.array && header.path === adapter.section) {
        openRange = { start: index, end: lines.length };
        sectionRanges.push(openRange);
      }
      continue;
    }

    const assignment = parseSimpleAssignment(line);
    if (assignment === null) {
      continue;
    }
    if (
      currentSection === adapter.section &&
      assignment.key === adapter.key
    ) {
      occurrences.push({ line: index });
    } else if (
      currentSection === null &&
      assignment.key === `${adapter.section}.${adapter.key}`
    ) {
      occurrences.push({ line: index });
      sectionWasCreatedByDottedKey = true;
    } else if (
      currentSection === null &&
      assignment.key.startsWith(`${adapter.section}.`)
    ) {
      sectionWasCreatedByDottedKey = true;
    }
  }

  return { occurrences, sectionRanges, sectionWasCreatedByDottedKey };
}

function parseSimpleHeader(
  line: string,
): { path: string; array: boolean } | null {
  const match = line.match(/^(\[\[?)([A-Za-z0-9_.-]+)(\]\]?)$/);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  const array = match[1] === "[[";
  return { path: match[2], array };
}

function parseSimpleAssignment(line: string): { key: string } | null {
  const match = line.match(/^([A-Za-z0-9_.-]+)\s*=/);
  return match?.[1] ? { key: match[1] } : null;
}

function replaceIntegerAssignment(line: string, workers: number): string {
  const equals = findUnquotedEquals(line);
  if (equals < 0) {
    throw new Error("Cannot safely locate target TOML assignment");
  }
  const before = line.slice(0, equals + 1);
  const rest = line.slice(equals + 1);
  const match = rest.match(/^(\s*)[+-]?\d+(\s*(?:#.*)?)$/);
  if (!match) {
    throw new Error("Target concurrency value is not a simple integer scalar");
  }
  return `${before}${match[1] ?? " "}${workers}${match[2] ?? ""}`;
}

function findUnquotedEquals(line: string): number {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
    } else if (quote !== null && character === quote) {
      quote = null;
    } else if (quote === null && (character === "'" || character === '"')) {
      quote = character;
    } else if (quote === null && character === "=") {
      return index;
    }
  }
  return -1;
}

function stripTomlComment(line: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
    } else if (quote !== null && character === quote) {
      quote = null;
    } else if (quote === null && (character === "'" || character === '"')) {
      quote = character;
    } else if (quote === null && character === "#") {
      return line.slice(0, index);
    }
  }
  return line;
}

function insertIntoSection(
  lines: string[],
  end: number,
  assignment: string,
): string[] {
  const result = [...lines];
  let insertion = end;
  while (insertion > 0 && (result[insertion - 1] ?? "").trim() === "") {
    insertion -= 1;
  }
  result.splice(insertion, 0, assignment);
  return result;
}

function appendBlock(lines: string[], block: string): string[] {
  const result = [...lines];
  while (result.length > 0 && (result[result.length - 1] ?? "") === "") {
    result.pop();
  }
  if (result.length > 0) {
    result.push("");
  }
  result.push(...block.split(/\r?\n/));
  return result;
}

function splitLines(source: string): string[] {
  if (source === "") {
    return [];
  }
  const lines = source.split(/\r\n|\n/);
  if (source.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function joinLines(lines: string[], newline: string, original: string): string {
  const trailingNewline = original.endsWith("\n");
  const body = lines.join(newline);
  return trailingNewline || original === "" ? `${body}${newline}` : body;
}

function stripBom(input: string): string {
  return input.startsWith("\uFEFF") ? input.slice(1) : input;
}
