import { afterEach, describe, expect, it, vi } from "vitest";
import { getDyadGatewayUserInfo } from "./dyad-gateway";

describe("dyad gateway client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sanitizes gateway error payloads", async () => {
    vi.stubEnv("KEPPO_LLM_GATEWAY_URL", "https://gateway.keppo.test");
    vi.stubEnv("KEPPO_LLM_GATEWAY_MASTER_KEY", "gateway_master_test");
    vi.stubEnv("KEPPO_LLM_GATEWAY_TEAM_ID", "team_keppo");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "secret backend failure" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(getDyadGatewayUserInfo("org_test")).rejects.toThrow(
      "Dyad Gateway request failed (GET /user/info?user_id=keppo%3Aorg_test) with status 500",
    );
    await expect(getDyadGatewayUserInfo("org_test")).rejects.not.toThrow("secret backend failure");
  });
});
