import { describe, expect, it } from "vitest";

import {
  CONFIG_ADAPTERS,
  patchConcurrencyToml,
} from "../src/config.js";

describe("patchConcurrencyToml", () => {
  it("preserves BOM, CRLF, comments, and unrelated fields", () => {
    const input =
      "\uFEFF# owner comment\r\n[features]\r\nfoo = true\r\n\r\n[agents]\r\nmax_concurrent_threads_per_session = 2 # keep\r\nother = \"yes\"\r\n";
    const result = patchConcurrencyToml(input, 6, "agents-v1");

    expect(result.currentValue).toBe(2);
    expect(result.changed).toBe(true);
    expect(result.content).toBe(
      "\uFEFF# owner comment\r\n[features]\r\nfoo = true\r\n\r\n[agents]\r\nmax_concurrent_threads_per_session = 6 # keep\r\nother = \"yes\"\r\n",
    );
  });

  it("adds the canonical agents table without reformatting existing content", () => {
    const result = patchConcurrencyToml("model = \"inherit\"\n", 4, "agents-v1");
    expect(result.currentValue).toBeNull();
    expect(result.content).toBe(
      'model = "inherit"\n\n[agents]\nmax_concurrent_threads_per_session = 4\n',
    );
  });

  it("inserts into an existing section before the next table", () => {
    const result = patchConcurrencyToml(
      "[agents]\n# retained\n\n[other]\nvalue = 1",
      3,
      "agents-v1",
    );
    expect(result.content).toBe(
      "[agents]\n# retained\nmax_concurrent_threads_per_session = 3\n\n[other]\nvalue = 1",
    );
  });

  it("supports the explicit v2 adapter", () => {
    const result = patchConcurrencyToml("", 5, CONFIG_ADAPTERS["multi-agent-v2"]);
    expect(result.content).toBe(
      "[multi_agent]\nmax_concurrent_workers = 5\n",
    );
  });

  it("rejects invalid input, invalid values, and unsafe inline tables", () => {
    expect(() => patchConcurrencyToml("[agents", 2, "agents-v1")).toThrow(
      "Invalid TOML",
    );
    expect(() => patchConcurrencyToml("", 0, "agents-v1")).toThrow(
      "integer from 1 through 111",
    );
    expect(() =>
      patchConcurrencyToml(
        "agents = { max_concurrent_threads_per_session = 2 }\n",
        4,
        "agents-v1",
      ),
    ).toThrow("non-scalar representation");
  });

  it("rejects duplicate and ambiguous target definitions", () => {
    expect(() =>
      patchConcurrencyToml(
        "[agents]\nmax_concurrent_threads_per_session = 2\nmax_concurrent_threads_per_session = 3\n",
        4,
        "agents-v1",
      ),
    ).toThrow("Invalid TOML");
    expect(() =>
      patchConcurrencyToml(
        '"agents" = { max_concurrent_threads_per_session = 2 }\n',
        4,
        "agents-v1",
      ),
    ).toThrow("non-scalar representation");
  });
});
