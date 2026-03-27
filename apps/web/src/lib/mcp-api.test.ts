import { describe, expect, it, vi } from "vitest";
import {
  dispatchStartOwnedMcpRequest,
  handleStartOwnedMcpRequest,
  isStartOwnedMcpPath,
} from "../../app/lib/server/mcp-api";

describe("start-owned mcp api handlers", () => {
  it("claims only the root MCP transport family", () => {
    expect(isStartOwnedMcpPath("/mcp/ws_test")).toBe(true);
    expect(isStartOwnedMcpPath("/mcp/ws_test/extra")).toBe(false);
    expect(isStartOwnedMcpPath("/api/mcp/test")).toBe(false);
  });

  it("dispatches only matching Start-owned MCP routes", async () => {
    const app = {
      fetch: vi.fn(async (request: Request) =>
        Response.json(
          {
            pathname: new URL(request.url).pathname,
          },
          { status: 200 },
        ),
      ),
    };

    const handled = await dispatchStartOwnedMcpRequest(
      new Request("http://127.0.0.1/mcp/ws_test", {
        method: "POST",
      }),
      app,
    );
    const unhandled = await dispatchStartOwnedMcpRequest(
      new Request("http://127.0.0.1/internal/cron/maintenance", {
        method: "POST",
      }),
      app,
    );

    expect(handled?.status).toBe(200);
    await expect(handled?.json()).resolves.toEqual({
      pathname: "/mcp/ws_test",
    });
    expect(unhandled).toBeNull();
    expect(app.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns not found for unrelated requests", async () => {
    const app = {
      fetch: vi.fn(async () => new Response("unexpected", { status: 500 })),
    };

    const response = await handleStartOwnedMcpRequest(new Request("http://127.0.0.1/health"), app);

    expect(response.status).toBe(404);
    expect(app.fetch).not.toHaveBeenCalled();
  });
});
