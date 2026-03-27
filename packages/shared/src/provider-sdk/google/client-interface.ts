export type GmailClientRequestOptions = {
  headers?: Record<string, string>;
  adapter?: (options: unknown) => Promise<unknown>;
};

type GmailDataResponse = Promise<{ data: Record<string, unknown> }>;

export interface GmailClient {
  users: {
    messages: {
      list(...args: unknown[]): GmailDataResponse;
      get(...args: unknown[]): GmailDataResponse;
      send(...args: unknown[]): GmailDataResponse;
      batchModify(...args: unknown[]): GmailDataResponse;
      trash(...args: unknown[]): GmailDataResponse;
      untrash(...args: unknown[]): GmailDataResponse;
      attachments: {
        get(...args: unknown[]): GmailDataResponse;
      };
    };
    threads: {
      modify(...args: unknown[]): GmailDataResponse;
      get(...args: unknown[]): GmailDataResponse;
      trash(...args: unknown[]): GmailDataResponse;
      untrash(...args: unknown[]): GmailDataResponse;
    };
    getProfile(...args: unknown[]): GmailDataResponse;
    labels: {
      list(...args: unknown[]): GmailDataResponse;
      create(...args: unknown[]): GmailDataResponse;
      get(...args: unknown[]): GmailDataResponse;
      update(...args: unknown[]): GmailDataResponse;
      delete(...args: unknown[]): GmailDataResponse;
    };
    drafts: {
      create(...args: unknown[]): GmailDataResponse;
      list(...args: unknown[]): GmailDataResponse;
      get(...args: unknown[]): GmailDataResponse;
      update(...args: unknown[]): GmailDataResponse;
      send(...args: unknown[]): GmailDataResponse;
      delete(...args: unknown[]): GmailDataResponse;
    };
    history: {
      list(...args: unknown[]): GmailDataResponse;
    };
    watch(...args: unknown[]): GmailDataResponse;
    stop(...args: unknown[]): GmailDataResponse;
    settings: {
      filters: {
        list(...args: unknown[]): GmailDataResponse;
        create(...args: unknown[]): GmailDataResponse;
        delete(...args: unknown[]): GmailDataResponse;
        get(...args: unknown[]): GmailDataResponse;
      };
      sendAs: {
        list(...args: unknown[]): GmailDataResponse;
        get(...args: unknown[]): GmailDataResponse;
        update(...args: unknown[]): GmailDataResponse;
      };
      getVacation(...args: unknown[]): GmailDataResponse;
      updateVacation(...args: unknown[]): GmailDataResponse;
    };
  };
}

export type CreateGmailClient = (accessToken: string, namespace?: string) => GmailClient;
