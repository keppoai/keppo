import { expect } from "@playwright/test";
import { BasePage } from "./base-page";

export class IntegrationsPage extends BasePage {
  async open(): Promise<void> {
    await this.goto("/integrations");
    await expect(this.page.getByText("Loading authentication...")).toBeHidden({ timeout: 10_000 });
    await expect(this.page.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible(
      {
        timeout: 10_000,
      },
    );
  }

  async connectProvider(providerId: string): Promise<void> {
    const connectButton = this.page.getByTestId(`connect-${providerId}`);
    const openButton = this.page.getByTestId(`open-${providerId}`);
    const disconnectButton = this.page.getByTestId(`disconnect-${providerId}`);
    const oauthConnectedParam = `${providerId.toLowerCase()}`;

    await expect
      .poll(
        async () => {
          if (await connectButton.isVisible().catch(() => false)) {
            return "connect";
          }
          if (
            (await openButton.isVisible().catch(() => false)) ||
            (await disconnectButton.isVisible().catch(() => false))
          ) {
            return "already-connected";
          }
          return "missing";
        },
        { timeout: 10_000 },
      )
      .not.toBe("missing");

    if (await connectButton.isVisible().catch(() => false)) {
      await connectButton.click();
      await expect
        .poll(
          async () => {
            if (
              (await openButton.isVisible().catch(() => false)) ||
              (await disconnectButton.isVisible().catch(() => false))
            ) {
              return "connected";
            }
            const currentUrl = this.page.url();
            if (currentUrl.includes("/oauth/")) {
              return "oauth";
            }
            if (
              new URL(currentUrl).searchParams.get("integration_connected")?.toLowerCase() ===
              oauthConnectedParam
            ) {
              return "redirected";
            }
            return "pending";
          },
          { timeout: 10_000 },
        )
        .not.toBe("pending");
    }
  }

  async expectConnected(providerId: string): Promise<void> {
    const openButton = this.page.getByTestId(`open-${providerId}`);
    const disconnectButton = this.page.getByTestId(`disconnect-${providerId}`);
    await expect
      .poll(
        async () => {
          return (
            (await openButton.isVisible().catch(() => false)) ||
            (await disconnectButton.isVisible().catch(() => false))
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  }

  async expectConnectButtonVisible(providerId: string): Promise<void> {
    await expect(this.page.getByTestId(`connect-${providerId}`)).toBeVisible();
  }

  async expectUnconfiguredProviderVisible(providerLabel: string): Promise<void> {
    await expect(this.page.getByText(providerLabel, { exact: true })).toBeVisible();
  }
}
