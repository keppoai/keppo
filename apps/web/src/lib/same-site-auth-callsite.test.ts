import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webSrcRoot = path.resolve(import.meta.dirname, "..");
const bannedPattern = /\bauthClient\.getCookie\(\)/u;

const collectSourceFiles = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    if (!/\.(ts|tsx)$/u.test(entry.name)) {
      continue;
    }
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
};

describe("same-site auth cookie usage", () => {
  it("does not call authClient.getCookie directly in app source", () => {
    const offenders = collectSourceFiles(webSrcRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      if (!bannedPattern.test(source)) {
        return [];
      }

      return [path.relative(webSrcRoot, filePath)];
    });

    expect(offenders).toEqual([]);
  });
});
