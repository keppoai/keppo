import { describe, expect, it } from "vitest";
import { collectManagedConvexEnvValues } from "../../scripts/convex-managed-env.mjs";

describe("scripts/convex-managed-env.mjs", () => {
  it("preserves explicit empty managed env overrides", () => {
    const values = collectManagedConvexEnvValues({
      mode: "local",
      env: {
        KEPPO_LLM_GATEWAY_URL: "",
      },
    });

    expect(values.KEPPO_LLM_GATEWAY_URL).toBe("");
  });

  it("still applies defaults when a managed key is absent", () => {
    const values = collectManagedConvexEnvValues({
      mode: "local",
      env: {},
    });

    expect(values.NODE_ENV).toBe("development");
  });
});
