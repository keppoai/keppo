export type LogValue = unknown;

export interface Logger {
  debug: (...values: LogValue[]) => void;
  info: (...values: LogValue[]) => void;
  warn: (...values: LogValue[]) => void;
  error: (...values: LogValue[]) => void;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const resolveLogLevel = (): LogLevel => {
  const raw = (process.env.KEPPO_LOG_LEVEL ?? "debug").trim().toLowerCase();
  if (raw in LOG_LEVEL_RANK) {
    return raw as LogLevel;
  }
  return "debug";
};

const shouldLog = (configuredLevel: LogLevel, eventLevel: LogLevel): boolean => {
  return LOG_LEVEL_RANK[eventLevel] >= LOG_LEVEL_RANK[configuredLevel];
};

const getProcessTag = (scope?: string): string =>
  scope ?? process.env.KEPPO_LOG_SOURCE ?? process.env.npm_package_name ?? "keppo";

export const createLogger = (scope?: string): Logger => {
  const tag = `[${getProcessTag(scope)}]`;
  const level = resolveLogLevel();

  return {
    debug: (...values: LogValue[]): void => {
      if (!shouldLog(level, "debug")) {
        return;
      }
      console.debug(`${tag} [debug]`, ...values);
    },
    info: (...values: LogValue[]): void => {
      if (!shouldLog(level, "info")) {
        return;
      }
      console.log(`${tag} [info]`, ...values);
    },
    warn: (...values: LogValue[]): void => {
      if (!shouldLog(level, "warn")) {
        return;
      }
      console.warn(`${tag} [warn]`, ...values);
    },
    error: (...values: LogValue[]): void => {
      if (!shouldLog(level, "error")) {
        return;
      }
      console.error(`${tag} [error]`, ...values);
    },
  };
};
