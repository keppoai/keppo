import type { XTypedHttpClient } from "./http-client.js";

export type XClient = XTypedHttpClient;

export type CreateXClient = (accessToken: string, namespace?: string) => XClient;
