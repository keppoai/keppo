export const CODE_MODE_TOOLS = [
  {
    name: "search_tools",
    description:
      "Search tools that are currently usable in this workspace. Returns tool names, descriptions, capabilities, risk levels, and input schemas, but excludes providers that are disconnected or disabled here. Use this before writing code for execute_code.",
  },
  {
    name: "execute_code",
    description:
      "Execute JavaScript code that calls provider tools through typed SDK functions. Available namespaces: gmail, slack, github, stripe, notion, reddit, x, custom. Use search_tools first to discover which functions are actually usable in this workspace. Code runs in a sandboxed environment with a 30-second timeout and returns short structured failure payloads for approvals, blocks, validation errors, and sandbox/runtime failures.",
  },
] as const;
