import { getServerEnv } from "./env";

const GITHUB_API_BASE = "https://api.github.com";

type GithubRequestOptions = {
  token?: string | null;
  method?: string;
  body?: string;
};

const fetchGithubJson = async <T>(path: string, options: GithubRequestOptions = {}): Promise<T> => {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "izzy-issue-authoring-app",
  });
  if (options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body ? { body: options.body } : {}),
    cache: "no-store",
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`github_api_${response.status}: ${errorText}`);
  }
  return (await response.json()) as T;
};

export const getRepositoryLabels = async (token?: string | null): Promise<string[]> => {
  const env = getServerEnv();
  const labels = await fetchGithubJson<Array<{ name?: string }>>(
    `/repos/${env.IZZY_TARGET_REPO_OWNER}/${env.IZZY_TARGET_REPO_NAME}/labels?per_page=100`,
    token ? { token } : {},
  );
  return labels.map((label) => String(label.name ?? "")).filter((label) => label.length > 0);
};

export const createRepositoryIssue = async (params: {
  token: string;
  title: string;
  body: string;
  labels: string[];
}): Promise<{ number: number; html_url: string }> => {
  const env = getServerEnv();
  return await fetchGithubJson<{ number: number; html_url: string }>(
    `/repos/${env.IZZY_TARGET_REPO_OWNER}/${env.IZZY_TARGET_REPO_NAME}/issues`,
    {
      method: "POST",
      token: params.token,
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        labels: params.labels,
      }),
    },
  );
};

export const fetchRepositoryFile = async (path: string): Promise<string> => {
  const env = getServerEnv();
  const response = await fetch(
    `https://raw.githubusercontent.com/${env.IZZY_TARGET_REPO_OWNER}/${env.IZZY_TARGET_REPO_NAME}/${env.IZZY_TARGET_REPO_REF}/${path}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`github_raw_${response.status}: ${path}`);
  }
  return await response.text();
};
