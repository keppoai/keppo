import type { CanonicalProviderId } from "../../provider-ids.js";
import type { ActionRiskLevel, Capability } from "../../types.js";

export type PlannedActionCatalogSeed = {
  providerId: CanonicalProviderId;
  toolName: string;
  actionType: string;
  capability: Capability;
  riskLevel: ActionRiskLevel;
  tier: "T1" | "T2" | "T3";
  sdkMethod: string;
  description: string;
};
