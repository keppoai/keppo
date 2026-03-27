import type { Locator } from "@playwright/test";
import { test, expect } from "../../fixtures/golden.fixture";
import { resolveScopedDashboardPath } from "../../helpers/dashboard-paths";
import { startMockMcpServer } from "../../helpers/mock-mcp-server";

const clickElement = async (locator: Locator): Promise<void> => {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
};

const setControlValue = async (locator: Locator, value: string): Promise<void> => {
  await locator.evaluate((element, nextValue) => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await expect(locator).toHaveValue(value);
  await locator.blur();
};

const registerServer = async (params: {
  page: import("@playwright/test").Page;
  dashboardBaseUrl: string;
  displayName: string;
  slug: string;
  url: string;
  bearerToken: string;
}): Promise<void> => {
  await params.page.goto(
    new URL(
      await resolveScopedDashboardPath(params.page, "/custom-servers"),
      params.dashboardBaseUrl,
    ).toString(),
  );
  await clickElement(params.page.getByRole("button", { name: "Add Server" }));
  await setControlValue(params.page.getByLabel("Display Name"), params.displayName);
  await setControlValue(params.page.getByLabel("Slug"), params.slug);
  await setControlValue(params.page.getByLabel("Server URL"), params.url);
  await setControlValue(params.page.getByLabel("Bearer Token"), params.bearerToken);
  await clickElement(params.page.getByRole("button", { name: "Register" }));
};

const argsForTool = (toolName: string): Record<string, unknown> => {
  if (toolName.endsWith(".searchDocs")) {
    return { query: "refund policy" };
  }
  if (toolName.endsWith(".updateTicket")) {
    return { ticketId: "SUP-READ-1000", status: "open" };
  }
  return {};
};

const toolRow = (page: import("@playwright/test").Page, toolName: string) => {
  return page.locator('[data-testid="custom-server-tool-row"]').filter({
    has: page.locator('[data-testid="custom-server-tool-name"]').filter({ hasText: toolName }),
  });
};

test("custom-mcp-tool-execution", async ({ page, pages, auth, provider, app }) => {
  test.setTimeout(90_000);
  const mock = await startMockMcpServer();
  const slug = "execution-tools";

  await pages.login.login();
  const seeded = await auth.seedWorkspace("custom-mcp-execution", {
    preferSelectedWorkspace: true,
    subscriptionTier: "pro",
  });

  let mcp: ReturnType<typeof provider.createMcpClient> | null = null;

  try {
    await registerServer({
      page,
      dashboardBaseUrl: app.dashboardBaseUrl,
      displayName: "Execution Tools",
      slug,
      url: mock.url,
      bearerToken: mock.bearerToken ?? "",
    });

    const card = page.locator('[data-slot="card"]').filter({ hasText: "Execution Tools" });
    await expect(card).toBeVisible();
    await expect
      .poll(
        async () => {
          return (await card.textContent()) ?? "";
        },
        { timeout: 12_000 },
      )
      .toContain("connected");

    await clickElement(card.getByRole("link", { name: "Manage" }));

    mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
    await mcp.initialize();

    const immediateToolName = `${slug}.searchDocs`;
    expect(immediateToolName).toContain(`${slug}.`);

    await expect(toolRow(page, immediateToolName)).toBeVisible();
    const immediateApprovalSwitch = page.getByRole("switch", {
      name: `${immediateToolName} requires approval`,
    });

    if ((await immediateApprovalSwitch.getAttribute("aria-checked")) === "true") {
      await clickElement(immediateApprovalSwitch);
      await expect(immediateApprovalSwitch).toHaveAttribute("aria-checked", "false");
    }

    const immediateResult = await mcp.callTool(immediateToolName, argsForTool(immediateToolName));
    expect(immediateResult.status).toBe("succeeded");

    const pending = await mcp.callTool(`${slug}.updateTicket`, {
      ticketId: "SUP-1001",
      status: "closed",
    });
    const firstActionId = String(pending.action_id ?? "");
    expect(pending.status).toBe("approval_required");
    expect(firstActionId).not.toEqual("");

    await pages.actions.setSelectedWorkspaceSlug(seeded.workspaceSlug);
    await pages.actions.open();
    await pages.actions.approveFirstPending();

    const approvedResult = await mcp.waitForAction(firstActionId, 20_000);
    expect(approvedResult.status).toBe("succeeded");

    expect(mock.getCalls().some((call) => `${slug}.${call.toolName}` === immediateToolName)).toBe(
      true,
    );
    expect(mock.getCalls().some((call) => call.toolName === "updateTicket")).toBe(true);

    const rejectedPending = await mcp.callTool(`${slug}.updateTicket`, {
      ticketId: "SUP-1002",
      status: "open",
    });
    const rejectedActionId = String(rejectedPending.action_id ?? "");
    expect(rejectedPending.status).toBe("approval_required");

    await pages.actions.setSelectedWorkspaceSlug(seeded.workspaceSlug);
    await pages.actions.open();
    await pages.actions.rejectFirstPending("Rejected in custom MCP execution test");

    const rejectedResult = await mcp.waitForAction(rejectedActionId, 20_000);
    expect(rejectedResult.status).toBe("rejected");

    const updateCallsAfterReject = mock
      .getCalls()
      .filter((call) => call.toolName === "updateTicket").length;
    expect(updateCallsAfterReject).toBe(1);

    await pages.workspaces.setSelectedWorkspaceSlug(seeded.workspaceSlug);
    await pages.workspaces.open();
    const serverRow = page.locator('[data-testid="workspace-custom-server-row"]').filter({
      hasText: "Execution Tools",
    });
    const customServerToggle = serverRow.getByRole("switch", {
      name: "Execution Tools workspace availability",
    });
    await expect(customServerToggle).toBeVisible();
    if ((await customServerToggle.getAttribute("aria-checked")) === "true") {
      await clickElement(customServerToggle);
      await expect(customServerToggle).toHaveAttribute("aria-checked", "false");
    }
    await expect
      .poll(
        async () => {
          const tools = await mcp.listTools();
          return tools.some((tool) => tool.name === immediateToolName);
        },
        { timeout: 15_000 },
      )
      .toBe(false);

    await expect(mcp.callTool(immediateToolName, argsForTool(immediateToolName))).rejects.toThrow(
      /custom_server_not_available|disabled/i,
    );

    await clickElement(customServerToggle);
    await expect(customServerToggle).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(
        async () => {
          const tools = await mcp.listTools();
          return tools.some((tool) => tool.name === immediateToolName);
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    await expect(mcp.callTool(`${slug}.doesNotExist`, {})).rejects.toThrow(
      /unknown_custom_tool|tool .* not found/i,
    );
  } finally {
    if (mcp) {
      await mcp.close();
    }
    await mock.close();
  }
});
