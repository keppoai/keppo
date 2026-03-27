import { access, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fetchRepositoryFile } from "./github-client";

type RepoContextDefinition = {
  path: string;
  tags: string[];
  description: string;
};

export type RepoContextSnippet = {
  path: string;
  description: string;
  snippet: string;
};

const CACHE_TTL_MS = 5 * 60_000;
const MAX_SNIPPET_LENGTH = 1_200;
const MAX_FILES = 6;

const contextFiles: RepoContextDefinition[] = [
  {
    path: "AGENTS.md",
    tags: ["rules", "instructions", "testing", "plans", "issues"],
    description: "Repo-wide agent instructions and workflow rules.",
  },
  {
    path: "docs/github-label-workflows.md",
    tags: ["labels", "plan-issue", "do-issue", "claude", "codex", "agents"],
    description: "Human-applied and workflow-owned GitHub labels.",
  },
  {
    path: "docs/setup.md",
    tags: ["setup", "runtime", "oauth", "env", "git-host"],
    description: "Runtime and environment requirements.",
  },
  {
    path: "docs/rules/security.md",
    tags: ["security", "auth", "oauth", "uploads", "api"],
    description: "Security guardrails for auth, APIs, and uploads.",
  },
  {
    path: "docs/rules/ux.md",
    tags: ["ux", "forms", "loading", "errors", "mobile"],
    description: "UX and interaction-quality rules.",
  },
  {
    path: "docs/specs/high-level-architecture.md",
    tags: ["architecture", "api", "browser", "ownership"],
    description: "High-level system architecture.",
  },
  {
    path: ".github/workflows/issue-agent.yml",
    tags: ["workflow", "plan-issue", "do-issue", "labels", "agents"],
    description: "GitHub issue workflow implementation.",
  },
  {
    path: "package.json",
    tags: ["workspace", "scripts", "testing", "build"],
    description: "Root workspace scripts and tooling.",
  },
  {
    path: "turbo.json",
    tags: ["turbo", "build", "test", "workspace"],
    description: "Turbo task wiring.",
  },
];

const cache = new Map<string, { expiresAt: number; value: string }>();

const localRepoRoots = [process.cwd(), path.resolve(process.cwd(), "..", "..")];

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);

const scoreDefinition = (definition: RepoContextDefinition, tokens: string[]): number => {
  const haystack =
    `${definition.path} ${definition.tags.join(" ")} ${definition.description}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
};

const getFileContents = async (filePath: string): Promise<string> => {
  const now = Date.now();
  const cached = cache.get(filePath);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let value: string | null = null;
  for (const root of localRepoRoots) {
    const fullPath = path.join(root, filePath);
    try {
      await access(fullPath);
      value = await readFile(fullPath, "utf8");
      break;
    } catch {
      continue;
    }
  }

  if (value === null) {
    value = await fetchRepositoryFile(filePath);
  }

  cache.set(filePath, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
};

const extractSnippet = (contents: string, prompt: string): string => {
  const normalized = contents.replace(/\r\n/g, "\n");
  const promptTokens = tokenize(prompt);
  const firstMatch = promptTokens
    .map((token) => normalized.toLowerCase().indexOf(token))
    .find((index) => index !== undefined && index >= 0);
  if (firstMatch === undefined || firstMatch < 0) {
    return normalized.slice(0, MAX_SNIPPET_LENGTH).trim();
  }
  const start = Math.max(0, firstMatch - 280);
  const end = Math.min(normalized.length, start + MAX_SNIPPET_LENGTH);
  return normalized.slice(start, end).trim();
};

export const getRepoContextForPrompt = async (prompt: string): Promise<RepoContextSnippet[]> => {
  const tokens = tokenize(prompt);
  const ranked = [...contextFiles]
    .sort((left, right) => scoreDefinition(right, tokens) - scoreDefinition(left, tokens))
    .slice(0, MAX_FILES);

  return await Promise.all(
    ranked.map(async (definition) => {
      const contents = await getFileContents(definition.path);
      return {
        path: definition.path,
        description: definition.description,
        snippet: extractSnippet(contents, prompt),
      };
    }),
  );
};

export const formatRepoContextForPrompt = (snippets: RepoContextSnippet[]): string =>
  snippets
    .map((snippet) => `### ${snippet.path}\n${snippet.description}\n\n${snippet.snippet}`.trim())
    .join("\n\n");
