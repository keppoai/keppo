import type { Register } from "@tanstack/react-router";
import {
  createStartHandler,
  defaultStreamHandler,
  type RequestHandler,
} from "@tanstack/react-start/server";
import { maybeLoadApiRuntimeEnv } from "../app/lib/server/api-runtime/runtime-env";
import { dispatchUnifiedProtocolRequest } from "./lib/unified-protocol-boundary";

maybeLoadApiRuntimeEnv();

const defaultFetch = createStartHandler(defaultStreamHandler);

type ServerEntry = {
  fetch: RequestHandler<Register>;
};

const fetch: RequestHandler<Register> = async (request, options) => {
  const boundaryResponse = await dispatchUnifiedProtocolRequest(request);
  if (boundaryResponse) {
    return boundaryResponse;
  }

  return await defaultFetch(request, options as never);
};

export function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(...args) {
      return await entry.fetch(...args);
    },
  };
}

export default createServerEntry({ fetch });
