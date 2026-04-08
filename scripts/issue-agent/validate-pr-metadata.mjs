import fs from "node:fs";

import { normalizeDemoVideoPath } from "./demo-video-path.mjs";

const metadataPath = process.env.METADATA_PATH;

if (!metadataPath) {
  throw new Error("METADATA_PATH is required");
}

const raw = fs.readFileSync(metadataPath, "utf8").trim();
const parsed = JSON.parse(raw);
if (
  typeof parsed.title !== "string" ||
  typeof parsed.summary !== "string" ||
  typeof parsed.rationale !== "string"
) {
  throw new Error("PR metadata must contain string title, summary, and rationale fields");
}

if (parsed.demo != null) {
  if (
    typeof parsed.demo !== "object" ||
    typeof parsed.demo.summary !== "string" ||
    typeof parsed.demo.videoPath !== "string"
  ) {
    throw new Error(
      "PR metadata demo field must be an object with string summary and videoPath fields",
    );
  }
  normalizeDemoVideoPath(parsed.demo.videoPath);
}
