import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

export type KeppoRuntimeEnvironment = "development" | "preview" | "staging" | "production";
export type VercelApiRuntimeEnvironment = Exclude<KeppoRuntimeEnvironment, "development">;
type BundledRuntimeEnvironment = VercelApiRuntimeEnvironment;
type BundledRuntimeEnvFiles = Partial<Record<BundledRuntimeEnvironment, string>>;
type RuntimeEnvSource =
  | { kind: "bundled"; contents: string }
  | { kind: "files"; filepaths: string[] };

const RUNTIME_ENV_SEARCH_DIRS = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
const RUNTIME_ENV_FILENAME = {
  preview: ".env.preview",
  staging: ".env.staging",
  production: ".env.production",
} as const;
const BUNDLED_RUNTIME_ENV_BASE = "assets:runtime-env";

let runtimeEnvLoaded = false;

const trimEnvValue = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const isHostedApiRuntimeEnvironment = (
  value: string | undefined,
): value is VercelApiRuntimeEnvironment => {
  const normalized = trimEnvValue(value)?.toLowerCase();
  return normalized === "preview" || normalized === "staging" || normalized === "production";
};

export const resolveKeppoRuntimeEnvironment = (
  env: NodeJS.ProcessEnv,
): VercelApiRuntimeEnvironment => {
  const explicitEnvironment = trimEnvValue(env.KEPPO_ENVIRONMENT)?.toLowerCase();
  if (
    explicitEnvironment === "preview" ||
    explicitEnvironment === "staging" ||
    explicitEnvironment === "production"
  ) {
    return explicitEnvironment;
  }
  if (explicitEnvironment === "development") {
    throw new Error(
      "Unsupported KEPPO_ENVIRONMENT 'development' for the Vercel API entrypoint. Expected preview, staging, or production.",
    );
  }
  throw new Error(
    "Missing KEPPO_ENVIRONMENT for the Vercel API entrypoint. Expected preview, staging, or production.",
  );
};

export const resolveRuntimeEnvFiles = (
  rootDir: string,
  environment: VercelApiRuntimeEnvironment,
): string[] => {
  switch (environment) {
    case "preview":
      return [resolve(rootDir, RUNTIME_ENV_FILENAME.preview)];
    case "staging":
      return [resolve(rootDir, RUNTIME_ENV_FILENAME.staging)];
    case "production":
      return [resolve(rootDir, RUNTIME_ENV_FILENAME.production)];
  }
};

export const normalizeBundledRuntimeEnvContents = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value.length > 0 ? value : undefined;
  }

  if (value instanceof Uint8Array) {
    return value.byteLength > 0 ? new TextDecoder().decode(value) : undefined;
  }

  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0 ? new TextDecoder().decode(new Uint8Array(value)) : undefined;
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength > 0
      ? new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      : undefined;
  }

  return undefined;
};

const loadBundledRuntimeEnvFiles = async (): Promise<BundledRuntimeEnvFiles> => {
  try {
    const { useStorage } = await import("nitro/storage");
    const storage = useStorage(BUNDLED_RUNTIME_ENV_BASE);
    const entries = await Promise.all(
      (
        Object.entries(RUNTIME_ENV_FILENAME) as Array<
          [BundledRuntimeEnvironment, (typeof RUNTIME_ENV_FILENAME)[BundledRuntimeEnvironment]]
        >
      ).map(async ([environment, filename]) => {
        const contents = normalizeBundledRuntimeEnvContents(await storage.getItem(filename));
        return contents ? ([environment, contents] as const) : undefined;
      }),
    );
    return Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [BundledRuntimeEnvironment, string] => entry !== undefined,
      ),
    );
  } catch {
    return {};
  }
};

const BUNDLED_RUNTIME_ENV_FILES = isHostedApiRuntimeEnvironment(process.env.KEPPO_ENVIRONMENT)
  ? await loadBundledRuntimeEnvFiles()
  : {};

const findRuntimeEnvFile = (
  startDir: string,
  environment: BundledRuntimeEnvironment,
  pathExists: (path: string) => boolean = existsSync,
): string | undefined => {
  const filename = RUNTIME_ENV_FILENAME[environment];
  let currentDir = resolve(startDir);
  while (true) {
    const candidate = resolve(currentDir, filename);
    if (pathExists(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
};

export const resolveRuntimeEnvFilesFromSearchDirs = (
  searchDirs: readonly string[],
  environment: VercelApiRuntimeEnvironment,
  pathExists: (path: string) => boolean = existsSync,
): string[] => {
  for (const searchDir of searchDirs) {
    const filepath = findRuntimeEnvFile(searchDir, environment, pathExists);
    if (filepath) {
      return [filepath];
    }
  }

  return resolveRuntimeEnvFiles(searchDirs[0] ?? process.cwd(), environment);
};

export const resolveRuntimeEnvSource = (
  environment: VercelApiRuntimeEnvironment,
  searchDirs: readonly string[],
  bundledEnvFiles: BundledRuntimeEnvFiles,
  pathExists: (path: string) => boolean = existsSync,
): RuntimeEnvSource => {
  const bundledContents = bundledEnvFiles[environment];
  if (bundledContents) {
    return { kind: "bundled", contents: bundledContents };
  }

  return {
    kind: "files",
    filepaths: resolveRuntimeEnvFilesFromSearchDirs(searchDirs, environment, pathExists),
  };
};

const applyRuntimeEnv = (contents: string): void => {
  const parsed = parseEnv(contents);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

export const loadApiRuntimeEnv = (): void => {
  if (runtimeEnvLoaded) {
    return;
  }

  const environment = resolveKeppoRuntimeEnvironment(process.env);
  const envSource = resolveRuntimeEnvSource(
    environment,
    RUNTIME_ENV_SEARCH_DIRS,
    BUNDLED_RUNTIME_ENV_FILES,
  );
  if (envSource.kind === "bundled") {
    applyRuntimeEnv(envSource.contents);
    runtimeEnvLoaded = true;
    return;
  }

  const envFiles = envSource.filepaths;
  for (const filepath of envFiles) {
    if (!existsSync(filepath)) {
      throw new Error(`Missing env file for KEPPO_ENVIRONMENT=${environment}: ${filepath}`);
    }
  }

  for (const filepath of envFiles) {
    applyRuntimeEnv(readFileSync(filepath, "utf8"));
  }

  runtimeEnvLoaded = true;
};

export const maybeLoadApiRuntimeEnv = (): void => {
  if (!isHostedApiRuntimeEnvironment(process.env.KEPPO_ENVIRONMENT)) {
    return;
  }

  loadApiRuntimeEnv();
};

export const resetApiRuntimeEnvForTest = (): void => {
  runtimeEnvLoaded = false;
};
