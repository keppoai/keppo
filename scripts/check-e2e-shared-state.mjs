import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "tests", "e2e");

const bannedPathPattern = /(shared-state|singleton|global-store)\.(?:[cm]?[jt]sx?)$/i;
const bannedImportPattern = /from\s+["'][^"']*(shared-state|singleton|global-store)[^"']*["']/i;

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
      continue;
    }
    if (/\.(?:[cm]?[jt]sx?)$/.test(full)) {
      acc.push(full);
    }
  }
  return acc;
};

const files = walk(ROOT);
const violations = [];

for (const file of files) {
  if (bannedPathPattern.test(file)) {
    violations.push(`Forbidden shared-state filename: ${file}`);
  }

  const source = readFileSync(file, "utf8");
  if (bannedImportPattern.test(source)) {
    violations.push(`Forbidden shared-state import in ${file}`);
  }
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("e2e shared-state check passed\n");
