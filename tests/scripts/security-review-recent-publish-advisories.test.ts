import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRepositoryAdvisory,
  loadFindings,
  main,
  parseFindingMarkdown,
} from "../../scripts/security-review-recent/publish-advisories.mjs";

const cleanupPaths: string[] = [];

const createFindingsDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "security-review-findings-"));
  cleanupPaths.push(dir);
  return dir;
};

const writeFinding = (dir: string, title: string) => {
  writeFileSync(
    join(dir, "finding.md"),
    [
      `# ${title}`,
      "",
      "- Severity: high",
      "",
      "### Summary",
      "Unsigned requests are accepted.",
    ].join("\n"),
  );
};

const stubPublishEnv = (findingsDir: string) => {
  vi.stubEnv("FINDINGS_DIR", findingsDir);
  vi.stubEnv("SECURITY_ADVISORY_TOKEN", "token");
  vi.stubEnv("GITHUB_REPOSITORY", "keppoai/keppo");
  vi.stubEnv("SECURITY_ADVISORY_ALERT_EMAILS", "security@example.com");
  vi.stubEnv("MAILGUN_API_KEY", "mailgun-key");
  vi.stubEnv("MAILGUN_DOMAIN", "mg.example.com");
  vi.stubEnv("MAILGUN_FROM_EMAIL", "alerts@example.com");
};

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("scripts/security-review-recent/publish-advisories.mjs", () => {
  it("parses a valid finding markdown file", () => {
    const parsed = parseFindingMarkdown(
      [
        "# Webhook signature bypass",
        "",
        "- Severity: high",
        "",
        "### Summary",
        "The webhook route accepts unsigned requests.",
      ].join("\n"),
      "out-security-review/findings/webhook-signature-bypass.md",
    );

    expect(parsed).toEqual({
      finding: {
        title: "Webhook signature bypass",
        severity: "high",
        description: ["### Summary", "The webhook route accepts unsigned requests."].join("\n"),
      },
    });
  });

  it("reports malformed finding markdown without throwing", () => {
    const parsed = parseFindingMarkdown(
      ["# Missing severity", "", "### Summary", "This file omitted the severity line."].join("\n"),
      "out-security-review/findings/missing-severity.md",
    );

    expect(parsed).toEqual({
      error:
        "Malformed finding file out-security-review/findings/missing-severity.md: missing or invalid severity line",
    });
  });

  it("returns valid findings and malformed file errors from a mixed findings directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "security-review-findings-"));
    cleanupPaths.push(dir);

    writeFileSync(
      join(dir, "auth-bypass.md"),
      [
        "# Auth bypass",
        "",
        "- Severity: critical",
        "",
        "### Summary",
        "An unauthenticated route reaches privileged state mutation.",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "missing-title.md"),
      ["- Severity: high", "", "### Summary", "This file has no title heading."].join("\n"),
    );
    writeFileSync(join(dir, "empty.md"), "");

    const result = await loadFindings(dir);

    expect(result.findings).toEqual([
      {
        title: "Auth bypass",
        severity: "critical",
        description: [
          "### Summary",
          "An unauthenticated route reaches privileged state mutation.",
        ].join("\n"),
      },
    ]);
    expect(result.malformed).toEqual([
      `Malformed finding file ${join(dir, "empty.md")}: empty file`,
      `Malformed finding file ${join(dir, "missing-title.md")}: missing # title heading`,
    ]);
  });

  it("treats a missing findings directory as empty rather than malformed", async () => {
    const dir = join(tmpdir(), "security-review-findings-does-not-exist");

    const result = await loadFindings(dir);

    expect(result).toEqual({ findings: [], malformed: [] });
  });

  it("includes the agent label in advisory descriptions without relying on outer scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ghsa_id: "GHSA-test", html_url: "https://example.com/advisory" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createRepositoryAdvisory({
      apiBaseUrl: "https://api.github.test",
      repo: "keppoai/keppo",
      token: "token",
      repositoryName: "keppo",
      finding: {
        title: "Webhook signature bypass",
        severity: "high",
        description: "### Summary\nUnsigned requests are accepted.",
      },
      agentLabel: "Claude",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    expect(payload.description).toContain("(agent: Claude)");
  });

  it("creates a new advisory when matching existing advisories are published or closed", async () => {
    const dir = createFindingsDir();
    writeFinding(dir, "Webhook signature bypass");
    stubPublishEnv(dir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            summary: "Webhook signature bypass",
            state: "published",
            ghsa_id: "GHSA-published",
            html_url: "https://example.com/published",
          },
          {
            summary: "Webhook signature bypass",
            state: "closed",
            ghsa_id: "GHSA-closed",
            html_url: "https://example.com/closed",
          },
        ],
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ghsa_id: "GHSA-new", html_url: "https://example.com/new" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "queued",
      });
    vi.stubGlobal("fetch", fetchMock);

    await main();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [createUrl, createRequest] = fetchMock.mock.calls[1];
    expect(String(createUrl)).toBe(
      "https://api.github.com/repos/keppoai/keppo/security-advisories",
    );
    expect(createRequest?.method).toBe("POST");

    const [, mailgunRequest] = fetchMock.mock.calls[2];
    expect(mailgunRequest?.body).toBeInstanceOf(URLSearchParams);
    expect(mailgunRequest?.body.get("text")).toContain("Created advisories: 1");
    expect(mailgunRequest?.body.get("text")).toContain("Skipped as duplicates: 0");
  });

  it("skips creating a new advisory when a matching draft already exists", async () => {
    const dir = createFindingsDir();
    writeFinding(dir, "Webhook signature bypass");
    stubPublishEnv(dir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            summary: "Webhook signature bypass",
            state: "draft",
            ghsa_id: "GHSA-draft",
            html_url: "https://example.com/draft",
          },
        ],
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "queued",
      });
    vi.stubGlobal("fetch", fetchMock);

    await main();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [mailgunUrl, mailgunRequest] = fetchMock.mock.calls[1];
    expect(String(mailgunUrl)).toBe("https://api.mailgun.net/v3/mg.example.com/messages");
    expect(mailgunRequest?.body).toBeInstanceOf(URLSearchParams);
    expect(mailgunRequest?.body.get("text")).toContain("Created advisories: 0");
    expect(mailgunRequest?.body.get("text")).toContain("Skipped as duplicates: 1");
  });
});
