import { beforeEach, describe, expect, it, vi } from "vitest";

const handleProviderWebhookRequest = vi.fn(
  async () => new Response("mocked webhook boundary", { status: 202 }),
);
const dispatchStartOwnedAdminHealthRequest = vi.fn(async () => null);
const dispatchStartOwnedAutomationApiRequest = vi.fn(async () => null);
const dispatchStartOwnedBillingRequest = vi.fn(async (request: Request) => {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/billing/checkout") {
    return new Response("mocked billing api boundary", { status: 201 });
  }
  if (pathname === "/billing/checkout" || pathname === "/webhooks/stripe-billing") {
    return new Response("mocked billing root boundary", { status: 202 });
  }
  return null;
});
const dispatchStartOwnedDocsSearchRequest = vi.fn(async (request: Request) => {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/search") {
    return Response.json([
      {
        id: "/docs/user-guide/automations/building-automations",
        url: "/docs/user-guide/automations/building-automations",
        title: "Building Automations",
      },
    ]);
  }
  return null;
});
const dispatchStartOwnedInternalApiRequest = vi.fn(async () => null);
const dispatchStartOwnedOAuthApiRequest = vi.fn(async () => null);
const dispatchStartOwnedOperationalRequest = vi.fn(
  async () => new Response("mocked operational boundary", { status: 202 }),
);
const handleStartOwnedMcpRequest = vi.fn(
  async () => new Response("mocked mcp boundary", { status: 203 }),
);
const handleOAuthProviderCallbackRequest = vi.fn(
  async () =>
    new Response(null, {
      status: 302,
      headers: {
        Location: "http://127.0.0.1/integrations?integration_connected=google",
      },
    }),
);

