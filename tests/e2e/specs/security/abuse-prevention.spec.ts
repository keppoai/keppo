import { test, expect } from "../../fixtures/golden.fixture";
import { resolveAuthBaseUrl } from "../../helpers/auth-topology";

const postMcpInitialize = async (params: {
  apiBaseUrl: string;
  workspaceId: string;
  bearerToken: string;
  headers: Record<string, string>;
}): Promise<Response> => {
  return await fetch(`${params.apiBaseUrl}/mcp/${encodeURIComponent(params.workspaceId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.bearerToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...params.headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-05",
        capabilities: {},
        clientInfo: {
          name: "playwright-e2e-security",
          version: "1.0.0",
        },
      },
    }),
  });
};

test("disposable email signup is rejected", async ({ app }) => {
  const authBaseUrl = resolveAuthBaseUrl({
    dashboardBaseUrl: app.dashboardBaseUrl,
  });
  const response = await fetch(`${authBaseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: app.dashboardBaseUrl,
      ...app.headers,
    },
    body: JSON.stringify({
      name: "E2E Disposable Check",
      email: `e2e-disposable-${app.namespace}@mailinator.com`,
      password: "KeppoE2E!123",
    }),
  });
  const body = await response.text();
  expect(response.status).toBe(400);
  expect(body.toLowerCase()).toContain("disposable email domains are not allowed");
});

test("org suspension blocks MCP credential access with 403", async ({ auth, app }) => {
  const seeded = await auth.seedWorkspace("security-suspend", {
    skipUiWorkspaceSelectionSync: true,
  });

  const initial = await postMcpInitialize({
    apiBaseUrl: app.apiBaseUrl,
    workspaceId: seeded.workspaceId,
    bearerToken: seeded.credentialSecret,
    headers: app.headers,
  });
  expect(initial.status).toBe(200);

  await auth.setOrgSuspended(seeded.orgId, true, "e2e suspension enforcement");

  const suspended = await postMcpInitialize({
    apiBaseUrl: app.apiBaseUrl,
    workspaceId: seeded.workspaceId,
    bearerToken: seeded.credentialSecret,
    headers: app.headers,
  });
  const suspendedBody = await suspended.text();
  expect(suspended.status).toBe(403);
  expect(suspendedBody.toLowerCase()).toContain("organization suspended");

  await auth.setOrgSuspended(seeded.orgId, false, "e2e suspension cleanup");
});

test("credential auth lockout returns 429 after repeated failed attempts", async ({
  auth,
  app,
}) => {
  const seeded = await auth.seedWorkspace("security-lockout", {
    skipUiWorkspaceSelectionSync: true,
  });
  const invalidToken = "keppo_invalid_token_lockout_probe";

  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await postMcpInitialize({
      apiBaseUrl: app.apiBaseUrl,
      workspaceId: seeded.workspaceId,
      bearerToken: invalidToken,
      headers: app.headers,
    });
    lastStatus = response.status;
    lastBody = await response.text();
    if (lastStatus === 429) {
      break;
    }
  }

  expect(lastStatus).toBe(429);
  expect(lastBody.toLowerCase()).toContain("too many failed attempts");
});
