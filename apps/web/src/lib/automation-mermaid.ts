type DescriptionBlock =
  | { type: "markdown"; content: string }
  | { type: "mermaid"; content: string }
  | { type: "code"; language: string | null; content: string };

export type AutomationDescriptionParts = {
  description: string;
  mermaidContent: string | null;
};

const FLOWCHART_HEADER_RE = /^\s*(flowchart|graph)\b/im;
const FLOWCHART_SQUARE_NODE_RE = /(\b[A-Za-z0-9_]+)\[([^\]\n]+)\]/g;
const FLOWCHART_DECISION_NODE_RE = /(\b[A-Za-z0-9_]+)\{\s*([^{}\n]+?)\s*\}/g;

export function parseDescriptionBlocks(description: string): DescriptionBlock[] {
  if (!description.trim()) {
    return [];
  }

  const blocks: DescriptionBlock[] = [];
  const fencePattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;

  for (const match of description.matchAll(fencePattern)) {
    const matchIndex = match.index ?? 0;
    const prefix = description.slice(lastIndex, matchIndex).trim();
    if (prefix) {
      blocks.push({ type: "markdown", content: prefix });
    }

    const language = match[1]?.trim().toLowerCase() ?? null;
    const content = match[2]?.trim() ?? "";
    if (language === "mermaid") {
      blocks.push({ type: "mermaid", content });
    } else {
      blocks.push({ type: "code", language, content });
    }

    lastIndex = matchIndex + match[0].length;
  }

  const suffix = description.slice(lastIndex).trim();
  if (suffix) {
    blocks.push({ type: "markdown", content: suffix });
  }

  return blocks;
}

export function splitAutomationDescription(
  description: string,
  mermaidContent: string | null | undefined,
): AutomationDescriptionParts {
  const normalizedMermaid = mermaidContent?.trim() || null;
  if (normalizedMermaid) {
    return {
      description: description.trim(),
      mermaidContent: normalizedMermaid,
    };
  }

  const legacyMatch = /```mermaid\s*\n([\s\S]*?)```/i.exec(description);
  if (!legacyMatch?.[1]) {
    return {
      description: description.trim(),
      mermaidContent: null,
    };
  }

  const nextDescription = description
    .replace(legacyMatch[0], "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    description: nextDescription,
    mermaidContent: legacyMatch[1].trim() || null,
  };
}

export function normalizeMermaidContent(chart: string): string {
  const trimmed = chart.trim();
  if (!trimmed || !FLOWCHART_HEADER_RE.test(trimmed)) {
    return trimmed;
  }

  const normalizeNodeLabel = (rawLabel: string): string => {
    const label = rawLabel.trim();
    if (!label) {
      return label;
    }
    if (label.startsWith('"') && label.endsWith('"')) {
      return label;
    }

    return `"${label.replace(/"/g, '\\"')}"`;
  };

  return trimmed
    .replace(FLOWCHART_SQUARE_NODE_RE, (_match, nodeId: string, rawLabel: string) => {
      return `${nodeId}[${normalizeNodeLabel(rawLabel)}]`;
    })
    .replace(FLOWCHART_DECISION_NODE_RE, (_match, nodeId: string, rawLabel: string) => {
      return `${nodeId}{${normalizeNodeLabel(rawLabel)}}`;
    });
}

export async function validateMermaidContent(chart: string): Promise<string | null> {
  const trimmed = normalizeMermaidContent(chart);
  if (!trimmed) {
    return null;
  }

  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
    });
    await mermaid.parse(trimmed, { suppressErrors: false });
    return null;
  } catch (caught) {
    return caught instanceof Error ? caught.message : "Enter a valid Mermaid diagram.";
  }
}
