import crypto from "node:crypto";
import fs from "node:fs";

const metadataPath = process.env.METADATA_PATH;
const issueNumber = process.env.ISSUE_NUMBER;
const githubOutputPath = process.env.GITHUB_OUTPUT;

if (!metadataPath) {
  throw new Error("METADATA_PATH is required");
}
if (!githubOutputPath) {
  throw new Error("GITHUB_OUTPUT is required");
}

const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const closeLine = issueNumber ? `\n\nCloses #${issueNumber}` : "";
const body = `${parsed.summary}${closeLine}\n\n<details>\n<summary>Rationale</summary>\n\n${parsed.rationale}\n</details>`;

const writeMultiline = (name, value) => {
  const delimiter = `EOF_${crypto.randomUUID()}`;
  fs.appendFileSync(githubOutputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
};

const hasDemo =
  parsed.demo != null &&
  typeof parsed.demo === "object" &&
  typeof parsed.demo.summary === "string" &&
  typeof parsed.demo.videoPath === "string";

writeMultiline("title", parsed.title);
writeMultiline("body", body);
fs.appendFileSync(
  githubOutputPath,
  `demo_present=${hasDemo ? "true" : "false"}\n`,
);
if (hasDemo) {
  writeMultiline("demo_summary", parsed.demo.summary ?? "");
  writeMultiline("demo_video_path", parsed.demo.videoPath ?? "");
}
