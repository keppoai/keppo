import { describe, expect, it } from "vitest";
import { parseAgentsFromSearchParams } from "./labels";

describe("agent parsing", () => {
  it("defaults to codex when no agent is provided", () => {
    expect(parseAgentsFromSearchParams(undefined)).toEqual(["codex"]);
  });

  it("supports repeated and comma separated values", () => {
    expect(parseAgentsFromSearchParams(["claude", "codex"])).toEqual(["claude", "codex"]);
    expect(parseAgentsFromSearchParams("claude,codex")).toEqual(["claude", "codex"]);
  });
});
