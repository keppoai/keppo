import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDedupMarker,
  createRepositoryIssue,
  ensureLabel,
  isRepositoryIssue,
  parseFindingMarkdown,
  partitionFindingsBySeverity,
  normalizeSeverityFilter,
  sanitizeMentions,
} from "../../scripts/code-architect-recent/publish-issues.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scripts/code-architect-recent/publish-issues.mjs", () => {
  it("parses a valid architecture finding markdown file with strict frontmatter and sections", () => {
    const parsed = parseFindingMarkdown(
      [
        "# Split provider orchestration from dashboard mutation flow",
        "",
        "- Severity: high",
        "- Category: over-coupling",
        "- Dedup Key: provider-orchestration-dashboard-coupling",
        "",
        "### Summary",
        "Provider orchestration and dashboard mutation flow currently share one server module.",
        "",
        "### Affected Files",
        "- apps/web/app/lib/server/providers/orchestrate.ts:18",
        "- convex/providers.ts:44",
        "",
        "### Current Pain",
        "Contributors must update both orchestration and dashboard code paths in lockstep.",
        "",
        "### Why This Is Structural",
        "The current module owns two separate responsibilities with no stable boundary.",
        "",
        "### Recommended Refactor",
        "Extract provider orchestration into a source-of-truth service and narrow the mutation interface.",
        "",
        "### Expected Payoff",
        "Provider changes become local instead of touching multiple layers.",
      ].join("\n"),
      "out-code-architect/findings/provider-orchestration-dashboard-coupling.md",
    );

    expect(parsed).toEqual({
      finding: {
        title: "Split provider orchestration from dashboard mutation flow",
        severity: "high",
        category: "over-coupling",
        dedupKey: "provider-orchestration-dashboard-coupling",
        affectedFiles: [
          "apps/web/app/lib/server/providers/orchestrate.ts:18",
          "convex/providers.ts:44",
        ],
        description: [
          "### Summary",
          "Provider orchestration and dashboard mutation flow currently share one server module.",
          "",
          "### Affected Files",
          "- apps/web/app/lib/server/providers/orchestrate.ts:18",
          "- convex/providers.ts:44",
          "",
          "### Current Pain",
          "Contributors must update both orchestration and dashboard code paths in lockstep.",
          "",
          "### Why This Is Structural",
          "The current module owns two separate responsibilities with no stable boundary.",
          "",
          "### Recommended Refactor",
          "Extract provider orchestration into a source-of-truth service and narrow the mutation interface.",
          "",
          "### Expected Payoff",
          "Provider changes become local instead of touching multiple layers.",
        ].join("\n"),
      },
    });
  });

  it("rejects malformed finding markdown when dedup key or required sections are missing", () => {
    const parsed = parseFindingMarkdown(
      [
        "# Split provider orchestration from dashboard mutation flow",
        "",
        "- Severity: high",
        "- Category: over-coupling",
        "",
        "### Summary",
        "Provider orchestration and dashboard mutation flow currently share one server module.",
      ].join("\n"),
      "out-code-architect/findings/provider-orchestration-dashboard-coupling.md",
    );

    expect(parsed).toEqual({
      error:
        "Malformed finding file out-code-architect/findings/provider-orchestration-dashboard-coupling.md: missing or invalid dedup key line",
    });
  });

  it("files severity labels instead of prefixing severity into the issue title", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        number: 42,
        html_url: "https://example.com/issues/42",
        state: "open",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createRepositoryIssue({
      apiBaseUrl: "https://api.github.test",
      repo: "keppoai/keppo",
      token: "token",
      agentLabel: "Codex",
      finding: {
        title: "Ping @ops when architecture review finds repeated boundary drift",
        severity: "high",
        category: "boundary-leakage",
        dedupKey: "architecture-review-mentions-ops",
        affectedFiles: ["apps/web/app/lib/server/providers/orchestrate.ts:18"],
        description: "### Summary\nThis pings @ops and @acme/platform whenever the issue is filed.",
      },
    });

    const [, request] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    expect(payload.title).toBe(
      "Ping @\u200bops when architecture review finds repeated boundary drift",
    );
    expect(payload.body).toContain("@\u200bops");
    expect(payload.body).toContain(buildDedupMarker("architecture-review-mentions-ops"));
    expect(payload.labels).toEqual(["architecture-review", "severity:high"]);
  });

  it("filters pull requests and invalid payloads out of repository issue lists", () => {
    expect(isRepositoryIssue(null)).toBe(false);
    expect(isRepositoryIssue("not-an-issue")).toBe(false);
    expect(isRepositoryIssue({ number: 12, title: "Issue" })).toBe(false);
    expect(isRepositoryIssue({ number: 12, state: "open", title: "Issue" })).toBe(true);
    expect(isRepositoryIssue({ state: "open", title: "Issue" })).toBe(false);
    expect(isRepositoryIssue([])).toBe(false);
    expect(
      isRepositoryIssue({
        number: 99,
        pull_request: { url: "https://example.test" },
      }),
    ).toBe(false);
  });

  it("treats concurrent label creation as success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ message: "Validation Failed" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureLabel({
        apiBaseUrl: "https://api.github.test",
        repo: "keppoai/keppo",
        token: "token",
        label: "architecture-review",
        description: "Architecture improvement found by the nightly code-architect:recent workflow",
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sanitizes raw mention text consistently", () => {
    expect(sanitizeMentions("@ops please loop in @team/platform")).toBe(
      "@\u200bops please loop in @\u200bteam/platform",
    );
  });

  it("normalizes the severity filter and preserves filtered architecture findings for audit reporting", () => {
    const findings = [
      { severity: "critical", title: "Critical architecture risk" },
      { severity: "high", title: "High architecture risk" },
    ];

    expect(normalizeSeverityFilter(" Critical ")).toBe("critical");
    expect(partitionFindingsBySeverity(findings, " Critical ")).toEqual({
      filtered: [{ severity: "high", title: "High architecture risk" }],
      findingsToPublish: [{ severity: "critical", title: "Critical architecture risk" }],
    });
  });
});
