import type { Connector } from "./base.js";
import { providerModulesV2 } from "../providers/modules/index.js";

export const connectors: Record<string, Connector> = Object.freeze(
  Object.fromEntries(providerModulesV2.map((module) => [module.providerId, module.connector])),
);

export * from "./base.js";
