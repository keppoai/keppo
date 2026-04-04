export const ACTION_LABELS = {
  plan: "/plan-issue",
  do: "/do-issue",
} as const;

export const AGENT_LABELS = {
  claude: "?agent:claude",
  codex: "?agent:codex",
  "gh-copilot": "?agent:gh-copilot",
} as const;

export type IssueAction = keyof typeof ACTION_LABELS;
export type AgentChoice = keyof typeof AGENT_LABELS;

export const ALL_WORKFLOW_LABELS = [
  ACTION_LABELS.plan,
  ACTION_LABELS.do,
  AGENT_LABELS.claude,
  AGENT_LABELS.codex,
  AGENT_LABELS["gh-copilot"],
] as const;

export const buildIssueLabels = (action: IssueAction, agents: AgentChoice[]): string[] => {
  const uniqueAgents = Array.from(new Set(agents));
  return [ACTION_LABELS[action], ...uniqueAgents.map((agent) => AGENT_LABELS[agent])];
};

const readValues = (value: string | string[] | undefined): string[] => {
  if (!value) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => entry.split(",")).map((entry) => entry.trim());
};

export const parseActionFromSearchParams = (value: string | string[] | undefined): IssueAction => {
  const candidate = readValues(value)[0]?.toLowerCase();
  return candidate === "plan" ? "plan" : "do";
};

export const parseAgentsFromSearchParams = (
  value: string | string[] | undefined,
): AgentChoice[] => {
  const values = readValues(value).map((entry) => entry.toLowerCase());
  const agents = new Set<AgentChoice>();
  for (const value of values) {
    if (value === "claude" || value === AGENT_LABELS.claude) {
      agents.add("claude");
    }
    if (value === "codex" || value === AGENT_LABELS.codex) {
      agents.add("codex");
    }
    if (value === "gh-copilot" || value === "ghcopilot" || value === AGENT_LABELS["gh-copilot"]) {
      agents.add("gh-copilot");
    }
  }
  if (agents.size === 0) {
    agents.add("codex");
  }
  return Array.from(agents);
};
