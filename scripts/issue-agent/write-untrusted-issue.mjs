import fs from "node:fs";
import path from "node:path";

const outputPath = process.env.ISSUE_OUTPUT_PATH || "tmp/issue-agent/untrusted-issue.md";
const issueCommentsJson = process.env.ISSUE_COMMENTS_JSON || "[]";

function parseIssueComments(rawComments) {
  const parsed = JSON.parse(rawComments);
  if (!Array.isArray(parsed)) {
    throw new Error("ISSUE_COMMENTS_JSON must be a JSON array");
  }
  return parsed.map((comment, index) => {
    if (!comment || typeof comment !== "object") {
      throw new Error(`ISSUE_COMMENTS_JSON[${index}] must be an object`);
    }
    const { author, body, createdAt } = comment;
    if (typeof author !== "string" || typeof body !== "string" || typeof createdAt !== "string") {
      throw new Error(
        `ISSUE_COMMENTS_JSON[${index}] must contain string author, body, and createdAt fields`,
      );
    }
    return { author, body, createdAt };
  });
}

const issueComments = parseIssueComments(issueCommentsJson);

const renderedComments =
  issueComments.length === 0
    ? ["Comments:", "(none)", ""]
    : [
        "Comments:",
        ...issueComments.flatMap((comment, index) => [
          `Comment ${index + 1} by ${comment.author} at ${comment.createdAt}:`,
          comment.body,
          "",
        ]),
      ];

const issueReference = [
  `Issue #${process.env.ISSUE_NUMBER || ""}`,
  "",
  "Title:",
  process.env.ISSUE_TITLE || "",
  "",
  "Body:",
  process.env.ISSUE_BODY || "",
  "",
  ...renderedComments,
].join("\n");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, issueReference);
