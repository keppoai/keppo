# MCP surface and protocol handling

## Transport

- Keppo exposes Streamable HTTP MCP at `GET|POST|DELETE /mcp/:workspaceId`, owned by the TanStack Start runtime in `apps/web`.
- Clients authenticate with a workspace bearer credential from `workspace_credentials`.
- `POST` handles MCP requests.
- Hosted deployments may return `405 Method Not Allowed` for the optional `GET` common SSE stream; compliant clients must continue over request/response `POST`.
- `DELETE` closes the session when the serving instance still owns the transport; otherwise the API treats the request as an idempotent durable close against the backing run.

## Session lifecycle

- `initialize` creates an MCP session and a backing Convex run.
- Subsequent requests must send `Mcp-Session-Id`; the API resolves that session back to the stored run and touches it on each request.
- Closing the transport closes the matching run.

## Tool catalog behavior

- The API resolves a workspace-scoped tool catalog through Convex.
- Built-in provider tools come from the shared provider registry.
- Enabled custom MCP tools are merged into the same catalog.
- Custom MCP discovery and execution use stored org-scoped server credentials and shared request-scoped client exchanges; callers do not supply remote credentials at execution time.
- When Code Mode is enabled, `tools/list` advertises `search_tools` and `execute_code` instead of the raw built-in provider catalog; custom MCP tools still appear.

## Tool execution

- Built-in tools execute through `executeToolCall`.
- Custom MCP tools execute through `executeCustomToolCall`.
- Approval-required writes return structured pending results that reference the created action.
- `execute_code` runs sandboxed JavaScript, generates a typed SDK from the tool registry, and reuses the same gating rules for any provider calls made inside the sandbox.

## Boundary rules

- Request params, auth headers, and JSON-RPC envelopes are validated before execution.
- Client-facing errors are sanitized and capped.
- Tool-call branches that return MCP error results directly, including structured `execute_code` failures that do not escape as thrown exceptions, must emit a warning log before responding so request-scoped Vercel logs can still reconstruct the failure.
- MCP auth failures, per-credential request rates, and body-size limits are enforced on the API boundary.
