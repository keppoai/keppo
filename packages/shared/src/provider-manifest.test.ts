import { describe, expect, it } from "vitest";
import { providerMarketplaceManifestSchema } from "./provider-manifest.js";

const validManifest = {
  manifest_version: 1,
  provider: {
    id: "acme-mail",
    display_name: "Acme Mail",
    description: "Acme hosted mail provider",
    documentation_url: "https://docs.example.com/acme-mail",
  },
  module: {
    schema_version: 1,
    entrypoint: "providers/acme-mail/module.ts",
  },
  auth: {
    mode: "oauth2",
    managed: true,
  },
  capabilities: {
    read: true,
    write: true,
    refresh_credentials: true,
    webhook: false,
    automation_triggers: false,
  },
  env: [
    {
      name: "ACME_MAIL_CLIENT_ID",
      required: true,
    },
  ],
  tools: [
    {
      name: "acme-mail.listMessages",
      capability: "read",
      risk_level: "low",
      requires_approval: false,
    },
    {
      name: "acme-mail.sendMessage",
      capability: "write",
      risk_level: "medium",
      requires_approval: true,
    },
  ],
};

describe("provider marketplace manifest schema", () => {
  it("accepts a valid manifest", () => {
    expect(providerMarketplaceManifestSchema.parse(validManifest).provider.id).toBe("acme-mail");
  });

  it("rejects duplicate tool names", () => {
    expect(() =>
      providerMarketplaceManifestSchema.parse({
        ...validManifest,
        tools: [
          ...validManifest.tools,
          {
            ...validManifest.tools[0],
          },
        ],
      }),
    ).toThrowError(/duplicate tool/i);
  });

  it("requires sunset_at when deprecated status is sunset", () => {
    expect(() =>
      providerMarketplaceManifestSchema.parse({
        ...validManifest,
        deprecation: {
          status: "sunset",
          message: "Provider is being removed",
        },
      }),
    ).toThrowError(/sunset_at/i);
  });
});
