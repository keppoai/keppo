import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envPaths = [join(process.cwd(), ".env.local"), join(process.cwd(), ".env.dev")];

export const readLocalEnvValue = (key: string): string | null => {
  const prefix = `${key}=`;
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue;
    }
    const env = readFileSync(envPath, "utf8");
    for (const line of env.split("\n")) {
      if (line.startsWith(prefix)) {
        return line.slice(prefix.length).trim();
      }
    }
  }
  return null;
};
