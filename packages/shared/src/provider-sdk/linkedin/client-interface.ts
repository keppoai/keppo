import type { LinkedInJsonResponse, LinkedInRequestJsonClientArgs } from "./types.js";

export type LinkedInClient = {
  getProfile: () => Promise<Record<string, unknown>>;
  requestJson: (args: LinkedInRequestJsonClientArgs) => Promise<LinkedInJsonResponse>;
};

export type CreateLinkedInClient = (accessToken: string, namespace?: string) => LinkedInClient;
