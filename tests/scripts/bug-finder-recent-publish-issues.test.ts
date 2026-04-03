import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDedupMarker,
  createRepositoryIssue,
  parseFindingMarkdown,
  sanitizeMentions,
} from "../../scripts/bug-finder-recent/publish-issues.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scripts/bug-finder-recent/publish-issues.mjs", () => {
  it("parses a valid finding markdown file with strict frontmatter and sections", () => {
    const parsed = parseFindingMarkdown(
      [
        "# Missing retry on project refresh",
        "",
        "- Severity: high",
        "- Category: integration",
        "- Dedup Key: project-refresh-missing-retry",
        "",
        "### Summary",
        "Refreshing a project can fail permanently after a transient provider error.",
        "",
        "### Affected Files",
        "- apps/web/app/lib/server/project-refresh.ts:18",
        "- convex/projectRefresh.ts:44",
        "",
        "### Reproduction Path",
        "A refresh request hits the provider once and stops on the first transient failure.",
        "",
        "### Impact",
        "Operators cannot recover from common transient failures without manual retries.",
        "",
        "### Suggested Fix",
        "Retry transient provider failures and add a regression test.",
      ].join("\n"),
      "out-bug-finder/findings/project-refresh-missing-retry.md",
    );

    expect(parsed).toEqual({
      finding: {
        title: "Missing retry on project refresh",
        severity: "high",
        category: "integration",
        dedupKey: "project-refresh-missing-retry",
        affectedFiles: [
          "apps/web/app/lib/server/project-refresh.ts:18",
          "convex/projectRefresh.ts:44",
        ],
        description: [
          "### Summary",
          "Refreshing a project can fail permanently after a transient provider error.",
          "",
          "### Affected Files",
          "- apps/web/app/lib/server/project-refresh.ts:18",
          "- convex/projectRefresh.ts:44",
          "",
          "### Reproduction Path",
          "A refresh request hits the provider once and stops on the first transient failure.",
          "",
          "### Impact",
          "Operators cannot recover from common transient failures without manual retries.",
          "",
          "### Suggested Fix",
          "Retry transient provider failures and add a regression test.",
        ].join("\n"),
      },
    });
  });

  it("rejects malformed finding markdown when dedup key or required sections are missing", () => {
    const parsed = parseFindingMarkdown(
      [
        "# Missing retry on project refresh",
        "",
        "- Severity: high",
        "- Category: integration",
        "",
        "### Summary",
        "Refreshing a project can fail permanently after a transient provider error.",
      ].join("\n"),
      "out-bug-finder/findings/project-refresh-missing-retry.md",
    );

    expect(parsed).toEqual({
      error:
        "Malformed finding file out-bug-finder/findings/project-refresh-missing-retry.md: missing or invalid dedup key line",
    });
  });

  it("neutralizes mentions before filing an issue and applies both workflow labels", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ number: 42, html_url: "https://example.com/issues/42", state: "open" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createRepositoryIssue({
      apiBaseUrl: "https://api.github.test",
      repo: "keppoai/keppo",
      token: "token",
      agentLabel: "Codex",
      finding: {
        title: "Ping @ops on every failing refresh",
        severity: "high",
        category: "integration",
        dedupKey: "project-refresh-mentions-ops",
        affectedFiles: ["apps/web/app/lib/server/project-refresh.ts:18"],
        description: "### Summary\nThis pings @ops and @acme/platform whenever refresh fails.",
      },
    });

    const [, request] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    expect(payload.title).toContain("@\u200bops");
    expect(payload.body).toContain("@\u200bops");
    expect(payload.body).toContain(buildDedupMarker("project-refresh-mentions-ops"));
    expect(payload.labels).toEqual(["bugfinder", "/do-issue"]);
  });

  it("sanitizes raw mention text consistently", () => {
    expect(sanitizeMentions("@ops please loop in @team/platform")).toBe(
      "@\u200bops please loop in @\u200bteam/platform",
    );
  });
});
