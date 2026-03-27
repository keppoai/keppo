export const nowIso = (): string => new Date().toISOString();

export { isLocalAdminBypassEnabled } from "./local-admin-bypass.js";

export const normalizeJsonRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};
