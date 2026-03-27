import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "@playwright/test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test("captures the clarification flow screenshot", async ({ page }) => {
  await page.goto("/?action=plan&agent=codex&agent=claude&preview=clarification");
  // Preview seed includes a draft, so step 3 (Review) is active.
  // Navigate back to step 2 (Clarify) via the stepper.
  await page.getByRole("button", { name: /Clarify/ }).click();
  await expect(page.getByText("A few questions")).toBeVisible();

  await page.screenshot({
    path: path.resolve(currentDir, "../../../ux-artifacts/izzy-issue-flow.png"),
    fullPage: true,
  });
});
