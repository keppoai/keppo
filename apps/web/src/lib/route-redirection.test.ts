import { describe, expect, it } from "vitest";
import {
  lastWorkspaceStorageKey,
  pickPreferredWorkspaceSlug,
  resolveHomeRedirectPath,
  resolveOrgRedirectHref,
  resolveWorkspaceRedirectPath,
} from "./route-redirection";

describe("route-redirection", () => {
  it("builds the last-workspace storage key per org", () => {
    expect(lastWorkspaceStorageKey("acme")).toBe("keppo:lastWorkspaceSlug:acme");
  });

  it("prefers a stored workspace slug when it still exists", () => {
    expect(pickPreferredWorkspaceSlug([{ slug: "alpha" }, { slug: "beta" }], "beta")).toBe("beta");
  });

  it("falls back to the first workspace when the stored slug is stale", () => {
    expect(pickPreferredWorkspaceSlug([{ slug: "alpha" }, { slug: "beta" }], "missing")).toBe(
      "alpha",
    );
  });

  it("resolves the home redirect to the preferred workspace", () => {
    expect(
      resolveHomeRedirectPath({
        orgSlug: "acme",
        workspaces: [{ slug: "alpha" }, { slug: "beta" }],
        storedWorkspaceSlug: "beta",
      }),
    ).toBe("/acme/beta");
  });

  it("returns no home redirect when the org has no workspaces yet", () => {
    expect(
      resolveHomeRedirectPath({
        orgSlug: "acme",
        workspaces: [],
        storedWorkspaceSlug: null,
      }),
    ).toBeNull();
  });

  it("rewrites mismatched org slugs while preserving path, search, and hash", () => {
    expect(
      resolveOrgRedirectHref({
        pathname: "/wrong/settings",
        requestedOrgSlug: "wrong",
        sessionOrgSlug: "acme",
        search: "?tab=members",
        hash: "#invite",
      }),
    ).toBe("/acme/settings?tab=members#invite");
  });

  it("rewrites invalid workspace slugs to the preferred workspace while preserving subpaths", () => {
    expect(
      resolveWorkspaceRedirectPath({
        pathname: "/acme/missing/automations/example/runs/run-1",
        orgSlug: "acme",
        requestedWorkspaceSlug: "missing",
        workspaces: [{ slug: "alpha" }, { slug: "beta" }],
        storedWorkspaceSlug: "beta",
      }),
    ).toBe("/acme/beta/automations/example/runs/run-1");
  });

  it("rewrites missing-workspace URLs for workspace routes to the preferred workspace", () => {
    expect(
      resolveWorkspaceRedirectPath({
        pathname: "/acme/approvals",
        orgSlug: "acme",
        requestedWorkspaceSlug: "approvals",
        workspaces: [{ slug: "alpha" }, { slug: "beta" }],
        storedWorkspaceSlug: "beta",
      }),
    ).toBe("/acme/beta/approvals");
  });

  it("skips workspace redirects when the requested slug already matches the preferred workspace", () => {
    expect(
      resolveWorkspaceRedirectPath({
        pathname: "/acme/beta/automations",
        orgSlug: "acme",
        requestedWorkspaceSlug: "beta",
        workspaces: [{ slug: "alpha" }, { slug: "beta" }],
        storedWorkspaceSlug: "beta",
      }),
    ).toBeNull();
  });
});
