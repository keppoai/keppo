export const MCP_CREDENTIAL_AUTH_STATUSES = ["ok", "suspended", "locked"] as const;

export type McpCredentialAuthStatus = (typeof MCP_CREDENTIAL_AUTH_STATUSES)[number];

export const MCP_CREDENTIAL_AUTH_STATUS = {
  ok: "ok",
  suspended: "suspended",
  locked: "locked",
} as const satisfies Record<string, McpCredentialAuthStatus>;
