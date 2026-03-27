import { describe, expect, it } from "vitest";
import { deriveRouteContext, resolveCurrentPathScope } from "./use-route-params";

describe("use-route-params helpers", () => {
  it("treats org-scoped routes without a matched workspace as org routes", () => {
    expect(
      deriveRouteContext({
        pathname: "/acme/reports",
        matchedParams: { orgSlug: "acme" },
        storedWorkspaceSlug: "beta",
      }),
    ).toMatchObject({
      orgSlug: "acme",
      workspaceSlug: "beta",
      matchedWorkspaceSlug: null,
      currentPathScope: "org",
      relativePath: "/reports",
      section: "reports",
    });
  });

  it("keeps matched workspace routes scoped to the workspace path", () => {
    expect(
      deriveRouteContext({
        pathname: "/acme/beta/automations/example/runs/run-1",
        matchedParams: {
          orgSlug: "acme",
          workspaceSlug: "beta",
        },
        storedWorkspaceSlug: "ignored",
      }),
    ).toMatchObject({
      orgSlug: "acme",
      workspaceSlug: "beta",
      matchedWorkspaceSlug: "beta",
      currentPathScope: "workspace",
      relativePath: "/automations/example/runs/run-1",
      section: "automations",
      automationLookup: "example",
      runId: "run-1",
    });
  });

  it("classifies paths from matched params instead of hardcoded prefixes", () => {
    expect(resolveCurrentPathScope("acme", null)).toBe("org");
    expect(resolveCurrentPathScope("acme", "beta")).toBe("workspace");
    expect(resolveCurrentPathScope(null, null)).toBe("global");
  });
});
