#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const parseArgs = (argv) => {
  const args = {
    trimStartMs: 0,
    trimEndMs: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--input":
        args.input = argv[index + 1];
        index += 1;
        break;
      case "--output":
        args.output = argv[index + 1];
        index += 1;
        break;
      case "--trim-start-ms":
        args.trimStartMs = Number(argv[index + 1]);
        index += 1;
        break;
      case "--trim-end-ms":
        args.trimEndMs = Number(argv[index + 1]);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.input || !args.output) {
    throw new Error(
      "Usage: trim_video_with_playwright.mjs --input <video-path> --output <video-path> [--trim-start-ms <ms>] [--trim-end-ms <ms>]",
    );
  }

  if (Number.isNaN(args.trimStartMs) || args.trimStartMs < 0) {
    throw new Error(`--trim-start-ms must be a non-negative number. Received ${args.trimStartMs}`);
  }

  if (Number.isNaN(args.trimEndMs) || args.trimEndMs < 0) {
    throw new Error(`--trim-end-ms must be a non-negative number. Received ${args.trimEndMs}`);
  }

  return args;
};

const ensureBinary = (binaryName) => {
  try {
    execFileSync(binaryName, ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      `${binaryName} is required for demo video trimming. Install it and re-run this command.`,
    );
  }
};

const getDurationSeconds = (inputPath) => {
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ],
    { encoding: "utf8" },
  ).trim();
  const duration = Number(output);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Unable to determine duration for ${inputPath}`);
  }
  return duration;
};

const codecArgsForOutput = (outputPath) => {
  const extension = path.extname(outputPath).toLowerCase();
  switch (extension) {
    case ".mp4":
      return ["-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
    case ".webm":
      return ["-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-crf", "32", "-b:v", "0"];
    default:
      throw new Error(
        `Unsupported output extension "${extension}". Use .mp4 or .webm for demo exports.`,
      );
  }
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), options.input);
  const outputPath = path.resolve(process.cwd(), options.output);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input video not found: ${inputPath}`);
  }

  ensureBinary("ffprobe");
  ensureBinary("ffmpeg");

  const durationSeconds = getDurationSeconds(inputPath);
  const trimStartSeconds = options.trimStartMs / 1_000;
  const trimEndSeconds = options.trimEndMs / 1_000;
  const outputDurationSeconds = durationSeconds - trimStartSeconds - trimEndSeconds;

  if (outputDurationSeconds <= 0) {
    throw new Error(
      `Invalid trim window: start ${trimStartSeconds.toFixed(2)}s and end ${trimEndSeconds.toFixed(2)}s remove the whole clip.`,
    );
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      trimStartSeconds.toString(),
      "-i",
      inputPath,
      "-t",
      outputDurationSeconds.toString(),
      ...codecArgsForOutput(outputPath),
      outputPath,
    ],
    { stdio: "pipe" },
  );

  console.log(outputPath);
};

main();
