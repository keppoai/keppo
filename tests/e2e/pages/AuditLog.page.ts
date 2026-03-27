import { expect, type Locator } from "@playwright/test";
import { BasePage } from "./base-page";

const setInputValue = async (locator: Locator, value: string): Promise<void> => {
  await locator.evaluate((element, nextValue) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

export class AuditLogPage extends BasePage {
  async open(): Promise<void> {
    await this.goto("/audit");
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Audit Log" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(this.page.getByPlaceholder("Actor")).toBeVisible({
      timeout: 15_000,
    });
  }

  async setActorFilter(value: string): Promise<void> {
    await setInputValue(this.page.getByPlaceholder("Actor"), value);
  }

  async setEventTypeFilter(value: string): Promise<void> {
    await setInputValue(this.page.getByPlaceholder("Event type"), value);
  }

  async setProviderFilter(value: string): Promise<void> {
    await setInputValue(this.page.getByPlaceholder("Provider"), value);
  }

  async setActionIdFilter(value: string): Promise<void> {
    await setInputValue(this.page.getByPlaceholder("Action ID"), value);
  }

  async expectRowVisible(text: RegExp | string): Promise<void> {
    await expect(this.page.getByRole("row", { name: text })).toBeVisible();
  }

  async expectNoRowVisible(text: RegExp | string): Promise<void> {
    await expect(this.page.getByRole("row", { name: text })).toHaveCount(0);
  }

  async expectResultsCount(count: number): Promise<void> {
    await expect(this.page.locator("tbody tr")).toHaveCount(count);
  }

  async captureExport(format: "csv" | "jsonl"): Promise<{ download: string; content: string }> {
    await this.page.evaluate(() => {
      const win = window as typeof window & {
        __KEPPO_E2E_DOWNLOAD_CAPTURED__?: boolean;
        __KEPPO_E2E_DOWNLOADS__?: Array<{ download: string; content: string }>;
      };
      if (win.__KEPPO_E2E_DOWNLOAD_CAPTURED__) {
        return;
      }

      win.__KEPPO_E2E_DOWNLOAD_CAPTURED__ = true;
      win.__KEPPO_E2E_DOWNLOADS__ = [];

      const blobUrls = new Map<string, Blob>();
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
      const originalClick = HTMLAnchorElement.prototype.click;

      URL.createObjectURL = (object: Blob | MediaSource) => {
        if (!(object instanceof Blob)) {
          return originalCreateObjectURL(object);
        }
        const url = `blob:keppo-e2e-${Math.random().toString(16).slice(2)}`;
        blobUrls.set(url, object);
        return url;
      };

      URL.revokeObjectURL = (url: string) => {
        blobUrls.delete(url);
        originalRevokeObjectURL(url);
      };

      HTMLAnchorElement.prototype.click = function click() {
        const blob = blobUrls.get(this.href);
        if (!blob || !this.download) {
          return originalClick.call(this);
        }
        void blob.text().then((content) => {
          win.__KEPPO_E2E_DOWNLOADS__?.push({
            download: this.download,
            content,
          });
        });
      };
    });

    const downloadButton =
      format === "csv"
        ? this.page.getByRole("button", { name: "Export CSV" })
        : this.page.getByRole("button", { name: "Export JSONL" });
    const existingDownloads = await this.page.evaluate(() => {
      const win = window as typeof window & {
        __KEPPO_E2E_DOWNLOADS__?: Array<{ download: string; content: string }>;
      };
      return win.__KEPPO_E2E_DOWNLOADS__?.length ?? 0;
    });
    await downloadButton.click();

    await expect
      .poll(async () => {
        return await this.page.evaluate(() => {
          const win = window as typeof window & {
            __KEPPO_E2E_DOWNLOADS__?: Array<{ download: string; content: string }>;
          };
          return win.__KEPPO_E2E_DOWNLOADS__?.length ?? 0;
        });
      })
      .toBeGreaterThan(existingDownloads);

    return await this.page.evaluate(() => {
      const win = window as typeof window & {
        __KEPPO_E2E_DOWNLOADS__?: Array<{ download: string; content: string }>;
      };
      const downloads = win.__KEPPO_E2E_DOWNLOADS__ ?? [];
      const latest = downloads.at(-1);
      if (!latest) {
        throw new Error("Missing captured audit export.");
      }
      return latest;
    });
  }
}
