import { describe, expect, it } from "vitest";

import {
  describePlanApproval,
  normalizeVoiceConfirmation,
  verifyPlanConfirmation,
  VOICE_CONFIRMATION_WORDS,
  voiceChallengeForConfirmationId,
} from "../src/confirmation.js";
import { computeConfirmationId } from "../src/compiler.js";
import type { TeamPlan } from "../src/types.js";

describe("voice-friendly plan confirmation", () => {
  it("uses a stable, unique, non-approval vocabulary", () => {
    expect(VOICE_CONFIRMATION_WORDS).toHaveLength(128);
    expect(new Set(VOICE_CONFIRMATION_WORDS).size).toBe(128);
    expect(
      VOICE_CONFIRMATION_WORDS.every((word) => /^[a-z]{4,12}$/.test(word)),
    ).toBe(true);
    for (const unsafe of [
      "yes",
      "no",
      "apply",
      "approve",
      "confirm",
      "continue",
    ]) {
      expect(VOICE_CONFIRMATION_WORDS).not.toContain(unsafe);
    }
  });

  it("derives a stable six-word challenge from the full confirmation digest", () => {
    expect(voiceChallengeForConfirmationId("0".repeat(32))).toBe(
      "approve team violet cotton lemon summit spiral cactus",
    );
    const tokens = voiceChallengeForConfirmationId("f".repeat(32)).split(" ");
    expect(tokens).toHaveLength(8);
    expect(new Set(tokens.slice(2)).size).toBe(6);
  });

  it("accepts only conservative transcript normalization", () => {
    const challenge = voiceChallengeForConfirmationId("1".repeat(32));
    expect(normalizeVoiceConfirmation(`  ${challenge.toUpperCase()}!  `)).toBe(
      challenge,
    );
    expect(normalizeVoiceConfirmation(challenge.replaceAll(" ", "-"))).toBe(
      challenge,
    );
    expect(normalizeVoiceConfirmation(`-${challenge}`)).toBeNull();
    expect(normalizeVoiceConfirmation(`${challenge}-`)).toBeNull();
    expect(normalizeVoiceConfirmation("yes")).toBeNull();
    expect(normalizeVoiceConfirmation(`${challenge} please`)).toBeNull();
    expect(normalizeVoiceConfirmation(challenge.replace(" ", ", "))).toBeNull();
    expect(normalizeVoiceConfirmation(`Ａ${challenge.slice(1)}`)).toBeNull();
    expect(normalizeVoiceConfirmation(`${challenge}\u200b`)).toBeNull();
  });

  it("binds the voice challenge to the exact complete plan", () => {
    const first = plan("manual", ".codex/agents/first.toml");
    const second = plan("manual", ".codex/agents/second.toml");
    const firstChallenge = voiceChallengeForConfirmationId(first.confirmationId);

    expect(() =>
      verifyPlanConfirmation(first, {
        kind: "voice-challenge",
        value: firstChallenge,
      }),
    ).not.toThrow();
    expect(() =>
      verifyPlanConfirmation(second, {
        kind: "voice-challenge",
        value: firstChallenge,
      }),
    ).toThrow("Voice confirmation refused");

    first.files[0]!.content = "tampered";
    expect(() =>
      verifyPlanConfirmation(first, {
        kind: "voice-challenge",
        value: firstChallenge,
      }),
    ).toThrow("confirmation digest mismatch");
  });

  it("gives preview plans no challenge and refuses every approval method", () => {
    const preview = plan("preview", ".codex/agents/preview.toml");
    expect(describePlanApproval(preview)).toMatchObject({
      state: "preview-only",
      applyCapable: false,
      confirmationId: null,
      voiceChallenge: null,
    });
    expect(() =>
      verifyPlanConfirmation(preview, {
        kind: "full-id",
        value: preview.confirmationId,
      }),
    ).toThrow("preview plans are read-only");
  });

  it("retains exact full-id confirmation as the compatibility path", () => {
    const current = plan("unchanged", ".codex/agents/current.toml");
    expect(() =>
      verifyPlanConfirmation(current, {
        kind: "full-id",
        value: current.confirmationId,
      }),
    ).not.toThrow();
    expect(() =>
      verifyPlanConfirmation(current, {
        kind: "full-id",
        value: current.confirmationId.toUpperCase(),
      }),
    ).toThrow("must exactly match");
  });
});

function plan(
  configMode: "preview" | "manual" | "unchanged",
  relativePath: string,
): TeamPlan {
  const unsigned: Omit<TeamPlan, "confirmationId"> = {
    schemaVersion: 1,
    planId: "voice-test-plan",
    auditFingerprint: "a".repeat(64),
    roles: [],
    concurrency: {
      requestedWorkers: 1,
      projectCurrentValue: null,
      adapter: configMode === "unchanged" ? null : "agents-v1",
      configMode,
      willApply: false,
      manualSnippet: null,
    },
    preimages: [
      { relativePath, exists: false, sha256: null, mode: null },
    ],
    files: [
      {
        relativePath,
        action: "create",
        beforeSha256: null,
        afterSha256: "b".repeat(64),
        content: "planned",
      },
    ],
  };
  return { ...unsigned, confirmationId: computeConfirmationId(unsigned) };
}
