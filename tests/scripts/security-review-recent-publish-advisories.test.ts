import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadFindings,
  parseFindingMarkdown,
} from "../../scripts/security-review-recent/publish-advisories.mjs";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
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
});
