import type { ActionRiskLevel, Capability, OutputSensitivity, Provider } from "../types.js";

export interface ToolDefinition {
  name: string;
  provider: Provider | "keppo";
  capability: Capability;
  risk_level: ActionRiskLevel;
  requires_approval: boolean;
  output_sensitivity: OutputSensitivity;
  action_type: string;
  description: string;
  redaction_policy: string[];
  input_schema: import("zod").ZodTypeAny;
}
