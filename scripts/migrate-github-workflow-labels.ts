type LabelMapping = {
  from: string;
  to: string;
};

type RepoLabel = {
  name: string;
  color: string;
  description: string | null;
};

const LABEL_MAPPINGS: LabelMapping[] = [];

function parseArgs(argv: string[]) {
  const args = {
    write: false,
    repo: process.env.GITHUB_REPOSITORY ?? "",
  };

  for (const arg of argv) {
    if (arg === "--write") {
      args.write = true;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      args.repo = arg.slice("--repo=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.repo || !args.repo.includes("/")) {
    throw new Error("Set GITHUB_REPOSITORY or pass --repo=owner/name");
  }

  return args;
}

function getToken(): string {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_PAT ?? "";
  if (!token) {
    throw new Error("Set GITHUB_TOKEN, GH_TOKEN, or GITHUB_PAT");
  }
  return token;
}

async function githubRequest<T>(path: string, init: RequestInit, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "keppo-label-migration",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} ${response.statusText} for ${path}: ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function listLabels(repo: string, token: string): Promise<RepoLabel[]> {
  const [owner, name] = repo.split("/", 2);
  const labels: RepoLabel[] = [];

  for (let page = 1; ; page += 1) {
    const pageLabels = await githubRequest<RepoLabel[]>(
      `/repos/${owner}/${name}/labels?per_page=100&page=${page}`,
      { method: "GET" },
      token,
    );
    labels.push(...pageLabels);
    if (pageLabels.length < 100) {
      return labels;
    }
  }
}

async function renameLabel(repo: string, from: string, to: string, token: string): Promise<void> {
  const [owner, name] = repo.split("/", 2);
  await githubRequest(
    `/repos/${owner}/${name}/labels/${encodeURIComponent(from)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ new_name: to }),
    },
    token,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = getToken();
  const labels = await listLabels(args.repo, token);
  const labelNames = new Set(labels.map((label) => label.name));
  let renameCount = 0;

  console.log(`${args.write ? "Applying" : "Dry run for"} workflow label rename in ${args.repo}`);

  for (const { from, to } of LABEL_MAPPINGS) {
    const hasFrom = labelNames.has(from);
    const hasTo = labelNames.has(to);

    if (!hasFrom) {
      console.log(`- Skip ${from} -> ${to} (legacy label not found)`);
      continue;
    }

    if (hasTo) {
      console.log(`- Skip ${from} -> ${to} (target label already exists)`);
      continue;
    }

    renameCount += 1;
    console.log(`- Rename ${from} -> ${to}`);

    if (args.write) {
      await renameLabel(args.repo, from, to, token);
    }
  }

  if (!args.write) {
    console.log(
      `No GitHub state was changed. ${renameCount} label rename${renameCount === 1 ? "" : "s"} would be applied with --write.`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
