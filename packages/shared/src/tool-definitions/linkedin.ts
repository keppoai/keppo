import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const apiPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.startsWith("/"), "Path must start with '/'.")
  .refine((value) => !value.startsWith("//"), "Path must be relative to the LinkedIn API root.");

const headerValueSchema = z.string().trim().min(1);
const headersSchema = z.record(z.string().trim().min(1), headerValueSchema);
const queryValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const querySchema = z.record(z.string().trim().min(1), queryValueSchema);
const linkedinVersionSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "LinkedIn version must use YYYYMM format.");
const restliProtocolVersionSchema = z.string().trim().min(1);

export const linkedinTools: ToolDefinition[] = [
  {
    name: "linkedin.getProfile",
    provider: "linkedin",
    capability: "read",
    risk_level: "low",
    requires_approval: false,
    output_sensitivity: "high",
    action_type: "get_profile",
    description: "Get the authenticated LinkedIn member profile",
    redaction_policy: [],
    input_schema: z.object({}),
  },
  {
    name: "linkedin.readApi",
    provider: "linkedin",
    capability: "read",
    risk_level: "medium",
    requires_approval: false,
    output_sensitivity: "high",
    action_type: "read_api",
    description: "Send an authenticated GET request to an approved LinkedIn API path",
    redaction_policy: ["headers"],
    input_schema: z.object({
      path: apiPathSchema,
      query: querySchema.optional(),
      headers: headersSchema.optional(),
      linkedinVersion: linkedinVersionSchema.optional(),
      restliProtocolVersion: restliProtocolVersionSchema.optional(),
    }),
  },
  {
    name: "linkedin.writeApi",
    provider: "linkedin",
    capability: "write",
    risk_level: "high",
    requires_approval: true,
    output_sensitivity: "high",
    action_type: "write_api",
    description: "Send an authenticated write request to an approved LinkedIn API path",
    redaction_policy: ["headers", "body"],
    input_schema: z.object({
      method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
      path: apiPathSchema,
      query: querySchema.optional(),
      headers: headersSchema.optional(),
      linkedinVersion: linkedinVersionSchema.optional(),
      restliProtocolVersion: restliProtocolVersionSchema.optional(),
      body: z.unknown().optional(),
    }),
  },
];
