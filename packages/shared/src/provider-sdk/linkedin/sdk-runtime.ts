import type { ProviderSdkCallLog, ProviderSdkRuntime } from "../port.js";
import { BaseSdkPort } from "../base-sdk.js";
import type { CreateLinkedInClient } from "./client-interface.js";
import { toProviderSdkError } from "./errors.js";
import type {
  LinkedInJsonResponse,
  LinkedInProfile,
  LinkedInRequestJsonArgs,
  LinkedInSdkContext,
  LinkedInSdkPort,
} from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const readString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readPicture = (profile: Record<string, unknown>): string | undefined => {
  const directPicture = readString(profile.picture);
  if (directPicture) {
    return directPicture;
  }

  const profilePicture = profile.profilePicture;
  if (!isRecord(profilePicture)) {
    return undefined;
  }

  const displayImage = profilePicture["displayImage~"];
  if (!isRecord(displayImage) || !Array.isArray(displayImage.elements)) {
    return undefined;
  }

  for (const element of displayImage.elements) {
    if (!isRecord(element) || !Array.isArray(element.identifiers)) {
      continue;
    }
    for (const identifier of element.identifiers) {
      if (!isRecord(identifier)) {
        continue;
      }
      const value = readString(identifier.identifier);
      if (value) {
        return value;
      }
    }
  }

  return undefined;
};

const normalizeProfile = (rawProfile: Record<string, unknown>): LinkedInProfile => {
  const id = readString(rawProfile.sub) ?? readString(rawProfile.id);
  if (!id) {
    throw new Error(
      "invalid_provider_response: LinkedIn profile lookup did not return a provider account identifier.",
    );
  }

  const givenName =
    readString(rawProfile.given_name) ??
    readString(rawProfile.localizedFirstName) ??
    readString(rawProfile.firstName);
  const familyName =
    readString(rawProfile.family_name) ??
    readString(rawProfile.localizedLastName) ??
    readString(rawProfile.lastName);
  const name =
    readString(rawProfile.name) ??
    (givenName || familyName ? [givenName, familyName].filter(Boolean).join(" ") : undefined);

  const profile: LinkedInProfile = {
    id,
    raw: rawProfile,
  };
  if (name) {
    profile.name = name;
  }
  if (givenName) {
    profile.givenName = givenName;
  }
  if (familyName) {
    profile.familyName = familyName;
  }
  const email = readString(rawProfile.email);
  if (email) {
    profile.email = email;
  }
  const picture = readPicture(rawProfile);
  if (picture) {
    profile.picture = picture;
  }
  const locale = readString(rawProfile.locale);
  if (locale) {
    profile.locale = locale;
  }
  return profile;
};

export class LinkedInSdk extends BaseSdkPort<CreateLinkedInClient> implements LinkedInSdkPort {
  constructor(options: {
    createClient: CreateLinkedInClient;
    runtime?: ProviderSdkRuntime;
    callLog?: ProviderSdkCallLog;
  }) {
    super({
      providerId: "linkedin",
      createClient: options.createClient,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async getProfile(args: LinkedInSdkContext): Promise<LinkedInProfile> {
    const method = "linkedin.members.getProfile";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      const profile = normalizeProfile(await this.client(args).getProfile());
      this.captureOk(args.namespace, method, normalizedArgs, profile);
      return profile;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async requestJson(args: LinkedInRequestJsonArgs): Promise<LinkedInJsonResponse> {
    const method = "linkedin.api.requestJson";
    const normalizedArgs = {
      namespace: args.namespace,
      method: args.method,
      path: args.path,
      ...(args.query ? { query: { ...args.query } } : {}),
      ...(args.headers ? { headerNames: Object.keys(args.headers).sort() } : {}),
      ...(args.linkedinVersion ? { linkedinVersion: args.linkedinVersion } : {}),
      ...(args.restliProtocolVersion ? { restliProtocolVersion: args.restliProtocolVersion } : {}),
      hasBody: args.body !== undefined,
    };

    try {
      const response = await this.client(args).requestJson(args);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  private client(args: LinkedInSdkContext) {
    return this.createClient(args.accessToken, args.namespace);
  }
}
