import { safeFetch } from "../../../network.js";
import { customTools, redactByPolicy, toolMap } from "../../../tool-definitions.js";
import type { Connector, ConnectorContext } from "../../../connectors/base.js";
import { createProviderCircuitBreaker } from "../../../circuit-breaker.js";
import { assertInput, ensureScopes } from "../_shared/connector_helpers.js";
import { createDispatchConnector } from "../_shared/connector_dispatch.js";

const requiredScopesByTool: Record<string, string[]> = {
  "custom.callRead": ["custom.read"],
  "custom.callWrite": ["custom.write"],
};

const resolveBaseUrl = (context: {
  metadata?: Record<string, unknown>;
  external_account_id?: string | null;
}): string | null => {
  const metadataBase = context.metadata?.base_url;
  if (typeof metadataBase === "string" && metadataBase.startsWith("http")) {
    return metadataBase;
  }
  if (context.external_account_id && context.external_account_id.startsWith("http")) {
    return context.external_account_id;
  }
  return null;
};

const callRemoteCustom = async (
  baseUrl: string,
  tool: string,
  mode: "read" | "write",
  payload: Record<string, unknown>,
  token?: string,
): Promise<Record<string, unknown>> => {
  const url = `${baseUrl.replace(/\/+$/, "")}/tools/${encodeURIComponent(tool)}/${mode}`;
  const response = await safeFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    },
    `custom.connector.${mode}`,
  );
  if (!response.ok) {
    throw new Error(
      (await response.text()) || `Custom connector request failed: ${response.status}`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
};

const providerCircuitBreaker = createProviderCircuitBreaker("custom");

type CustomReadDispatchInput = {
  input: Record<string, unknown>;
  context: ConnectorContext;
};

type CustomPrepareDispatchInput = {
  input: Record<string, unknown>;
};

type CustomWriteDispatchInput = {
  normalizedPayload: Record<string, unknown>;
  context: ConnectorContext;
};

const dispatchConnector = createDispatchConnector<
  CustomReadDispatchInput,
  CustomPrepareDispatchInput,
  CustomWriteDispatchInput
>({
  readMap: {
    "custom.callRead": async ({ input: validated, context }) => {
      const remoteBase = resolveBaseUrl(context);
      const remoteTool = String(validated.tool ?? "");
      if (remoteBase) {
        return await providerCircuitBreaker.execute(() =>
          callRemoteCustom(
            remoteBase,
            remoteTool,
            "read",
            {
              input: validated.input ?? {},
            },
            context.access_token,
          ),
        );
      }
      return {
        status: "simulated",
        tool: remoteTool,
        output: validated.input ?? {},
      };
    },
  },
  prepareMap: {
    "custom.callWrite": async ({ input: validated }) => {
      const remoteTool = String(validated.tool ?? "");
      const payload = (validated.payload ?? {}) as Record<string, unknown>;
      return {
        normalized_payload: {
          type: "custom_write",
          tool: remoteTool,
          payload,
        },
        payload_preview: {
          tool: remoteTool,
          payload_keys: Object.keys(payload),
        },
      };
    },
  },
  writeMap: {
    "custom.callWrite": async ({ normalizedPayload, context }) => {
      const remoteBase = resolveBaseUrl(context);
      const remoteTool = String(normalizedPayload.tool ?? "");
      const payload = (normalizedPayload.payload ?? {}) as Record<string, unknown>;
      if (remoteBase) {
        return await providerCircuitBreaker.execute(() =>
          callRemoteCustom(remoteBase, remoteTool, "write", payload, context.access_token),
        );
      }
      return {
        status: "simulated",
        provider_action_id: `custom_write_${Date.now()}`,
        tool: remoteTool,
      };
    },
  },
});

const customConnector: Connector = {
  provider: "custom",
  listTools() {
    return customTools;
  },
  async executeRead(toolName, input, context) {
    ensureScopes(toolName, context.scopes, requiredScopesByTool);
    const validated = assertInput(toolName, input);
    return await dispatchConnector.executeRead(toolName, {
      input: validated,
      context,
    });
  },
  async prepareWrite(toolName, input, context) {
    ensureScopes(toolName, context.scopes, requiredScopesByTool);
    const validated = assertInput(toolName, input);
    return await dispatchConnector.prepareWrite(toolName, { input: validated });
  },
  async executeWrite(toolName, normalizedPayload, context) {
    ensureScopes(toolName, context.scopes, requiredScopesByTool);
    return await dispatchConnector.executeWrite(toolName, {
      normalizedPayload,
      context,
    });
  },
  redact(toolName, data) {
    const definition = toolMap.get(toolName);
    if (!definition) {
      return data;
    }
    return redactByPolicy(data, definition.redaction_policy) as Record<string, unknown>;
  },
};

export default customConnector;
