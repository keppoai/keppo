import { describe, expect, it } from "vitest";
import {
  buildBillingPortalReturnUrl,
  buildBillingReturnUrl,
  clearBillingReturnState,
  readBillingReturnState,
} from "./billing-redirects";

describe("billing redirect helpers", () => {
  it("builds scoped checkout return urls from the current page", () => {
    expect(
      buildBillingReturnUrl(
        "https://keppo.test/acme/settings/billing?tab=usage",
        "checkout",
        "success",
      ),
    ).toBe("/acme/settings/billing?tab=usage&checkout=success");

    expect(
      buildBillingReturnUrl(
        "https://keppo.test/acme/settings?section=ai&creditCheckout=cancel",
        "creditCheckout",
        "cancel",
      ),
    ).toBe("/acme/settings?section=ai&creditCheckout=cancel");
  });

  it("builds portal return urls without stale billing state params", () => {
    expect(
      buildBillingPortalReturnUrl(
        "https://keppo.test/acme/settings/billing?checkout=success&tab=usage",
      ),
    ).toBe("/acme/settings/billing?tab=usage");
  });

  it("reads and clears billing return state", () => {
    expect(
      readBillingReturnState("https://keppo.test/acme/settings/billing?checkout=success"),
    ).toEqual({
      kind: "checkout",
      status: "success",
    });
    expect(
      readBillingReturnState("https://keppo.test/acme/settings?creditCheckout=cancel"),
    ).toEqual({
      kind: "creditCheckout",
      status: "cancel",
    });
    expect(readBillingReturnState("https://keppo.test/acme/settings/billing")).toBeNull();

    expect(
      clearBillingReturnState(
        "https://keppo.test/acme/settings/billing?tab=usage&checkout=success",
      ),
    ).toBe("/acme/settings/billing?tab=usage");
  });
});
