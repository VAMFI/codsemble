import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";

import { patchConcurrencyToml } from "../src/config.js";
import { stableStringify } from "../src/util.js";

describe("generated configuration properties", () => {
  it("round-trips every supported worker ceiling without disturbing unrelated data", () => {
    for (let workers = 1; workers <= 256; workers += 1) {
      const source =
        '# owner\nmodel = "inherit"\n\n[agents]\nother = "preserve"\n';
      const result = patchConcurrencyToml(source, workers, "agents-v1");
      const parsed = parseToml(result.content) as {
        model?: string;
        agents?: {
          other?: string;
          max_concurrent_threads_per_session?: number;
        };
      };
      expect(parsed.model).toBe("inherit");
      expect(parsed.agents?.other).toBe("preserve");
      expect(parsed.agents?.max_concurrent_threads_per_session).toBe(workers);
    }
  });

  it("stable serialization is invariant to object insertion order", () => {
    let state = 0x5eed;
    const next = () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state;
    };
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const entries = Array.from({ length: 8 }, (_, index) => [
        `key-${index}`,
        next(),
      ] as const);
      const shuffled = [...entries].sort(() => (next() & 1 ? 1 : -1));
      expect(stableStringify(Object.fromEntries(shuffled))).toBe(
        stableStringify(Object.fromEntries(entries)),
      );
    }
  });
});
