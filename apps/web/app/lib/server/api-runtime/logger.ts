import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import pino, { type Logger as PinoLogger, type LoggerOptions } from "pino";
import { getEnv } from "./env.js";

export type LogMetadata = Record<string, unknown>;

export type AppLogger = {
  debug: (message: string, metadata?: LogMetadata) => void;
  info: (message: string, metadata?: LogMetadata) => void;
  warn: (message: string, metadata?: LogMetadata) => void;
  error: (message: string, metadata?: LogMetadata) => void;
  child: (bindings: LogMetadata) => AppLogger;
};

const REQUEST_ID_HEADER = "x-request-id";
const MAX_REQUEST_ID_LENGTH = 128;
const requestLoggerStorage = new AsyncLocalStorage<PinoLogger>();

let rootLogger: PinoLogger | null = null;

const resolveEnvironment = (): string => {
  const env = getEnv();
  const normalized = env.NODE_ENV?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "development";
};

const createRootLogger = (): PinoLogger => {
  const env = getEnv();
  const environment = resolveEnvironment();
  const isPretty = !env.KEPPO_E2E_MODE && (environment === "development" || environment === "test");

  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: {
      service: "keppo-web",
      environment,
      version: process.env.npm_package_version ?? "0.1.0",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["req.headers.authorization", "*.token", "*.secret", "*.enc"],
      censor: "[REDACTED]",
    },
  };

  if (!isPretty) {
    return pino(options);
  }

  return pino(
    options,
    pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    }),
  );
};

const getRootLogger = (): PinoLogger => {
  if (!rootLogger) {
    rootLogger = createRootLogger();
  }
  return rootLogger;
};

const resolveActiveLogger = (): PinoLogger => {
  return requestLoggerStorage.getStore() ?? getRootLogger();
};

const toLoggedError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    message: String(error),
  };
};

const normalizeMetadata = (metadata?: LogMetadata): LogMetadata | undefined => {
  if (!metadata) {
    return undefined;
  }
  const normalized: LogMetadata = { ...metadata };
  if ("error" in normalized) {
    normalized.error = toLoggedError(normalized.error);
  }
  return normalized;
};

const createLoggerFacade = (resolveLogger: () => PinoLogger): AppLogger => {
  const log = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    metadata?: LogMetadata,
  ): void => {
    const logger = resolveLogger();
    const fields = normalizeMetadata(metadata);
    if (fields) {
      logger[level](fields, message);
      return;
    }
    logger[level](message);
  };

  return {
    debug: (message, metadata) => log("debug", message, metadata),
    info: (message, metadata) => log("info", message, metadata),
    warn: (message, metadata) => log("warn", message, metadata),
    error: (message, metadata) => log("error", message, metadata),
    child: (bindings) => {
      const child = resolveLogger().child(bindings);
      return createLoggerFacade(() => child);
    },
  };
};

export const logger: AppLogger = createLoggerFacade(resolveActiveLogger);

export const withRequestLoggerContext = async <T>(
  bindings: LogMetadata,
  callback: (requestLogger: AppLogger) => Promise<T>,
): Promise<T> => {
  const scopedLogger = getRootLogger().child(bindings);
  const requestLogger = createLoggerFacade(() => scopedLogger);
  return await requestLoggerStorage.run(scopedLogger, async () => await callback(requestLogger));
};

type HeaderSource =
  | Headers
  | Request
  | {
      headers?: Headers | null | undefined;
      req?: {
        raw?: Request | null | undefined;
        header?: ((name: string) => string | undefined) | null | undefined;
      };
    };

const resolveHeaderValue = (source: HeaderSource, name: string): string | null => {
  if (source instanceof Request) {
    return source.headers.get(name);
  }
  if (source instanceof Headers) {
    return source.get(name);
  }
  if (source.headers instanceof Headers) {
    return source.headers.get(name);
  }
  const requestHeader = source.req?.raw?.headers.get(name);
  if (typeof requestHeader === "string") {
    return requestHeader;
  }
  const honoHeader = source.req?.header?.(name);
  return typeof honoHeader === "string" ? honoHeader : null;
};

export const resolveRequestId = (source: HeaderSource): string => {
  const rawHeader = resolveHeaderValue(source, REQUEST_ID_HEADER);
  if (!rawHeader) {
    return randomUUID();
  }
  const normalized = rawHeader.trim();
  if (!normalized || normalized.length > MAX_REQUEST_ID_LENGTH) {
    return randomUUID();
  }
  return normalized;
};

export const getRequestLogger = (source?: { get?: (key: string) => unknown } | null): AppLogger => {
  const scoped = source?.get?.("log");
  if (scoped) {
    return scoped as AppLogger;
  }
  return logger;
};
