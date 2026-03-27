import { z } from "zod";

const envSchema = z.object({
  GITHUB_ID: z.string().min(1, "Missing GITHUB_ID"),
  GITHUB_SECRET: z.string().min(1, "Missing GITHUB_SECRET"),
  NEXTAUTH_SECRET: z.string().min(1, "Missing NEXTAUTH_SECRET"),
  NEXTAUTH_URL: z.string().url("NEXTAUTH_URL must be a valid URL"),
  IZZY_ALLOWED_GITHUB_USERS: z.string().min(1, "Missing IZZY_ALLOWED_GITHUB_USERS"),
  IZZY_OPENAI_API_KEY: z.string().min(1, "Missing IZZY_OPENAI_API_KEY"),
  IZZY_AI_MODEL: z.string().default("gpt-4.1-mini"),
  IZZY_TARGET_REPO_OWNER: z.string().default("keppoai"),
  IZZY_TARGET_REPO_NAME: z.string().default("keppo"),
  IZZY_TARGET_REPO_ID: z
    .string()
    .regex(/^\d+$/, "IZZY_TARGET_REPO_ID must be a numeric GitHub repository id"),
  IZZY_TARGET_REPO_REF: z.string().default("main"),
  IZZY_BLOB_READ_WRITE_TOKEN: z.string().optional(),
  IZZY_BLOB_BASE_PATH: z.string().default("izzy-issue-images"),
  IZZY_E2E_PREVIEW_LOGIN: z.string().optional(),
});

export type IzzyEnv = z.infer<typeof envSchema>;

let cachedEnv: IzzyEnv | null = null;

export const getServerEnv = (): IzzyEnv => {
  if (cachedEnv) {
    return cachedEnv;
  }
  cachedEnv = envSchema.parse({
    GITHUB_ID: process.env.GITHUB_ID,
    GITHUB_SECRET: process.env.GITHUB_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    IZZY_ALLOWED_GITHUB_USERS: process.env.IZZY_ALLOWED_GITHUB_USERS,
    IZZY_OPENAI_API_KEY: process.env.IZZY_OPENAI_API_KEY,
    IZZY_AI_MODEL: process.env.IZZY_AI_MODEL,
    IZZY_TARGET_REPO_OWNER: process.env.IZZY_TARGET_REPO_OWNER,
    IZZY_TARGET_REPO_NAME: process.env.IZZY_TARGET_REPO_NAME,
    IZZY_TARGET_REPO_ID: process.env.IZZY_TARGET_REPO_ID,
    IZZY_TARGET_REPO_REF: process.env.IZZY_TARGET_REPO_REF,
    IZZY_BLOB_READ_WRITE_TOKEN: process.env.IZZY_BLOB_READ_WRITE_TOKEN,
    IZZY_BLOB_BASE_PATH: process.env.IZZY_BLOB_BASE_PATH,
    IZZY_E2E_PREVIEW_LOGIN: process.env.IZZY_E2E_PREVIEW_LOGIN,
  });
  return cachedEnv;
};

export const getAllowlistedGithubUsers = (): Set<string> => {
  const raw = getServerEnv().IZZY_ALLOWED_GITHUB_USERS;
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
};
