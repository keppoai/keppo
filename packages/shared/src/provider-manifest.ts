import { z } from "zod";
import { PROVIDER_AUTH_MODES } from "./provider-auth.js";
import {
  actionRiskLevelSchema,
  capabilitySchema,
  providerDeprecationStatusSchema,
} from "./types.js";

const providerManifestIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]*$/, "provider id must use lowercase letters, numbers, and dashes");

const urlSchema = z.string().trim().url();

const providerCapabilitySchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  refresh_credentials: z.boolean(),
  webhook: z.boolean(),
  automation_triggers: z.boolean(),
});

const providerToolManifestSchema = z.object({
  name: z.string().trim().min(1),
  capability: capabilitySchema,
  risk_level: actionRiskLevelSchema,
  requires_approval: z.boolean(),
  description: z.string().trim().min(1).optional(),
});

const providerEnvRequirementSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]*$/, "env var names must be uppercase with underscores"),
  required: z.boolean(),
  description: z.string().trim().min(1).optional(),
});

const providerDeprecationSchema = z
  .object({
    status: providerDeprecationStatusSchema,
    message: z.string().trim().min(1),
    sunset_at: z.string().trim().datetime({ offset: true }).optional(),
    replacement_provider: providerManifestIdSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.status === "sunset" && !value.sunset_at) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sunset_at is required when deprecation status is sunset",
        path: ["sunset_at"],
      });
    }
  });

export const providerMarketplaceManifestSchema = z
  .object({
    manifest_version: z.literal(1),
    provider: z.object({
      id: providerManifestIdSchema,
      display_name: z.string().trim().min(1),
      description: z.string().trim().min(1),
      documentation_url: urlSchema.optional(),
      homepage_url: urlSchema.optional(),
    }),
    module: z.object({
      schema_version: z.number().int().positive(),
      entrypoint: z.string().trim().min(1),
    }),
    auth: z.object({
      mode: z.enum(PROVIDER_AUTH_MODES),
      managed: z.boolean(),
    }),
    capabilities: providerCapabilitySchema,
    env: z.array(providerEnvRequirementSchema),
    tools: z.array(providerToolManifestSchema),
    deprecation: providerDeprecationSchema.optional(),
  })
  .superRefine((manifest, context) => {
    const toolNames = new Set<string>();
    for (const [index, tool] of manifest.tools.entries()) {
      if (toolNames.has(tool.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate tool "${tool.name}"`,
          path: ["tools", index, "name"],
        });
      }
      toolNames.add(tool.name);
    }

    const envNames = new Set<string>();
    for (const [index, env] of manifest.env.entries()) {
      if (envNames.has(env.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate env requirement "${env.name}"`,
          path: ["env", index, "name"],
        });
      }
      envNames.add(env.name);
    }
  });

export type ProviderMarketplaceManifest = z.infer<typeof providerMarketplaceManifestSchema>;
