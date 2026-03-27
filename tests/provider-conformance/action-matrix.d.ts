export type ManagedProviderId =
  | "google"
  | "stripe"
  | "github"
  | "slack"
  | "notion"
  | "reddit"
  | "x"
  | "custom";
export type ActionCapability = "read" | "write";
export type SdkCallExpectation = {
  method: string;
  requireIdempotencyKey?: boolean;
  assertArgs?: (args: Record<string, unknown>) => boolean;
};
export type ConformanceOutputValueType =
  | "array"
  | "object"
  | "string"
  | "number"
  | "boolean"
  | "null";
export type ProviderConformanceErrorKind =
  | "invalid_input"
  | "not_connected"
  | "auth"
  | "rate_limited"
  | "not_found"
  | "unknown";
export type ProviderActionGoldenResultExpectation = {
  status: string | string[];
  hasActionId?: boolean;
  outputShape?: Record<string, ConformanceOutputValueType | ConformanceOutputValueType[]>;
};
export type ProviderActionGoldenErrorExpectation = {
  kind: ProviderConformanceErrorKind;
  messageIncludes?: string[];
};
export type ProviderActionGoldenExpectations = {
  positive: ProviderActionGoldenResultExpectation;
  negative: ProviderActionGoldenErrorExpectation;
  idempotency?: ProviderActionGoldenResultExpectation;
};
export type ProviderActionScenario = {
  toolName: string;
  capability: ActionCapability;
  positiveInput: Record<string, unknown>;
  negativeInput: Record<string, unknown>;
  negativeMode?: "invalid_input" | "not_connected";
  expectedSdkCalls?: SdkCallExpectation[];
  golden?: ProviderActionGoldenExpectations;
};
export type ProviderActionPack = {
  providerId: ManagedProviderId;
  gatewayProviderId?: string;
  scenarios: ProviderActionScenario[];
};
export declare const providerActionPacks: ProviderActionPack[];
export declare const providerActionScenarioCount: number;
//# sourceMappingURL=action-matrix.d.ts.map
