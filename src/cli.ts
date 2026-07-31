import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditWorkspace } from "./audit.js";
import {
  assertPlanCapabilities,
  bindIntakeCapabilities,
  detectCodexCapabilities,
} from "./capabilities.js";
import { loadCatalog } from "./catalog.js";
import { compileTeamPlan } from "./compiler.js";
import { doctorWorkspace } from "./doctor.js";
import { recommendTeams } from "./recommend.js";
import { intakeAnswersSchema } from "./schemas.js";
import {
  applyTeamPlan,
  assertValidTeamPlan,
  rollbackTransaction,
} from "./transaction.js";
import type {
  IntakeAnswers,
  TeamPlan,
} from "./types.js";
import { stableStringify } from "./util.js";

const HELP = `Codsemble — repository-aware native Codex team generator

Usage:
  codsemble audit [--workspace PATH]
  codsemble capabilities [--workspace PATH]
  codsemble recommend --answers FILE [--workspace PATH] [--catalog FILE]
  codsemble plan --answers FILE --proposal lean|balanced|full [--workspace PATH]
  codsemble apply --plan FILE --confirm CONFIRMATION_ID [--workspace PATH]
  codsemble doctor [--workspace PATH]
  codsemble rollback --transaction TRANSACTION_ID --confirm TRANSACTION_ID [--workspace PATH]
  codsemble catalog [--search TERM] [--catalog FILE]

Audit, capabilities, recommend, plan, catalog, and doctor are read-only. Apply requires the
exact plan ID printed by plan. Project configuration is never changed globally.
`;

interface ParsedArguments {
  command: string | undefined;
  flags: Map<string, string>;
  help: boolean;
}

function parseArguments(argv: string[]): ParsedArguments {
  const [command, ...rest] = argv;
  const flags = new Map<string, string>();
  let help = command === "--help" || command === "-h";
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--help" || flag === "-h") {
      help = true;
      continue;
    }
    if (!flag?.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${flag ?? ""}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flags.has(flag)) {
      throw new Error(`Duplicate flag: ${flag}`);
    }
    flags.set(flag, value);
    index += 1;
  }
  return { command, flags, help };
}

function flag(
  arguments_: ParsedArguments,
  name: string,
  options: { required?: boolean; fallback?: string } = {},
): string | undefined {
  const value = arguments_.flags.get(name) ?? options.fallback;
  if (options.required && value === undefined) {
    throw new Error(`Missing required flag: ${name}`);
  }
  return value;
}

function allowOnly(arguments_: ParsedArguments, names: string[]): void {
  const allowed = new Set(names);
  for (const name of arguments_.flags.keys()) {
    if (!allowed.has(name)) {
      throw new Error(`Unknown flag for ${arguments_.command}: ${name}`);
    }
  }
}

