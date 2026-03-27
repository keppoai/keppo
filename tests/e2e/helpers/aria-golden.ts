import { expect, type Locator, type Page } from "@playwright/test";
import { normalizeAriaSnapshot } from "./aria-diff";

export const expectAriaGolden = async (params: {
  page: Page;
  name: string;
  root?: Locator;
}): Promise<void> => {
  const root = params.root ?? params.page.locator("body");
  const snapshot = await root.ariaSnapshot();
  expect(normalizeAriaSnapshot(snapshot)).toMatchSnapshot(`${params.name}.aria.txt`);
};
