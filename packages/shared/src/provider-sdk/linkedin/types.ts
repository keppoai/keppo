import type { ProviderSdkPort } from "../port.js";

export type LinkedInSdkContext = {
  accessToken: string;
  namespace?: string | undefined;
};

export type LinkedInQueryValue = string | number | boolean;

export type LinkedInProfile = {
  id: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  picture?: string;
  locale?: string;
  raw: Record<string, unknown>;
};

export type LinkedInRequestJsonClientArgs = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, LinkedInQueryValue> | undefined;
  headers?: Record<string, string> | undefined;
  body?: unknown;
  linkedinVersion?: string | undefined;
  restliProtocolVersion?: string | undefined;
};

export type LinkedInRequestJsonArgs = LinkedInSdkContext & LinkedInRequestJsonClientArgs;

export type LinkedInJsonResponse = {
  status: number;
  data: unknown;
  headers: Record<string, string>;
};

export interface LinkedInSdkPort extends ProviderSdkPort {
  getProfile(args: LinkedInSdkContext): Promise<LinkedInProfile>;
  requestJson(args: LinkedInRequestJsonArgs): Promise<LinkedInJsonResponse>;
}
