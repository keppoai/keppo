import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function normalizeDemoVideoPath(value) {
  if (typeof value !== "string") {
    throw new Error("demo.videoPath must be a string");
  }

  let normalized = value;
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  if (!normalized) {
    throw new Error("demo.videoPath must not be empty");
  }
  if (path.posix.isAbsolute(normalized) || normalized.includes("\\")) {
    throw new Error("demo.videoPath must be a safe relative path under ux-artifacts/video-demos/");
  }

  normalized = path.posix.normalize(normalized);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("demo.videoPath must be a safe relative path under ux-artifacts/video-demos/");
  }
  if (!normalized.startsWith("ux-artifacts/video-demos/")) {
    throw new Error("demo.videoPath must be under ux-artifacts/video-demos/");
  }

  return normalized;
}

export function readDemoVideoPathFromMetadata(metadata) {
  if (metadata?.demo == null) {
    return "";
  }
  return normalizeDemoVideoPath(metadata.demo.videoPath);
}

function main() {
  const metadataPath = process.env.METADATA_PATH;
  if (metadataPath) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const demoVideoPath = readDemoVideoPathFromMetadata(metadata);
    if (demoVideoPath) {
      process.stdout.write(demoVideoPath);
    }
    return;
  }

  const demoVideoPath = process.env.DEMO_VIDEO_PATH;
  if (!demoVideoPath) {
    throw new Error("METADATA_PATH or DEMO_VIDEO_PATH is required");
  }
  process.stdout.write(normalizeDemoVideoPath(demoVideoPath));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
