export type ToolSearchResult = {
  name: string;
  provider: string;
  capability: string;
  risk_level: string;
  requires_approval: boolean;
  description: string;
  action_type: string;
  input_schema: Record<string, unknown>;
  type_stub: string;
};
