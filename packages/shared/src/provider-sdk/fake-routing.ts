const DEFAULT_E2E_PORT_BASE = 9900;
const DEFAULT_E2E_PORT_BLOCK_SIZE = 20;

export const allowFakeProviderRouting = Boolean(
  process.env.KEPPO_FAKE_EXTERNAL_BASE_URL || process.env.KEPPO_E2E_FAKE_EXTERNAL_PORT,
);

export const trimTrailingSlash = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

export const withTrailingSlash = (value: string): string => {
  return `${trimTrailingSlash(value)}/`;
};

export const resolveNamespaceFakeGatewayBase = (namespace?: string): string | null => {
  if (!namespace) {
    return null;
  }

  const segments = namespace.split(".");
  if (segments.length < 4) {
    return null;
  }

  const workerIndex = Number(segments[1]);
  if (!Number.isInteger(workerIndex) || workerIndex < 0) {
    return null;
  }

  const basePort = Number.parseInt(process.env.KEPPO_E2E_PORT_BASE ?? "", 10);
  const blockSize = Number.parseInt(process.env.KEPPO_E2E_PORT_BLOCK_SIZE ?? "", 10);
  const safeBase =
    Number.isInteger(basePort) && basePort >= 1024 ? basePort : DEFAULT_E2E_PORT_BASE;
  const safeBlockSize =
    Number.isInteger(blockSize) && blockSize >= 5 ? blockSize : DEFAULT_E2E_PORT_BLOCK_SIZE;
  const fakeGatewayPort = safeBase + workerIndex * safeBlockSize + 1;
  return `http://127.0.0.1:${fakeGatewayPort}`;
};

export const resolveProviderApiBaseUrl = (options: {
  accessToken: string;
  namespace: string | undefined;
  fakeTokenPrefix: string;
  configuredBaseUrl: string | undefined;
  defaultBaseUrl: string;
  formatFakeBaseUrl: (baseUrl: string) => string;
  formatRealBaseUrl?: ((baseUrl: string) => string) | undefined;
  resolveFakeTokenConfiguredBaseUrl?: ((configuredBaseUrl: string) => string | null) | undefined;
}): string => {
  const fakeExternalBase = process.env.KEPPO_FAKE_EXTERNAL_BASE_URL?.trim();
  const fakeMode = Boolean(process.env.KEPPO_FAKE_EXTERNAL_BASE_URL);
  const namespaceFakeGateway = resolveNamespaceFakeGatewayBase(options.namespace);

  if (namespaceFakeGateway && fakeMode) {
    return options.formatFakeBaseUrl(namespaceFakeGateway);
  }

  if (fakeMode && fakeExternalBase) {
    return options.formatFakeBaseUrl(fakeExternalBase);
  }

  if (allowFakeProviderRouting && options.accessToken.startsWith(options.fakeTokenPrefix)) {
    if (namespaceFakeGateway) {
      return options.formatFakeBaseUrl(namespaceFakeGateway);
    }
    if (fakeExternalBase) {
      return options.formatFakeBaseUrl(fakeExternalBase);
    }

    const configuredBaseUrl = options.configuredBaseUrl?.trim();
    if (configuredBaseUrl && options.resolveFakeTokenConfiguredBaseUrl) {
      const configuredOverride = options.resolveFakeTokenConfiguredBaseUrl(configuredBaseUrl);
      if (configuredOverride) {
        return configuredOverride;
      }
    }

    const port = process.env.KEPPO_E2E_FAKE_EXTERNAL_PORT?.trim() || "9901";
    return options.formatFakeBaseUrl(`http://127.0.0.1:${port}`);
  }

  const realBaseUrl = (options.configuredBaseUrl ?? options.defaultBaseUrl).trim();
  return (options.formatRealBaseUrl ?? trimTrailingSlash)(realBaseUrl);
};