async function readJson<T>(file: string): Promise<T> {
  const resolved = path.resolve(file);
  try {
    return JSON.parse(await readFile(resolved, "utf8")) as T;
  } catch (error) {
    throw new Error(
      `Could not read JSON from ${resolved}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function readAnswers(file: string): Promise<IntakeAnswers> {
  return intakeAnswersSchema.parse(
    await readJson<unknown>(file),
  ) as IntakeAnswers;
}

async function run(arguments_: ParsedArguments): Promise<unknown> {
  const workspace = path.resolve(
    flag(arguments_, "--workspace", { fallback: "." }) ?? ".",
  );

  switch (arguments_.command) {
    case "audit": {
      allowOnly(arguments_, ["--workspace"]);
      return auditWorkspace(workspace);
    }
    case "capabilities": {
      allowOnly(arguments_, ["--workspace"]);
      return detectCodexCapabilities(workspace);
    }
    case "recommend": {
      allowOnly(arguments_, ["--workspace", "--answers", "--catalog"]);
      const answers = await readAnswers(
        flag(arguments_, "--answers", { required: true }) as string,
      );
      const roles = await loadCatalog(flag(arguments_, "--catalog"));
      const audit = await auditWorkspace(workspace);
      return recommendTeams(audit, answers, roles);
    }
    case "plan": {
      allowOnly(arguments_, [
        "--workspace",
        "--answers",
        "--catalog",
        "--proposal",
      ]);
      const answers = await readAnswers(
        flag(arguments_, "--answers", { required: true }) as string,
      );
      const capabilities = await detectCodexCapabilities(workspace);
      const boundAnswers = bindIntakeCapabilities(answers, capabilities);
      const kind = flag(arguments_, "--proposal", {
        required: true,
      }) as "lean" | "balanced" | "full";
      if (!["lean", "balanced", "full"].includes(kind)) {
        throw new Error("--proposal must be lean, balanced, or full");
      }
      const roles = await loadCatalog(flag(arguments_, "--catalog"));
      const audit = await auditWorkspace(workspace);
      const recommendation = recommendTeams(audit, boundAnswers, roles);
      const proposal = recommendation.proposals.find(
        (candidate) => candidate.kind === kind,
      );
      if (!proposal) {
        throw new Error(`Recommendation did not produce a ${kind} proposal`);
      }
      const plan = await compileTeamPlan(
        workspace,
        audit,
        boundAnswers,
        proposal,
        roles,
      );
      assertPlanCapabilities(plan, capabilities, "plan");
      return plan;
    }
    case "apply": {
      allowOnly(arguments_, ["--workspace", "--plan", "--confirm"]);
      const plan = await readJson<TeamPlan>(
        flag(arguments_, "--plan", { required: true }) as string,
      );
      assertValidTeamPlan(plan);
      const confirmation = flag(arguments_, "--confirm", {
        required: true,
      });
      if (
        typeof plan.planId !== "string" ||
        confirmation !== plan.confirmationId
      ) {
        throw new Error(
          "Confirmation refused: --confirm must exactly match plan.confirmationId",
        );
      }
      if (plan.concurrency?.configMode === "preview") {
        throw new Error(
          "Apply refused: preview plans are read-only; regenerate with apply-project, manual, or unchanged mode",
        );
      }
      const capabilities = await detectCodexCapabilities(workspace);
      assertPlanCapabilities(plan, capabilities, "apply");
      const transaction = await applyTeamPlan(workspace, plan);
      return {
        transaction,
        doctor: await doctorWorkspace(workspace),
        reloadRequired: plan.files.some(
          (file) => file.relativePath === ".codex/config.toml",
        ),
      };
    }
    case "doctor": {
      allowOnly(arguments_, ["--workspace"]);
      return doctorWorkspace(workspace);
    }
    case "rollback": {
      allowOnly(arguments_, ["--workspace", "--transaction", "--confirm"]);
      const transactionArgument = flag(arguments_, "--transaction", {
        required: true,
      }) as string;
      const transactionId = transactionArgument;
      if (
        flag(arguments_, "--confirm", { required: true }) !== transactionId
      ) {
        throw new Error(
          "Rollback confirmation refused: --confirm must exactly match the transaction id",
        );
      }
      await rollbackTransaction(workspace, transactionId);
      return {
        rolledBack: true,
        transactionId,
        doctor: await doctorWorkspace(workspace),
      };
    }
    case "catalog": {
      allowOnly(arguments_, ["--search", "--catalog"]);
      const query = flag(arguments_, "--search")?.trim().toLowerCase();
      const roles = await loadCatalog(flag(arguments_, "--catalog"));
      const selected =
        query && query.length > 0
          ? roles.filter((role) =>
              [
                role.id,
                role.name,
                role.family,
                role.summary,
                role.jobToBeDone,
                ...role.goalTags,
                ...role.repoSignals,
              ]
                .join(" ")
                .toLowerCase()
                .includes(query),
            )
          : roles;
      return {
        schemaVersion: 1,
        total: roles.length,
        matched: selected.length,
        roles: selected,
      };
    }
    default:
      throw new Error(`Unknown command: ${arguments_.command ?? "(none)"}`);
  }
}

async function main(): Promise<void> {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    if (arguments_.help || arguments_.command === undefined) {
      process.stdout.write(HELP);
      return;
    }
    process.stdout.write(stableStringify(await run(arguments_)));
  } catch (error) {
    process.stderr.write(
      `codsemble: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

await main();
