import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const LOCAL_CONVEX_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const DEFAULT_CONNECT_TIMEOUT_MS = 750;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_READY_RETRY_MS = 500;

const asPositiveInteger = (value: number | string | undefined, fallback: number): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export type LocalConvexTarget = {
  host: string;
  port: number;
};

export const parseLocalConvexTarget = (convexUrl: string | undefined): LocalConvexTarget | null => {
  if (!convexUrl) {
    return null;
  }
  try {
    const parsed = new URL(convexUrl);
    if (!LOCAL_CONVEX_HOSTS.has(parsed.hostname)) {
      return null;
    }
    const port = Number.parseInt(parsed.port, 10);
    if (!Number.isInteger(port) || port <= 0) {
      return null;
    }
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
};

export const readLocalConvexTargetFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): LocalConvexTarget | null => parseLocalConvexTarget(env.CONVEX_URL);

export const canConnectToLocalConvexTarget = async (
  target: LocalConvexTarget,
  timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<boolean> => {
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: target.host, port: target.port }, () => {
        socket.end();
        resolve();
      });
      socket.setTimeout(timeoutMs);
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("timeout"));
      });
      socket.once("error", (error) => {
        socket.destroy();
        reject(error);
      });
    });
    return true;
  } catch {
    return false;
  }
};

export interface WaitForLocalConvexReadyOptions {
  env?: NodeJS.ProcessEnv;
  target?: LocalConvexTarget | null;
  timeoutMs?: number;
  retryMs?: number;
  connectTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  canConnect?: (target: LocalConvexTarget, timeoutMs: number) => Promise<boolean>;
}

export const waitForLocalConvexReady = async (
  options: WaitForLocalConvexReadyOptions = {},
): Promise<boolean> => {
  const target = options.target ?? readLocalConvexTargetFromEnv(options.env);
  if (!target) {
    return true;
  }

  const timeoutMs = asPositiveInteger(
    options.timeoutMs ?? options.env?.KEPPO_CONVEX_READY_TIMEOUT_MS,
    DEFAULT_READY_TIMEOUT_MS,
  );
  const retryMs = asPositiveInteger(
    options.retryMs ?? options.env?.KEPPO_CONVEX_READY_RETRY_MS,
    DEFAULT_READY_RETRY_MS,
  );
  const connectTimeoutMs = asPositiveInteger(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const canConnect = options.canConnect ?? canConnectToLocalConvexTarget;
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    if (await canConnect(target, connectTimeoutMs)) {
      return true;
    }
    await sleep(retryMs);
  }

  return false;
};

export const createMemoizedReadinessCheck = (
  waitForReadiness: () => Promise<boolean>,
): (() => Promise<boolean>) => {
  let inFlight: Promise<boolean> | null = null;

  return async (): Promise<boolean> => {
    if (!inFlight) {
      inFlight = waitForReadiness();
    }
    try {
      const ready = await inFlight;
      if (!ready) {
        inFlight = null;
      }
      return ready;
    } catch {
      inFlight = null;
      return false;
    }
  };
};
