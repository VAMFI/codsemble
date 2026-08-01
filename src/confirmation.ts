import type { TeamPlan } from "./types.js";
import { computeConfirmationId } from "./compiler.js";
import { sha256 } from "./util.js";

export const VOICE_CONFIRMATION_VERSION = "voice-v1";
export const VOICE_CONFIRMATION_WORDS = [
  "acorn",
  "admiral",
  "almond",
  "amber",
  "anchor",
  "anthem",
  "apricot",
  "arctic",
  "atlas",
  "badger",
  "bamboo",
  "banjo",
  "beacon",
  "beaver",
  "biscuit",
  "blossom",
  "bonnet",
  "bottle",
  "bronze",
  "cactus",
  "candle",
  "canyon",
  "caramel",
  "cedar",
  "cello",
  "cherry",
  "cobalt",
  "comet",
  "copper",
  "coral",
  "cotton",
  "crater",
  "crystal",
  "daisy",
  "denim",
  "desert",
  "domino",
  "dragon",
  "driftwood",
  "eagle",
  "elmwood",
  "emerald",
  "falcon",
  "feather",
  "festival",
  "flannel",
  "forest",
  "fossil",
  "galaxy",
  "garden",
  "garnet",
  "ginger",
  "glacier",
  "granite",
  "harbor",
  "hazel",
  "helmet",
  "honey",
  "horizon",
  "ivory",
  "jacket",
  "jasmine",
  "kettle",
  "kiwi",
  "lantern",
  "lavender",
  "lemon",
  "lilac",
  "lobster",
  "maple",
  "marble",
  "meadow",
  "melon",
  "meteor",
  "mosaic",
  "mountain",
  "mustard",
  "nectar",
  "nickel",
  "ocean",
  "olive",
  "orchid",
  "otter",
  "panda",
  "paper",
  "pebble",
  "pepper",
  "piano",
  "pickle",
  "planet",
  "plum",
  "pocket",
  "quartz",
  "rabbit",
  "radar",
  "raven",
  "ribbon",
  "river",
  "rocket",
  "saffron",
  "sailor",
  "satin",
  "shadow",
  "silver",
  "socket",
  "sparrow",
  "spiral",
  "spruce",
  "summit",
  "sunset",
  "tablet",
  "tango",
  "teapot",
  "temple",
  "thunder",
  "timber",
  "topaz",
  "tulip",
  "velvet",
  "violet",
  "walnut",
  "willow",
  "window",
  "winter",
  "yogurt",
  "yucca",
  "zebra",
  "zephyr",
] as const;

const SPOKEN_WORD_COUNT = 6;

export type PlanConfirmation =
  | { kind: "full-id"; value: string }
  | { kind: "voice-challenge"; value: string };

export interface PlanApprovalDescription {
  schemaVersion: 1;
  planId: string;
  confirmationId: string;
  state: "preview-only" | "ready";
  applyCapable: boolean;
  noChanges: boolean;
  mutatingPaths: string[];
  voiceChallengeVersion: typeof VOICE_CONFIRMATION_VERSION;
  voiceChallenge: string | null;
  freshness: {
    mode: "plan-and-preimage-bound";
    summary: string;
  };
}

export function voiceChallengeForConfirmationId(
  confirmationId: string,
): string {
  if (!/^[a-f0-9]{32}$/.test(confirmationId)) {
    throw new Error("Cannot derive a voice challenge from an invalid confirmation id");
  }
  const digest = sha256(
    `${VOICE_CONFIRMATION_VERSION}\0${confirmationId}`,
  );
  const pool = [...VOICE_CONFIRMATION_WORDS];
  let value = BigInt(`0x${digest}`);
  const selected: string[] = [];
  for (let index = 0; index < SPOKEN_WORD_COUNT; index += 1) {
    const selectedIndex = Number(value % BigInt(pool.length));
    const word = pool.splice(selectedIndex, 1)[0];
    if (word === undefined) {
      throw new Error("Voice challenge vocabulary is incomplete");
    }
    selected.push(word);
    value /= BigInt(pool.length + 1);
  }
  return `approve team ${selected.join(" ")}`;
}

export function describePlanApproval(
  plan: TeamPlan,
): PlanApprovalDescription {
  assertConfirmationDigest(plan);
  const applyCapable = plan.concurrency.configMode !== "preview";
  const mutatingPaths = plan.files
    .filter(({ action }) => action !== "verify")
    .map(({ relativePath }) => relativePath)
    .sort();
  return {
    schemaVersion: 1,
    planId: plan.planId,
    confirmationId: plan.confirmationId,
    state: applyCapable ? "ready" : "preview-only",
    applyCapable,
    noChanges: mutatingPaths.length === 0,
    mutatingPaths,
    voiceChallengeVersion: VOICE_CONFIRMATION_VERSION,
    voiceChallenge: applyCapable
      ? voiceChallengeForConfirmationId(plan.confirmationId)
      : null,
    freshness: {
      mode: "plan-and-preimage-bound",
      summary: applyCapable
        ? "Valid only for this exact plan while every recorded workspace preimage remains unchanged."
        : "Preview-only plans have no approval step and must be regenerated in an apply-capable mode.",
    },
  };
}

export function verifyPlanConfirmation(
  plan: TeamPlan,
  confirmation: PlanConfirmation,
): void {
  assertConfirmationDigest(plan);
  if (plan.concurrency.configMode === "preview") {
    throw new Error(
      "Apply refused: preview plans are read-only; regenerate with apply-project, manual, or unchanged mode",
    );
  }
  if (confirmation.kind === "full-id") {
    if (confirmation.value !== plan.confirmationId) {
      throw new Error(
        "Confirmation refused: --confirm must exactly match plan.confirmationId",
      );
    }
    return;
  }
  const expected = voiceChallengeForConfirmationId(plan.confirmationId);
  const received = normalizeVoiceConfirmation(confirmation.value);
  if (received === null || received !== expected) {
    throw new Error(
      "Voice confirmation refused: repeat the complete current voice challenge exactly; vague, partial, reordered, or approximate speech is not approval",
    );
  }
}

export function normalizeVoiceConfirmation(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > 240 ||
    !/^[\t\n\r\x20-\x7e]+$/.test(value)
  ) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  const withoutTerminalPunctuation = /[.!?]$/.test(trimmed)
    ? trimmed.slice(0, -1)
    : trimmed;
  if (
    withoutTerminalPunctuation.startsWith("-") ||
    withoutTerminalPunctuation.endsWith("-") ||
    /[^a-z\s-]/.test(withoutTerminalPunctuation)
  ) {
    return null;
  }
  const normalized = withoutTerminalPunctuation
    .replace(/[\s-]+/g, " ")
    .trim();
  return /^approve team(?: [a-z]+){6}$/.test(normalized)
    ? normalized
    : null;
}

function assertConfirmationDigest(plan: TeamPlan): void {
  if (
    !/^[a-f0-9]{32}$/.test(plan.confirmationId) ||
    computeConfirmationId(plan) !== plan.confirmationId
  ) {
    throw new Error("Plan confirmation digest mismatch");
  }
}
