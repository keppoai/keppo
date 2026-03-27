export type ProviderEventRecord = {
  id: string;
  at: string;
  namespace: string;
  provider: string;
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  statusCode: number;
};

export type ProviderErrorEnvelope = {
  error: {
    code: string;
    message: string;
  };
};
