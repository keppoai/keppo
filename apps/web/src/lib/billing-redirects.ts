export type BillingReturnStatus = "success" | "cancel";
export type BillingReturnKind = "checkout" | "creditCheckout" | "runCheckout";

const BILLING_RETURN_KEYS = ["checkout", "creditCheckout", "runCheckout"] as const;

const toRelativeUrl = (url: URL): string => {
  return `${url.pathname}${url.search}`;
};

export const buildBillingReturnUrl = (
  currentHref: string,
  kind: BillingReturnKind,
  status: BillingReturnStatus,
): string => {
  const url = new URL(currentHref);
  url.hash = "";
  for (const key of BILLING_RETURN_KEYS) {
    url.searchParams.delete(key);
  }
  url.searchParams.set(kind, status);
  return toRelativeUrl(url);
};

export const buildBillingPortalReturnUrl = (currentHref: string): string => {
  const url = new URL(currentHref);
  url.hash = "";
  for (const key of BILLING_RETURN_KEYS) {
    url.searchParams.delete(key);
  }
  return toRelativeUrl(url);
};

export const readBillingReturnState = (
  currentHref: string,
): { kind: BillingReturnKind; status: BillingReturnStatus } | null => {
  const url = new URL(currentHref);
  for (const key of BILLING_RETURN_KEYS) {
    const status = url.searchParams.get(key);
    if (status === "success" || status === "cancel") {
      return {
        kind: key,
        status,
      };
    }
  }
  return null;
};

export const clearBillingReturnState = (currentHref: string): string => {
  const url = new URL(currentHref);
  url.hash = "";
  for (const key of BILLING_RETURN_KEYS) {
    url.searchParams.delete(key);
  }
  return toRelativeUrl(url);
};
