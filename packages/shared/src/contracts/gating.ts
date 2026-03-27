import type { ToolDefinition } from "../tooling.js";
import type { GatingDecision, GatingInput } from "../gating.js";

export type { GatingDecision, GatingInput };

export interface GatingEngine {
  shouldGateTool(tool: ToolDefinition): boolean;
  evaluateGating(input: GatingInput): GatingDecision;
}
