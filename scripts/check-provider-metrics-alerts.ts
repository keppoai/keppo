import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

type RollupResult = {
  generated_at: string;
  window_minutes: number;
  window_start_at: string;
  total_events: number;
  counts: Array<{
    metric: string;
    provider: string | null;
    outcome: string | null;
    count: number;
  }>;
  rates: Array<{
    metric: string;
    provider: string;
    attempts: number;
    successes: number;
    failures: number;
    rate: number;
  }>;
  alert_breaches: Array<{
    code: string;
    message: string;
    severity: "warning" | "critical";
  }>;
};

const parseNumberArg = (name: string): number | undefined => {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env ${name}: ${raw}`);
  }
  return parsed;
};

const parseConvexJson = <T>(output: string): T => {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as T;
    } catch {
      // continue scanning prior lines
    }
  }

  throw new Error(`Unable to parse Convex JSON output:\n${output}`);
};

const parseJsonFile = <T>(path: string): T => {
  return JSON.parse(readFileSync(path, "utf8")) as T;
};

const runConvex = (functionName: string, args: Record<string, unknown>): string => {
  const result = spawnSync("pnpm", ["exec", "convex", "run", functionName, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      `convex run failed (${functionName})\nstdout:\n${result.stdout || "(no stdout)"}\n\nstderr:\n${result.stderr || "(no stderr)"}`,
    );
  }

  return result.stdout.trim();
};

const args = {
  ...(parseNumberArg("KEPPO_PROVIDER_METRICS_WINDOW_MINUTES") !== undefined
    ? { windowMinutes: parseNumberArg("KEPPO_PROVIDER_METRICS_WINDOW_MINUTES") }
    : {}),
  ...(parseNumberArg("KEPPO_PROVIDER_METRICS_RESOLUTION_SPIKE") !== undefined
    ? { resolutionFailureSpike: parseNumberArg("KEPPO_PROVIDER_METRICS_RESOLUTION_SPIKE") }
    : {}),
  ...(parseNumberArg("KEPPO_PROVIDER_METRICS_UNKNOWN_SPIKE") !== undefined
    ? { unknownProviderSpike: parseNumberArg("KEPPO_PROVIDER_METRICS_UNKNOWN_SPIKE") }
    : {}),
  ...(parseNumberArg("KEPPO_PROVIDER_METRICS_NONCANONICAL_SPIKE") !== undefined
    ? { nonCanonicalSpike: parseNumberArg("KEPPO_PROVIDER_METRICS_NONCANONICAL_SPIKE") }
    : {}),
  ...(parseNumberArg("KEPPO_PROVIDER_METRICS_CAPABILITY_SPIKE") !== undefined
    ? { capabilityMismatchSpike: parseNumberArg("KEPPO_PROVIDER_METRICS_CAPABILITY_SPIKE") }
    : {}),
  ...(parseNumberArg("KEPPO_PROVIDER_METRICS_CONNECT_SUCCESS_MIN") !== undefined
    ? { connectSuccessRateMin: parseNumberArg("KEPPO_PROVIDER_METRICS_CONNECT_SUCCESS_MIN") }
    : {}),
  ...(parseNumberArg("KEPPO_PROVIDER_METRICS_CALLBACK_SUCCESS_MIN") !== undefined
    ? { callbackSuccessRateMin: parseNumberArg("KEPPO_PROVIDER_METRICS_CALLBACK_SUCCESS_MIN") }
    : {}),
  ...(parseNumberArg("KEPPO_PROVIDER_METRICS_WEBHOOK_FAILURE_MAX") !== undefined
    ? { webhookVerifyFailureRateMax: parseNumberArg("KEPPO_PROVIDER_METRICS_WEBHOOK_FAILURE_MAX") }
    : {}),
  ...(parseNumberArg("KEPPO_PROVIDER_METRICS_MIN_SAMPLE_SIZE") !== undefined
    ? { minSampleSize: parseNumberArg("KEPPO_PROVIDER_METRICS_MIN_SAMPLE_SIZE") }
    : {}),
};

const result = parseConvexJson<RollupResult>(
  runConvex("internal.provider_metrics.rollupProviderMetrics", args),
);

const baselinePath = process.env.KEPPO_PROVIDER_METRICS_BASELINE_PATH?.trim();
const baseline = baselinePath ? parseJsonFile<RollupResult>(baselinePath) : null;
const connectRateDropMax = parseNumberArg("KEPPO_PROVIDER_METRICS_CONNECT_RATE_DROP_MAX") ?? 0.02;
const callbackRateDropMax = parseNumberArg("KEPPO_PROVIDER_METRICS_CALLBACK_RATE_DROP_MAX") ?? 0.02;
const webhookFailureIncreaseMax =
  parseNumberArg("KEPPO_PROVIDER_METRICS_WEBHOOK_FAILURE_INCREASE_MAX") ?? 0.01;

const baselineBreaches: RollupResult["alert_breaches"] = [];
if (baseline) {
  const baselineRateByKey = new Map(
    baseline.rates.map((entry) => [`${entry.metric}:${entry.provider}`, entry.rate]),
  );

  for (const entry of result.rates) {
    const key = `${entry.metric}:${entry.provider}`;
    const baselineRate = baselineRateByKey.get(key);
    if (baselineRate === undefined) {
      continue;
    }
    const delta = entry.rate - baselineRate;
    if (entry.metric === "oauth_connect" && delta < -connectRateDropMax) {
      baselineBreaches.push({
        code: `oauth_connect_rate_delta:${entry.provider}`,
        severity: "critical",
        message: `OAuth connect success rate delta for ${entry.provider} is ${(delta * 100).toFixed(2)}pp (baseline ${(baselineRate * 100).toFixed(2)}%, current ${(entry.rate * 100).toFixed(2)}%).`,
      });
    }
    if (entry.metric === "oauth_callback" && delta < -callbackRateDropMax) {
      baselineBreaches.push({
        code: `oauth_callback_rate_delta:${entry.provider}`,
        severity: "critical",
        message: `OAuth callback success rate delta for ${entry.provider} is ${(delta * 100).toFixed(2)}pp (baseline ${(baselineRate * 100).toFixed(2)}%, current ${(entry.rate * 100).toFixed(2)}%).`,
      });
    }
    if (entry.metric === "webhook_verify" && delta > webhookFailureIncreaseMax) {
      baselineBreaches.push({
        code: `webhook_verify_failure_delta:${entry.provider}`,
        severity: "critical",
        message: `Webhook verify failure-rate delta for ${entry.provider} is ${(delta * 100).toFixed(2)}pp (baseline ${(baselineRate * 100).toFixed(2)}%, current ${(entry.rate * 100).toFixed(2)}%).`,
      });
    }
  }
}

const allBreaches = [...result.alert_breaches, ...baselineBreaches];

console.log(
  JSON.stringify(
    {
      generated_at: result.generated_at,
      window_minutes: result.window_minutes,
      total_events: result.total_events,
      alert_breaches: allBreaches,
      rates: result.rates,
      baseline_path: baselinePath ?? null,
    },
    null,
    2,
  ),
);

if (allBreaches.length > 0) {
  process.exit(1);
}
