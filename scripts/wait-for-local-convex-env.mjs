import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const localEnvPath = path.join(rootDir, ".env.local");
const localConvexConfigPath = path.join(rootDir, ".convex", "local", "default", "config.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseEnvFile = (source) => {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }
  return values;
};

const readDesiredConvexEnv = () => {
  if (!fs.existsSync(localConvexConfigPath)) {
    return null;
  }

  const config = JSON.parse(fs.readFileSync(localConvexConfigPath, "utf8"));
  const cloudPort = config?.ports?.cloud;
  const sitePort = config?.ports?.site;
  if (!cloudPort || !sitePort) {
    return null;
  }

  return {
    KEPPO_URL: process.env.KEPPO_URL?.trim() || "http://localhost:3000",
    VITE_CONVEX_URL: `http://localhost:${cloudPort}`,
    VITE_CONVEX_SITE_URL: `http://localhost:${sitePort}`,
    VITE_KEPPO_URL: process.env.KEPPO_URL?.trim() || "http://localhost:3000",
  };
};

const hasSyncedLocalConvexEnv = () => {
  const desired = readDesiredConvexEnv();
  if (!desired || !fs.existsSync(localEnvPath)) {
    return false;
  }

  const actual = parseEnvFile(fs.readFileSync(localEnvPath, "utf8"));
  return (
    actual.get("KEPPO_URL") === desired.KEPPO_URL &&
    actual.get("VITE_CONVEX_URL") === desired.VITE_CONVEX_URL &&
    actual.get("VITE_CONVEX_SITE_URL") === desired.VITE_CONVEX_SITE_URL &&
    actual.get("VITE_KEPPO_URL") === desired.VITE_KEPPO_URL
  );
};

const main = async () => {
  const timeoutMs = 30_000;
  const pollMs = 250;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (hasSyncedLocalConvexEnv()) {
      return;
    }
    await sleep(pollMs);
  }

  console.warn(
    "Timed out waiting for local Convex env sync; starting the web dev server with the current .env.local values.",
  );
};

await main();
