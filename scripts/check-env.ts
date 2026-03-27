import { API_ENV_KEYS, parseApiEnv } from "../apps/web/app/lib/server/api-runtime/env-schema.ts";

const reportOnly = process.argv.includes("--report-only");

type EnvStatus = "set" | "derived" | "missing";

const hasValue = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (value === null || value === undefined) {
    return false;
  }
  return true;
};

const parseMissingLabels = (message: string): string[] => {
  return message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- Missing "))
    .map((line) => line.replace("- Missing ", "").trim());
};

const resolved = parseApiEnv(process.env, { validateRequired: false });
const keys = [...API_ENV_KEYS].sort((a, b) => a.localeCompare(b));
const rows = keys.map((key) => {
  const raw = process.env[key];
  const normalized = (resolved as Record<string, unknown>)[key];

  let status: EnvStatus = "missing";
  if (hasValue(raw)) {
    status = "set";
  } else if (hasValue(normalized)) {
    status = "derived";
  }

  return {
    variable: key,
    status,
  };
});

const summary = {
  set: rows.filter((row) => row.status === "set").length,
  derived: rows.filter((row) => row.status === "derived").length,
  missing: rows.filter((row) => row.status === "missing").length,
};

const resolvedMode =
  resolved.NODE_ENV?.toLowerCase() === "development" ||
  resolved.NODE_ENV?.toLowerCase() === "test" ||
  resolved.KEPPO_E2E_MODE
    ? "relaxed"
    : "strict";

console.log(`API env diagnostic (mode=${resolvedMode})`);
console.table(rows);
console.log(
  `Summary: set=${String(summary.set)}, derived=${String(summary.derived)}, missing=${String(summary.missing)}`,
);

let requiredMissing: string[] = [];
let hardValidationError: string | null = null;

try {
  parseApiEnv(process.env, { validateRequired: true });
  console.log("Required environment validation passed.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  requiredMissing = parseMissingLabels(message);
  if (requiredMissing.length === 0) {
    hardValidationError = message;
  }
}

if (requiredMissing.length > 0) {
  console.error("Required environment variables are missing:");
  for (const item of requiredMissing) {
    console.error(`- ${item}`);
  }
  if (!reportOnly) {
    process.exit(1);
  }
  console.log(
    "Env check ran in report-only mode; missing required values did not fail the process.",
  );
}

if (hardValidationError) {
  console.error(hardValidationError);
  if (!reportOnly) {
    process.exit(1);
  }
  console.log(
    "Env check ran in report-only mode; schema validation errors did not fail the process.",
  );
}
