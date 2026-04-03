import crypto from "node:crypto";
import fs from "node:fs";

const actionsPath = process.env.ACTIONS_PATH;
const githubOutputPath = process.env.GITHUB_OUTPUT;

if (!actionsPath) throw new Error("ACTIONS_PATH is required");
if (!githubOutputPath) throw new Error("GITHUB_OUTPUT is required");

const parsed = JSON.parse(fs.readFileSync(actionsPath, "utf8"));

const writeMultiline = (name, value) => {
  const delimiter = `EOF_${crypto.randomUUID()}`;
  fs.appendFileSync(githubOutputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
};

const hasDemo =
  parsed.demo != null &&
  typeof parsed.demo === "object" &&
  typeof parsed.demo.summary === "string" &&
  typeof parsed.demo.videoPath === "string";

writeMultiline("summary_comment", parsed.summaryComment ?? "");
writeMultiline("thread_actions", JSON.stringify(parsed.threadActions ?? []));
writeMultiline(
  "unrelated_e2e_failures",
  JSON.stringify(parsed.unrelatedE2EFailures ?? []),
);
fs.appendFileSync(
  githubOutputPath,
  `has_unrelated_e2e_failures=${
    Array.isArray(parsed.unrelatedE2EFailures) && parsed.unrelatedE2EFailures.length > 0
      ? "true"
      : "false"
  }\n`,
);
fs.appendFileSync(githubOutputPath, `demo_present=${hasDemo ? "true" : "false"}\n`);
if (hasDemo) {
  writeMultiline("demo_summary", parsed.demo.summary ?? "");
  writeMultiline("demo_video_path", parsed.demo.videoPath ?? "");
}
