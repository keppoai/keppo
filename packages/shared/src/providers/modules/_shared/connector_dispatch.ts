import type { PreparedWrite } from "../../../connectors/base.js";

type DispatchHandler<TInput, TOutput> = (input: TInput) => Promise<TOutput>;
type DispatchMap<TInput, TOutput> = Record<string, DispatchHandler<TInput, TOutput>>;

const runDispatch = async <TInput, TOutput>(
  phase: "read" | "prepare" | "write",
  toolName: string,
  handlers: DispatchMap<TInput, TOutput>,
  input: TInput,
): Promise<TOutput> => {
  const handler = handlers[toolName];
  if (!handler) {
    throw new Error(`Unsupported ${phase} tool ${toolName}`);
  }
  return await handler(input);
};

export const createDispatchConnector = <TReadInput, TPrepareInput, TWriteInput>(params: {
  readMap: DispatchMap<TReadInput, Record<string, unknown>>;
  prepareMap: DispatchMap<TPrepareInput, PreparedWrite>;
  writeMap: DispatchMap<TWriteInput, Record<string, unknown>>;
}) => {
  return {
    executeRead: async (toolName: string, input: TReadInput): Promise<Record<string, unknown>> => {
      return await runDispatch("read", toolName, params.readMap, input);
    },
    prepareWrite: async (toolName: string, input: TPrepareInput): Promise<PreparedWrite> => {
      return await runDispatch("prepare", toolName, params.prepareMap, input);
    },
    executeWrite: async (
      toolName: string,
      input: TWriteInput,
    ): Promise<Record<string, unknown>> => {
      return await runDispatch("write", toolName, params.writeMap, input);
    },
  };
};
