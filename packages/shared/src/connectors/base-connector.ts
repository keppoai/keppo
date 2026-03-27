import type { Provider } from "../types.js";
import { redactByPolicy, toolMap, type ToolDefinition } from "../tool-definitions.js";
import type { Connector, ConnectorContext, PreparedWrite } from "./base.js";
import { createDispatchConnector } from "../providers/modules/_shared/connector_dispatch.js";
import {
  assertInput,
  ensureScopes,
  resolveNamespaceFromContext,
} from "../providers/modules/_shared/connector_helpers.js";

type DispatchMap<TInput, TOutput> = Record<string, (input: TInput) => Promise<TOutput>>;
type DispatchPhase = "read" | "prepare" | "write";

export abstract class BaseConnector<
  TReadInput,
  TPrepareInput,
  TWriteInput,
  TTools extends readonly ToolDefinition[],
> implements Connector {
  readonly provider: Provider;

  protected readonly tools: TTools;
  protected readonly requiredScopesByTool: Record<string, string[]>;

  private readonly readMap: DispatchMap<TReadInput, Record<string, unknown>>;
  private readonly prepareMap: DispatchMap<TPrepareInput, PreparedWrite>;
  private readonly writeMap: DispatchMap<TWriteInput, Record<string, unknown>>;
  private readonly dispatchConnector: ReturnType<
    typeof createDispatchConnector<TReadInput, TPrepareInput, TWriteInput>
  >;

  constructor(params: {
    provider: Provider;
    tools: TTools;
    requiredScopesByTool: Record<string, string[]>;
    readMap: DispatchMap<TReadInput, Record<string, unknown>>;
    prepareMap: DispatchMap<TPrepareInput, PreparedWrite>;
    writeMap: DispatchMap<TWriteInput, Record<string, unknown>>;
  }) {
    this.provider = params.provider;
    this.tools = params.tools;
    this.requiredScopesByTool = params.requiredScopesByTool;
    this.readMap = params.readMap;
    this.prepareMap = params.prepareMap;
    this.writeMap = params.writeMap;
    this.dispatchConnector = createDispatchConnector({
      readMap: params.readMap,
      prepareMap: params.prepareMap,
      writeMap: params.writeMap,
    });
  }

  listTools(_context: ConnectorContext): ToolDefinition[] {
    return [...this.tools];
  }

  async executeRead(
    toolName: string,
    input: Record<string, unknown>,
    context: ConnectorContext,
  ): Promise<Record<string, unknown>> {
    ensureScopes(toolName, context.scopes, this.requiredScopesByTool);
    const validated = assertInput(toolName, input);
    await this.beforeRead(toolName, validated, context);
    this.assertHandler("read", this.readMap, toolName);
    return await this.dispatchConnector.executeRead(
      toolName,
      await this.buildReadDispatchInput(toolName, validated, context, {
        accessToken: this.getToken(context),
        namespace: this.getNamespace(context),
      }),
    );
  }

  async prepareWrite(
    toolName: string,
    input: Record<string, unknown>,
    context: ConnectorContext,
  ): Promise<PreparedWrite> {
    ensureScopes(toolName, context.scopes, this.requiredScopesByTool);
    const validated = assertInput(toolName, input);
    await this.beforePrepareWrite(toolName, validated, context);
    this.assertHandler("prepare", this.prepareMap, toolName);
    return await this.dispatchConnector.prepareWrite(
      toolName,
      await this.buildPrepareDispatchInput(toolName, validated, context),
    );
  }

  async executeWrite(
    toolName: string,
    normalizedPayload: Record<string, unknown>,
    context: ConnectorContext,
  ): Promise<Record<string, unknown>> {
    ensureScopes(toolName, context.scopes, this.requiredScopesByTool);
    await this.beforeWrite(toolName, normalizedPayload, context);
    this.assertHandler("write", this.writeMap, toolName);
    return await this.dispatchConnector.executeWrite(
      toolName,
      await this.buildWriteDispatchInput(toolName, normalizedPayload, context, {
        accessToken: this.getToken(context),
        namespace: this.getNamespace(context),
      }),
    );
  }

  redact(toolName: string, data: Record<string, unknown>): Record<string, unknown> {
    const tool = toolMap.get(toolName);
    if (!tool) {
      return this.redactFallback(data);
    }
    return redactByPolicy(data, tool.redaction_policy) as Record<string, unknown>;
  }

  protected getNamespace(context: ConnectorContext): string | undefined {
    return resolveNamespaceFromContext(context);
  }

  protected abstract getToken(context: ConnectorContext): string;

  protected async beforeRead(
    _toolName: string,
    _validated: Record<string, unknown>,
    _context: ConnectorContext,
  ): Promise<void> {}

  protected async beforePrepareWrite(
    _toolName: string,
    _validated: Record<string, unknown>,
    _context: ConnectorContext,
  ): Promise<void> {}

  protected async beforeWrite(
    _toolName: string,
    _normalizedPayload: Record<string, unknown>,
    _context: ConnectorContext,
  ): Promise<void> {}

  protected abstract buildReadDispatchInput(
    toolName: string,
    validated: Record<string, unknown>,
    context: ConnectorContext,
    runtime: { accessToken: string; namespace: string | undefined },
  ): Promise<TReadInput> | TReadInput;

  protected abstract buildPrepareDispatchInput(
    toolName: string,
    validated: Record<string, unknown>,
    context: ConnectorContext,
  ): Promise<TPrepareInput> | TPrepareInput;

  protected abstract buildWriteDispatchInput(
    toolName: string,
    normalizedPayload: Record<string, unknown>,
    context: ConnectorContext,
    runtime: { accessToken: string; namespace: string | undefined },
  ): Promise<TWriteInput> | TWriteInput;

  protected unsupportedToolMessage(phase: DispatchPhase, toolName: string): string {
    return `Unsupported ${this.provider} ${phase} tool ${toolName}`;
  }

  protected redactFallback(data: Record<string, unknown>): Record<string, unknown> {
    return { ...data };
  }

  private assertHandler<TInput, TOutput>(
    phase: DispatchPhase,
    handlers: DispatchMap<TInput, TOutput>,
    toolName: string,
  ): void {
    if (!Object.prototype.hasOwnProperty.call(handlers, toolName)) {
      throw new Error(this.unsupportedToolMessage(phase, toolName));
    }
  }
}
