const NAMESPACE_CALL_REGEX = /\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\s*\(/g;
const TOOL_BRIDGE_REGEX = /__keppo_call_tool\s*\(\s*(["'])([^"']+)\1\s*,/g;

export const extractToolReferences = (code: string, allToolNames: Set<string>): string[] => {
  const found = new Set<string>();

  let match: RegExpExecArray | null = null;
  while ((match = NAMESPACE_CALL_REGEX.exec(code)) !== null) {
    const namespace = match[1] ?? "";
    const functionName = match[2] ?? "";
    const toolName = `${namespace}.${functionName}`;
    if (allToolNames.has(toolName)) {
      found.add(toolName);
    }
  }

  while ((match = TOOL_BRIDGE_REGEX.exec(code)) !== null) {
    const toolName = match[2] ?? "";
    if (allToolNames.has(toolName)) {
      found.add(toolName);
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b));
};
