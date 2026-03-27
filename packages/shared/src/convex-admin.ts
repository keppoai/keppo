import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConvexHttpClient } from "convex/browser";

const CONVEX_LOCAL_CONFIG_PATH = [".convex", "local", "default", "config.json"] as const;

const readAdminKeyFromConfigPath = (configPath: string): string | null => {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as { adminKey?: unknown };
    if (typeof raw.adminKey === "string" && raw.adminKey.length > 0) {
      return raw.adminKey;
    }
  } catch {
    return null;
  }
  return null;
};

export const toUsableAdminKey = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("encrypted:")) {
    return null;
  }
  return trimmed;
};

export const resolveLocalAdminKey = (
  options: {
    cwd?: string;
    searchParentDirectories?: boolean;
  } = {},
): string | null => {
  let currentDir = options.cwd ?? process.cwd();
  while (true) {
    const configPath = join(currentDir, ...CONVEX_LOCAL_CONFIG_PATH);
    const adminKey = readAdminKeyFromConfigPath(configPath);
    if (adminKey) {
      return adminKey;
    }
    if (options.searchParentDirectories !== true) {
      return null;
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) {
      return null;
    }
    currentDir = parent;
  }
};

export const setClientAdminAuth = (client: ConvexHttpClient, adminKey: string): void => {
  const setAdminAuth = (client as { setAdminAuth?: (token: string) => void }).setAdminAuth;
  if (typeof setAdminAuth !== "function") {
    throw new Error("ConvexHttpClient#setAdminAuth is unavailable on this runtime.");
  }
  setAdminAuth.call(client, adminKey);
};