vi.mock("../../app/lib/server/webhook-api", () => ({
  handleProviderWebhookRequest,
}));
vi.mock("../../app/lib/server/admin-health-api", () => ({
  dispatchStartOwnedAdminHealthRequest,
}));
vi.mock("../../app/lib/server/automation-api", () => ({
  dispatchStartOwnedAutomationApiRequest,
}));
vi.mock("../../app/lib/server/billing-api", () => ({
  dispatchStartOwnedBillingRequest,
}));
vi.mock("../../app/lib/server/search-api", () => ({
  dispatchStartOwnedDocsSearchRequest,
}));
vi.mock("../../app/lib/server/internal-api", () => ({
  dispatchStartOwnedInternalApiRequest,
}));
vi.mock("../../app/lib/server/oauth-api", () => ({
  dispatchStartOwnedOAuthApiRequest,
  handleOAuthProviderCallbackRequest,
}));
vi.mock("../../app/lib/server/operational-api", () => ({
  dispatchStartOwnedOperationalRequest,
}));
vi.mock("../../app/lib/server/mcp-api", () => ({
  handleStartOwnedMcpRequest,
}));
describe("server entry root routing", () => {
  beforeEach(() => {
    dispatchStartOwnedAdminHealthRequest.mockClear();
    dispatchStartOwnedAutomationApiRequest.mockClear();
    dispatchStartOwnedBillingRequest.mockClear();
    dispatchStartOwnedDocsSearchRequest.mockClear();
    dispatchStartOwnedInternalApiRequest.mockClear();
    dispatchStartOwnedOAuthApiRequest.mockClear();
    handleProviderWebhookRequest.mockClear();
    dispatchStartOwnedOperationalRequest.mockClear();
    handleStartOwnedMcpRequest.mockClear();
    handleOAuthProviderCallbackRequest.mockClear();
  });

  it("routes provider webhooks through the Start-owned server handler instead of the HTML shell", async () => {
    const { default: server } = await import("../server");
    const response = await server.fetch(
      new Request("http://127.0.0.1/webhooks/unknown-provider", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );

    expect(handleProviderWebhookRequest).toHaveBeenCalledTimes(1);
    expect(handleProviderWebhookRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).not.toContain("text/html");
    await expect(response.text()).resolves.toBe("mocked webhook boundary");
  });

  it("routes migrated internal/download operational paths through the Start-owned handler", async () => {
    const { default: server } = await import("../server");
    const response = await server.fetch(
      new Request("http://127.0.0.1/internal/cron/maintenance", {
        method: "POST",
        headers: {
          authorization: "Bearer secret_token",
        },
      }),
    );

    expect(dispatchStartOwnedOperationalRequest).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe("mocked operational boundary");
  });

  it("does not fall back to a legacy root bridge for migrated protocol paths", async () => {
    const { default: server } = await import("../server");
    const internalResponse = await server.fetch(
      new Request("http://127.0.0.1/internal/automations/dispatch", {
        method: "POST",
        headers: {
          authorization: "Bearer secret_token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ automation_run_id: "arun_test" }),
      }),
    );
    const mcpResponse = await server.fetch(
      new Request("http://127.0.0.1/mcp/ws_test", {
        method: "POST",
      }),
    );

    expect(dispatchStartOwnedOperationalRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(handleStartOwnedMcpRequest).toHaveBeenCalledTimes(1);
    expect(internalResponse.status).toBe(202);
    expect(mcpResponse.status).toBe(203);
  });

  it("routes oauth callbacks through the Start-owned server handler instead of the HTML shell", async () => {
    const { default: server } = await import("../server");
    const response = await server.fetch(
      new Request(
        "http://127.0.0.1/oauth/integrations/google/callback?code=oauth_code_test&state=signed_state",
        {
          method: "GET",
        },
      ),
    );

    expect(handleOAuthProviderCallbackRequest).toHaveBeenCalledTimes(1);
    expect(handleOAuthProviderCallbackRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(dispatchStartOwnedOperationalRequest).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("integration_connected=google");
  });

  it("routes same-origin api surfaces through the unified server dispatchers", async () => {
    const { default: server } = await import("../server");
    const response = await server.fetch(
      new Request("http://127.0.0.1/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          orgId: "org_test",
          tier: "starter",
        }),
      }),
    );

    expect(dispatchStartOwnedBillingRequest).toHaveBeenCalledTimes(1);
    expect(dispatchStartOwnedInternalApiRequest).toHaveBeenCalledTimes(0);
    expect(dispatchStartOwnedAdminHealthRequest).toHaveBeenCalledTimes(1);
    expect(dispatchStartOwnedAutomationApiRequest).toHaveBeenCalledTimes(0);
    expect(response.status).toBe(201);
    await expect(response.text()).resolves.toBe("mocked billing api boundary");
  });

  it("routes public docs search through the unified server dispatchers", async () => {
    const { default: server } = await import("../server");
    const response = await server.fetch(
      new Request("http://127.0.0.1/api/search?query=building+automations", {
        method: "GET",
      }),
    );

    expect(dispatchStartOwnedBillingRequest).toHaveBeenCalledTimes(1);
    expect(dispatchStartOwnedDocsSearchRequest).toHaveBeenCalledTimes(1);
    expect(dispatchStartOwnedInternalApiRequest).toHaveBeenCalledTimes(0);
    expect(dispatchStartOwnedAdminHealthRequest).toHaveBeenCalledTimes(1);
    expect(dispatchStartOwnedAutomationApiRequest).toHaveBeenCalledTimes(0);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        id: "/docs/user-guide/automations/building-automations",
        url: "/docs/user-guide/automations/building-automations",
        title: "Building Automations",
      },
    ]);
  });

  it("routes the external billing family through the Start-owned billing boundary", async () => {
    const { default: server } = await import("../server");
    const billingResponse = await server.fetch(
      new Request("http://127.0.0.1/billing/checkout", {
        method: "POST",
      }),
    );
    const webhookResponse = await server.fetch(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
      }),
    );

    expect(dispatchStartOwnedBillingRequest).toHaveBeenCalledTimes(2);
    expect(billingResponse.status).toBe(202);
    expect(webhookResponse.status).toBe(202);
  });

  it("fails closed for unknown protocol paths", async () => {
    const { default: server } = await import("../server");
    const response = await server.fetch(new Request("http://127.0.0.1/api/unhandled", {}));

    expect(dispatchStartOwnedOperationalRequest).not.toHaveBeenCalled();
    expect(handleProviderWebhookRequest).not.toHaveBeenCalled();
    expect(handleStartOwnedMcpRequest).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "route_not_found",
        message: "Route not found.",
      },
    });
  });
});
