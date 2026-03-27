import type { ProviderFakeRuntimeContext } from "./contract/provider-contract";

export type ProviderFakeRuntimeOverrides = Partial<{
  httpClient: ProviderFakeRuntimeContext["httpClient"];
  clock: Partial<ProviderFakeRuntimeContext["clock"]>;
  idGenerator: Partial<ProviderFakeRuntimeContext["idGenerator"]>;
}>;

const baseTimeMs = Date.UTC(2026, 0, 1, 0, 0, 0);
const clockStepMs = 1_000;

export const createProviderFakeRuntime = (
  overrides: ProviderFakeRuntimeOverrides = {},
): ProviderFakeRuntimeContext => {
  let deterministicNow = baseTimeMs;
  let deterministicId = 0;
  const nextNow = (): number => {
    const value = deterministicNow;
    deterministicNow += clockStepMs;
    return value;
  };
  const nextId = (prefix: string): string => {
    deterministicId += 1;
    return `${prefix}_${String(deterministicId).padStart(8, "0")}`;
  };

  return {
    httpClient: overrides.httpClient ?? (async (url, init) => fetch(url, init)),
    clock: {
      now: overrides.clock?.now ?? nextNow,
      nowIso: overrides.clock?.nowIso ?? (() => new Date(nextNow()).toISOString()),
    },
    idGenerator: {
      randomId: overrides.idGenerator?.randomId ?? nextId,
    },
  };
};
