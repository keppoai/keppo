import type { Locator } from "@playwright/test";
import { test, expect } from "../../fixtures/golden.fixture";
import { resolveScopedDashboardPath } from "../../helpers/dashboard-paths";
import { startMockMcpServer, type MockMcpTool } from "../../helpers/mock-mcp-server";

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

const waitForStatus = async (
  page: import("@playwright/test").Page,
  status: string,
): Promise<void> => {
  await expect
    .poll(
      async () => {
        const badge = page.getByTestId("custom-server-status-badge");
        return ((await badge.textContent()) ?? "").trim();
      },
      { timeout: 12_000 },
    )
    .toBe(status);
};

const saveServerSettings = async (
  page: import("@playwright/test").Page,
  options: {
    expectedUrl?: string;
    expectedTokenAfterSave?: string;
  } = {},
): Promise<void> => {
  const saveButton = page.getByRole("button", { name: "Save" });
  await clickElement(saveButton);
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toBeEnabled();
  if (options.expectedUrl) {
    await expect(page.getByLabel("Server URL")).toHaveValue(options.expectedUrl);
  }
  if (options.expectedTokenAfterSave !== undefined) {
    await expect(page.getByLabel("Bearer Token (set to rotate, empty to keep)")).toHaveValue(
      options.expectedTokenAfterSave,
    );
  }
};

const toolRow = (page: import("@playwright/test").Page, toolName: string) => {
  return page.locator('[data-testid="custom-server-tool-row"]').filter({
    has: page.locator('[data-testid="custom-server-tool-name"]').filter({ hasText: toolName }),
  });
};

const toolControls = (page: import("@playwright/test").Page, toolName: string) => {
  const row = toolRow(page, toolName);
  return {
    riskSelect: row.getByRole("combobox", { name: `${toolName} risk` }),
    approvalSwitch: row.getByRole("switch", { name: `${toolName} requires approval` }),
    enabledSwitch: row.getByRole("switch", { name: `${toolName} enabled` }),
  };
};

test("custom-mcp-tool-discovery", async ({ page, pages, auth, app }) => {
  test.setTimeout(60_000);
  const mock = await startMockMcpServer();
  const slug = "discover-tools";

  try {
    await pages.login.login();
    await auth.seedWorkspace("custom-mcp-discovery", {
      preferSelectedWorkspace: true,
    });

    await registerServer({
      page,
      dashboardBaseUrl: app.dashboardBaseUrl,
      displayName: "Discovery Tools",
      slug,
      url: mock.url,
      bearerToken: mock.bearerToken ?? "",
    });

    const card = page.locator('[data-slot="card"]').filter({ hasText: "Discovery Tools" });
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

    await expect(toolRow(page, `${slug}.searchDocs`)).toBeVisible();
    await expect(toolRow(page, `${slug}.updateTicket`)).toBeVisible();
    await expect(toolRow(page, `${slug}.listQueues`)).toBeVisible();

    let controls = toolControls(page, `${slug}.searchDocs`);

    await expect(controls.riskSelect).toHaveValue("high");
    await expect(controls.approvalSwitch).toHaveAttribute("aria-checked", "true");
    await expect(controls.enabledSwitch).toHaveAttribute("aria-checked", "true");

    await controls.riskSelect.selectOption("medium");
    await clickElement(controls.approvalSwitch);
    await clickElement(controls.enabledSwitch);

    await expect(controls.riskSelect).toHaveValue("medium");
    await expect(controls.approvalSwitch).toHaveAttribute("aria-checked", "false");
    await expect(controls.enabledSwitch).toHaveAttribute("aria-checked", "false");

    await page.reload();

    controls = toolControls(page, `${slug}.searchDocs`);

    await expect(controls.riskSelect).toHaveValue("medium");
    await expect(controls.approvalSwitch).toHaveAttribute("aria-checked", "false");
    await expect(controls.enabledSwitch).toHaveAttribute("aria-checked", "false");

    const refreshedTools: MockMcpTool[] = [
      {
        name: "searchDocs",
        description: "Search docs after refresh.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        handler: (args) => ({
          query: typeof args.query === "string" ? args.query : "",
          refreshed: true,
        }),
      },
      {
        name: "createMemo",
        description: "Create a support memo.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
          additionalProperties: false,
        },
        handler: (args) => ({
          memoId: "memo_001",
          title: typeof args.title === "string" ? args.title : "",
        }),
      },
    ];

    mock.setTools(refreshedTools);
    await clickElement(page.getByRole("button", { name: "Rediscover Tools" }));

    await expect(toolRow(page, `${slug}.createMemo`)).toBeVisible();
    await expect(toolRow(page, `${slug}.updateTicket`)).toHaveCount(0);

    await setControlValue(
      page.getByLabel("Bearer Token (set to rotate, empty to keep)"),
      "invalid-token",
    );
    await saveServerSettings(page, {
      expectedUrl: mock.url,
      expectedTokenAfterSave: "",
    });
    await clickElement(page.getByRole("button", { name: "Rediscover Tools" }));

    await waitForStatus(page, "error");
    const authError = page.getByRole("alert").filter({ hasText: "Custom MCP server issue" });
    await expect(authError).toBeVisible();
    await expect(authError.getByText("Retry after fixing the server configuration.")).toBeVisible();
    await clickElement(authError.getByRole("button", { name: "Technical details" }));
    await expect(authError.getByText(/code: custom_mcp\.auth_failed/i)).toBeVisible();

    await setControlValue(page.getByLabel("Server URL"), "http://127.0.0.1:9/mcp");
    await setControlValue(
      page.getByLabel("Bearer Token (set to rotate, empty to keep)"),
      mock.bearerToken ?? "",
    );
    await saveServerSettings(page, {
      expectedUrl: "http://127.0.0.1:9/mcp",
      expectedTokenAfterSave: "",
    });
    await clickElement(page.getByRole("button", { name: "Rediscover Tools" }));

    await waitForStatus(page, "error");
    const networkError = page.getByRole("alert").filter({ hasText: "Custom MCP server issue" });
    await expect(networkError).toBeVisible();
    await expect(
      networkError.getByText("Retry after fixing the server configuration."),
    ).toBeVisible();
  } finally {
    await mock.close();
  }
});
