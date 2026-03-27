import { z } from "zod";
import type { ToolDefinition } from "./types.js";

export const customTools: ToolDefinition[] = [
  {
    name: "custom.callRead",
    provider: "custom",
    capability: "read",
    risk_level: "low",
    requires_approval: false,
    output_sensitivity: "low",
    action_type: "custom_read",
    description: "Call custom read tool",
    redaction_policy: [],
    input_schema: z.object({
      tool: z.string().min(1),
      input: z.record(z.string(), z.unknown()).default({}),
    }),
  },
  {
    name: "custom.callWrite",
    provider: "custom",
    capability: "write",
    risk_level: "high",
    requires_approval: true,
    output_sensitivity: "high",
    action_type: "custom_write",
    description: "Call custom write tool",
    redaction_policy: ["payload"],
    input_schema: z.object({
      tool: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).default({}),
    }),
  },
];
