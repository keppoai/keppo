import { describe, expect, it } from "vitest";
import { createFakeLinkedInSdk } from "../../../provider-sdk/linkedin/fake.js";
import { createLinkedInConnector } from "./connector-runtime.js";

describe("linkedin connector runtime", () => {
  it("fails closed for API tools when the integration only has identity scopes", async () => {
    const connector = createLinkedInConnector({ sdk: createFakeLinkedInSdk() });
    const context = {
      workspaceId: "workspace_test",
      orgId: "org_test",
      access_token: "fake_linkedin_token",
      scopes: ["openid", "profile", "email"],
    };

    await expect(
      connector.executeRead("linkedin.readApi", { path: "/rest/posts" }, context),
    ).rejects.toThrow(/Missing scopes/i);
    await expect(
      connector.prepareWrite(
        "linkedin.writeApi",
        { method: "POST", path: "/rest/posts", body: { commentary: "Hello" } },
        context,
      ),
    ).rejects.toThrow(/Missing scopes/i);
  });

  it("hides LinkedIn API tools until an approved API scope is present", () => {
    const connector = createLinkedInConnector({ sdk: createFakeLinkedInSdk() });

    expect(
      connector.listTools({
        workspaceId: "workspace_test",
        orgId: "org_test",
        access_token: "fake_linkedin_token",
        scopes: ["openid", "profile", "email"],
      }),
    ).toMatchObject([{ name: "linkedin.getProfile" }]);
  });

  it("allows API tools once a non-identity LinkedIn scope is present", async () => {
    const connector = createLinkedInConnector({ sdk: createFakeLinkedInSdk() });
    const context = {
      workspaceId: "workspace_test",
      orgId: "org_test",
      access_token: "fake_linkedin_token",
      scopes: ["openid", "profile", "email", "w_member_social"],
    };

    await expect(
      connector.executeRead("linkedin.readApi", { path: "/rest/posts" }, context),
    ).resolves.toMatchObject({
      path: "/rest/posts",
      status: 200,
    });
    expect(connector.listTools(context).map((tool) => tool.name)).toEqual([
      "linkedin.getProfile",
      "linkedin.readApi",
      "linkedin.writeApi",
    ]);
  });
});
