import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const scriptPath = join(process.cwd(), "scripts/issue-agent/write-untrusted-issue.mjs");

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("scripts/issue-agent/write-untrusted-issue.mjs", () => {
  it("renders the issue body and prefetched comments into the untrusted issue file", () => {
    const dir = mkdtempSync(join(tmpdir(), "issue-agent-untrusted-issue-"));
    const outputPath = join(dir, "untrusted-issue.md");
    cleanupPaths.push(dir);

    const result = spawnSync("node", [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        ISSUE_OUTPUT_PATH: outputPath,
        ISSUE_NUMBER: "42",
        ISSUE_TITLE: "Improve issue agent context",
        ISSUE_BODY: "Use issue comments when they are trusted.",
        ISSUE_COMMENTS_JSON: JSON.stringify([
          {
            author: "wwwillchen",
            body: "Please preserve the existing PR metadata contract.",
            createdAt: "2026-03-11T12:34:56Z",
          },
          {
            author: "keppo-bot",
            body: "Reminder: exclude hidden comments from the prompt.",
            createdAt: "2026-03-11T13:00:00Z",
          },
        ]),
      },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toBe(
      [
        "Issue #42",
        "",
        "Title:",
        "Improve issue agent context",
        "",
        "Body:",
        "Use issue comments when they are trusted.",
        "",
        "Comments:",
        "Comment 1 by wwwillchen at 2026-03-11T12:34:56Z:",
        "Please preserve the existing PR metadata contract.",
        "",
        "Comment 2 by keppo-bot at 2026-03-11T13:00:00Z:",
        "Reminder: exclude hidden comments from the prompt.",
        "",
      ].join("\n"),
    );
  });

  it("writes an explicit empty comments section when no prefetched comments are available", () => {
    const dir = mkdtempSync(join(tmpdir(), "issue-agent-untrusted-issue-"));
    const outputPath = join(dir, "untrusted-issue.md");
    cleanupPaths.push(dir);

    const result = spawnSync("node", [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        ISSUE_OUTPUT_PATH: outputPath,
        ISSUE_NUMBER: "43",
        ISSUE_TITLE: "No comment context",
        ISSUE_BODY: "",
        ISSUE_COMMENTS_JSON: "[]",
      },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toContain("Comments:\n(none)\n");
  });
});
