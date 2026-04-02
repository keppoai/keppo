import { describe, expect, it, vi } from "vitest";
import { WEBHOOK_VERIFICATION_REASON } from "@keppo/shared/domain";
import {
  dispatchStartOwnedWebhookRequest,
  handleProviderWebhookRequest,
} from "../../app/lib/server/webhook-api";

const createDeps = () => {
  const verifyWebhook = vi.fn().mockResolvedValue({ verified: true });
  const extractWebhookEvent = vi.fn().mockReturnValue({
    deliveryId: "evt_webhook_test",
    eventType: "invoice.payment_succeeded",
    externalAccountId: "acct_test",
  });

  return {
    convex: {
      claimApiDedupeKey: vi
        .fn()
        .mockResolvedValueOnce({
          claimed: true,
          status: "pending",
          payload: null,
          expiresAtMs: Date.now() + 60_000,
        })
        .mockResolvedValueOnce({
          claimed: false,
          status: "completed",
          payload: null,
          expiresAtMs: Date.now() + 60_000,
        }),
      completeApiDedupeKey: vi.fn().mockResolvedValue(true),
      getApiDedupeKey: vi.fn().mockResolvedValue(null),
      getFeatureFlag: vi.fn().mockResolvedValue(true),
      ingestProviderEvent: vi.fn().mockResolvedValue(undefined),
      recordProviderMetric: vi.fn().mockResolvedValue(undefined),
      recordProviderWebhook: vi.fn().mockResolvedValue({
        matched_org_ids: ["org_test"],
        matched_integrations: 1,
        matched_orgs: 1,
      }),
      releaseApiDedupeKey: vi.fn().mockResolvedValue(true),
      setApiDedupePayload: vi.fn().mockResolvedValue(true),
    },
    getE2ENamespace: (value: string | undefined) => value?.trim() || null,
    getProviderModule: vi.fn().mockReturnValue({
      facets: {
        webhooks: {
          verifyWebhook,
          extractWebhookEvent,
        },
      },
      metadata: {
        providerId: "stripe",
      },
    }),
    isWebhookProvider: (provider: string): provider is "stripe" => provider === "stripe",
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    parseJsonPayload: (raw: string) => JSON.parse(raw),
    toLowercaseHeaders: (headers: Headers) => {
      const normalized: Record<string, string | undefined> = {};
      headers.forEach((value, key) => {
        normalized[key.toLowerCase()] = value;
      });
      return normalized;
    },
    toProviderRuntimeContext: vi.fn().mockReturnValue({}) as never,
    trackAnalyticsEvent: vi.fn(),
    verifyWebhook,
    extractWebhookEvent,
    webhookBoundaryResponse: vi.fn(
      (request: Request, provider: string, defaultCode: string, defaultMessage: string) => {
        return Response.json(
          {
            error: {
              code: defaultCode,
              message: defaultMessage,
              provider,
            },
          },
          {
            status: 400,
            headers: {
              "x-content-type-options": "nosniff",
            },
          },
        );
      },
    ),
  };
};

const withWebhook = (provider: string, body: unknown, headers?: HeadersInit): Request =>
  new Request(`http://127.0.0.1/webhooks/${provider}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("start-owned webhook api handlers", () => {
  it("returns 404 for unsupported providers", async () => {
    const deps = createDeps();

    const response = await handleProviderWebhookRequest(
      withWebhook("google", { id: "evt_test" }),
      deps,
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  it("returns typed boundary errors when signature verification fails", async () => {
    const deps = createDeps();
    deps.verifyWebhook.mockResolvedValueOnce({
      verified: false,
      reason: WEBHOOK_VERIFICATION_REASON.missingOrMalformedSignature,
    });

    const response = await handleProviderWebhookRequest(
      withWebhook("stripe", { id: "evt_missing_sig" }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_signature_payload",
        provider: "stripe",
      },
    });
    expect(deps.convex.recordProviderWebhook).not.toHaveBeenCalled();
  });

  it("records webhook deliveries and returns duplicate=true on replay", async () => {
    const deps = createDeps();
    const first = await handleProviderWebhookRequest(
      withWebhook(
        "stripe",
        {
          id: "evt_duplicate_test",
          type: "invoice.payment_succeeded",
          account: "acct_test",
        },
        {
          "stripe-signature": "t=1,v1=test",
          "x-keppo-e2e-namespace": "webhook-test",
        },
      ),
      deps,
    );
    const duplicate = await handleProviderWebhookRequest(
      withWebhook(
        "stripe",
        {
          id: "evt_duplicate_test",
          type: "invoice.payment_succeeded",
          account: "acct_test",
        },
        {
          "stripe-signature": "t=1,v1=test",
          "x-keppo-e2e-namespace": "webhook-test",
        },
      ),
      deps,
    );

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      received: true,
      provider: "stripe",
      duplicate: false,
      matched_integrations: 1,
      matched_orgs: 1,
    });
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      received: true,
      provider: "stripe",
      duplicate: true,
    });
    expect(deps.extractWebhookEvent).toHaveBeenCalledTimes(2);
    expect(deps.convex.recordProviderWebhook).toHaveBeenCalledTimes(1);
    expect(deps.convex.ingestProviderEvent).toHaveBeenCalledWith({
      orgId: "org_test",
      provider: "stripe",
      providerEventType: "invoice.payment_succeeded",
      providerEventId: "evt_webhook_test",
      deliveryMode: "webhook",
      eventPayload: {
        account: "acct_test",
        id: "evt_duplicate_test",
        type: "invoice.payment_succeeded",
      },
      eventPayloadRef: "evt_webhook_test",
    });
  });

  it("does not fan out webhook events when the provider event has no external account id", async () => {
    const deps = createDeps();
    deps.extractWebhookEvent.mockReturnValueOnce({
      deliveryId: "evt_missing_account",
      eventType: "invoice.payment_succeeded",
      externalAccountId: null,
    });
    deps.convex.recordProviderWebhook.mockResolvedValueOnce({
      matched_org_ids: [],
      matched_integrations: 0,
      matched_orgs: 0,
    });

    const response = await handleProviderWebhookRequest(
      withWebhook(
        "stripe",
        {
          id: "evt_missing_account",
          type: "invoice.payment_succeeded",
        },
        {
          "stripe-signature": "t=1,v1=test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: true,
      provider: "stripe",
      duplicate: false,
      matched_integrations: 0,
      matched_orgs: 0,
    });
    expect(deps.convex.recordProviderWebhook).toHaveBeenCalledWith({
      provider: "stripe",
      externalAccountId: null,
      eventType: "invoice.payment_succeeded",
      payload: {
        id: "evt_missing_account",
        type: "invoice.payment_succeeded",
      },
      receivedAt: expect.any(String),
    });
    expect(deps.convex.ingestProviderEvent).not.toHaveBeenCalled();
  });

  it("dispatches only matching Start-owned webhook routes", async () => {
    const deps = createDeps();

    const handled = await dispatchStartOwnedWebhookRequest(
      withWebhook("stripe", {
        id: "evt_dispatch_test",
        type: "invoice.payment_succeeded",
      }),
      deps,
    );
    const unhandled = await dispatchStartOwnedWebhookRequest(
      new Request("http://127.0.0.1/health", { method: "POST" }),
      deps,
    );

    expect(handled?.status).toBe(200);
    expect(unhandled).toBeNull();
  });
});
