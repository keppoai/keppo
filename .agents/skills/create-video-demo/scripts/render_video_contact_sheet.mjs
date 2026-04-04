#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const parseArgs = (argv) => {
  const args = {
    samples: 9,
    columns: 3,
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
      case "--samples":
        args.samples = Number(argv[index + 1]);
        index += 1;
        break;
      case "--columns":
        args.columns = Number(argv[index + 1]);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.input || !args.output) {
    throw new Error(
      "Usage: render_video_contact_sheet.mjs --input <video-path> --output <image-path> [--samples <count>] [--columns <count>]",
    );
  }

  if (!Number.isInteger(args.samples) || args.samples <= 0) {
    throw new Error(`--samples must be a positive integer. Received ${args.samples}`);
  }

  if (!Number.isInteger(args.columns) || args.columns <= 0) {
    throw new Error(`--columns must be a positive integer. Received ${args.columns}`);
  }

  return args;
};

const ensureBinary = (binaryName) => {
  try {
    execFileSync(binaryName, ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      `${binaryName} is required for demo video review. Install it and re-run this command.`,
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
  const rows = Math.ceil(options.samples / options.columns);
  const fps = Math.max(options.samples / durationSeconds, 0.05);
  const filter = `fps=${fps},scale=400:-1,tile=${options.columns}x${rows}:padding=12:margin=12:color=0x111111`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-vf",
      filter,
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath,
    ],
    { stdio: "pipe" },
  );

  console.log(outputPath);
};

main();
