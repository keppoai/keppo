"use node";

import { createHash, randomBytes } from "node:crypto";

export const newId = (prefix: string): string => `${prefix}_${randomBytes(8).toString("hex")}`;

export const hashSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

export const stableIdempotencyKey = (
  toolName: string,
  payload: Record<string, unknown>,
): string => {
  const canonical = JSON.stringify(sortObject(payload));
  return createHash("sha256").update(`${toolName}:${canonical}`).digest("hex");
};

const sortObject = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObject(entry));
  }
  if (value && typeof value === "object") {
    const sorted = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => [key, sortObject(v)] as const);
    return Object.fromEntries(sorted);
  }
  return value;
};
