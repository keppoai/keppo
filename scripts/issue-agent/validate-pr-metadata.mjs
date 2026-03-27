import fs from "node:fs";
import path from "node:path";

const metadataPath = process.env.METADATA_PATH;

if (!metadataPath) {
  throw new Error("METADATA_PATH is required");
}

const raw = fs.readFileSync(metadataPath, "utf8").trim();
const parsed = JSON.parse(raw);
const validateDemoVideoPath = (value) => {
  if (typeof value !== "string") {
    throw new Error("demo.videoPath must be a string");
  }
  if (path.isAbsolute(value) || value.includes("\\") || value.includes("..")) {
    throw new Error("demo.videoPath must be a safe relative path under ux-artifacts/video-demos/");
  }
  const normalized = path.posix.normalize(value);
  if (!normalized.startsWith("ux-artifacts/video-demos/")) {
    throw new Error("demo.videoPath must be under ux-artifacts/video-demos/");
  }
};

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
  validateDemoVideoPath(parsed.demo.videoPath);
}
