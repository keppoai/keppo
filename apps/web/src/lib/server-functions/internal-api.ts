import { createServerFn } from "@tanstack/react-start";
import { getStartContext } from "@tanstack/start-storage-context";
import { z } from "zod";
import { parseOAuthConnectResponse } from "@keppo/shared/providers/boundaries/error-boundary";
import { parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import type { OAuthConnectResponse } from "@keppo/shared/providers/boundaries/types";
import type { ApiResult } from "@/lib/api-errors";
import { toSerializedApiError, unwrapApiResult } from "@/lib/api-errors";
import {
  parseAuditErrors,
  parseDeepHealth,
  parseDlqList,
  parseFeatureFlags,
  type AuditErrorListResponse,
  type DeepHealthResponse,
  type DlqListResponse,
  type FeatureFlagListResponse,
} from "@/lib/admin-health";
import { createProtocolNotFoundResponse } from "@/lib/protocol-boundary";

type JsonRecord = Record<string, NonNullable<unknown>> | null;
type E2EServerFnMockName = "generateAutomationPrompt" | "generateAutomationQuestions";
const NO_E2E_SERVER_FN_MOCK = Symbol("no-e2e-server-fn-mock");

export const normalizeOptionalBetterAuthCookie = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value as string;
};

const optionalBetterAuthCookieSchema = z.string().min(1).nullish();

declare global {
  interface Window {
    __KEPPO_E2E_METADATA__?: unknown;
    __KEPPO_E2E_SERVER_FN_MOCKS__?: Partial<
      Record<E2EServerFnMockName, unknown | ((data: unknown) => unknown | Promise<unknown>)>
    >;
  }
}

const inviteCreateInputSchema = z.object({
  orgId: z.string().min(1),
  inviterUserId: z.string().min(1),
  inviterName: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["owner", "admin", "approver", "viewer"]),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const inviteAcceptInputSchema = z.object({
  token: z.string().min(1),
  userId: z.string().min(1),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const billingCheckoutInputSchema = z.object({
  orgId: z.string().min(1),
  tier: z.enum(["starter", "pro"]),
  successUrl: z.string().min(1).optional(),
  cancelUrl: z.string().min(1).optional(),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const billingPortalInputSchema = z.object({
  orgId: z.string().min(1),
  returnUrl: z.string().min(1).optional(),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const billingCreditsCheckoutInputSchema = z.object({
  orgId: z.string().min(1),
  packageIndex: z.number().int().min(0),
  customerEmail: z.string().email().optional(),
  successUrl: z.string().min(1).optional(),
  cancelUrl: z.string().min(1).optional(),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const billingAutomationRunCheckoutInputSchema = z.object({
  orgId: z.string().min(1),
  packageIndex: z.number().int().min(0),
  customerEmail: z.string().email().optional(),
  successUrl: z.string().min(1).optional(),
  cancelUrl: z.string().min(1).optional(),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const billingSubscriptionAddressSchema = z.object({
  line1: z.string().min(1).max(256),
  line2: z.string().max(256).optional(),
  city: z.string().max(256).optional(),
  state: z.string().max(256).optional(),
  postalCode: z.string().min(1).max(32),
  country: z.string().length(2),
});

const billingSubscriptionChangeInputSchema = z
  .object({
    orgId: z.string().min(1),
    targetTier: z.enum(["starter", "pro", "free"]),
    billing: z
      .object({
        name: z.string().min(1).max(256),
        companyName: z.string().max(256).optional(),
        address: billingSubscriptionAddressSchema,
      })
      .optional(),
    betterAuthCookie: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targetTier !== "free" && !value.billing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["billing"],
        message: "billing is required unless targetTier is free.",
      });
    }
  });

const billingSubscriptionUndoCancelInputSchema = z.object({
  orgId: z.string().min(1),
  betterAuthCookie: z.string().min(1).optional(),
});

const billingSubscriptionPendingInputSchema = z.object({
  orgId: z.string().min(1),
  betterAuthCookie: z.string().min(1).optional(),
});

const automationPromptInputSchema = z.object({
  workspace_id: z.string().min(1),
  user_description: z.string().min(1),
  generation_mode: z.enum(["create", "edit", "mermaid_only"]).optional(),
  automation_context: z
    .object({
      automation_id: z.string().min(1).optional(),
      name: z.string().min(1),
      description: z.string(),
      mermaid_content: z.string(),
      trigger_type: z.enum(["schedule", "event", "manual"]),
      schedule_cron: z.string().optional().nullable(),
      event_provider: z.string().optional().nullable(),
      event_type: z.string().optional().nullable(),
      ai_model_provider: z.enum(["openai", "anthropic"]),
      ai_model_name: z.string().min(1),
      network_access: z.enum(["mcp_only", "mcp_and_web"]),
      prompt: z.string().min(1),
    })
    .optional(),
  clarification_questions: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        description: z.string().min(1).optional(),
        input_type: z.enum(["radio", "checkbox", "text"]),
        required: z.boolean(),
        options: z.array(
          z.object({
            value: z.string().min(1),
            label: z.string().min(1),
            description: z.string().min(1).optional(),
          }),
        ),
        placeholder: z.string().min(1).optional(),
      }),
    )
    .max(4)
    .optional(),
  clarification_answers: z
    .array(
      z.object({
        question_id: z.string().min(1),
        value: z.union([z.string().min(1), z.array(z.string().min(1))]),
      }),
    )
    .max(4)
    .optional(),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const automationQuestionsInputSchema = z.object({
  workspace_id: z.string().min(1),
  user_description: z.string().min(1),
  automation_context: z
    .object({
      automation_id: z.string().min(1).optional(),
      name: z.string().min(1),
      description: z.string(),
      mermaid_content: z.string(),
      trigger_type: z.enum(["schedule", "event", "manual"]),
      schedule_cron: z.string().optional().nullable(),
      event_provider: z.string().optional().nullable(),
      event_type: z.string().optional().nullable(),
      ai_model_provider: z.enum(["openai", "anthropic"]),
      ai_model_name: z.string().min(1),
      network_access: z.enum(["mcp_only", "mcp_and_web"]),
      prompt: z.string().min(1),
    })
    .optional(),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const openAiHelperSessionInputSchema = z.object({
  return_to: z.string().min(1),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const completeOpenAiOauthInputSchema = z.object({
  callback_url: z.string().min(1),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const workspaceMcpTestInputSchema = z.object({
  workspaceId: z.string().min(1),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const oauthProviderConnectInputSchema = z.object({
  provider: z.string().min(1),
  org_id: z.string().min(1),
  return_to: z.string().min(1),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const pushSubscribeInputSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  subscription: z.record(z.string(), z.unknown()),
  betterAuthCookie: optionalBetterAuthCookieSchema,
});

const adminHealthListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

const adminDlqActionInputSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["replay", "abandon"]),
});

export type InviteCreateInput = z.infer<typeof inviteCreateInputSchema>;
export type InviteAcceptInput = z.infer<typeof inviteAcceptInputSchema>;
export type BillingCheckoutInput = z.infer<typeof billingCheckoutInputSchema>;
export type BillingPortalInput = z.infer<typeof billingPortalInputSchema>;
export type BillingCreditsCheckoutInput = z.infer<typeof billingCreditsCheckoutInputSchema>;
export type BillingAutomationRunCheckoutInput = z.infer<
  typeof billingAutomationRunCheckoutInputSchema
>;
export type BillingSubscriptionChangeInput = z.infer<typeof billingSubscriptionChangeInputSchema>;
export type BillingSubscriptionUndoCancelInput = z.infer<
  typeof billingSubscriptionUndoCancelInputSchema
>;
export type BillingSubscriptionPendingInput = z.infer<typeof billingSubscriptionPendingInputSchema>;
export type AutomationPromptInput = z.infer<typeof automationPromptInputSchema>;
export type AutomationQuestionsInput = z.infer<typeof automationQuestionsInputSchema>;
export type OpenAiHelperSessionInput = z.infer<typeof openAiHelperSessionInputSchema>;
export type CompleteOpenAiOauthInput = z.infer<typeof completeOpenAiOauthInputSchema>;
export type WorkspaceMcpTestInput = z.infer<typeof workspaceMcpTestInputSchema>;
export type OAuthProviderConnectInput = z.infer<typeof oauthProviderConnectInputSchema>;
export type PushSubscribeInput = z.infer<typeof pushSubscribeInputSchema>;
export type AdminHealthListInput = z.infer<typeof adminHealthListInputSchema>;
export type AdminDlqActionInput = z.infer<typeof adminDlqActionInputSchema>;

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
} satisfies HeadersInit;

const forwardedSessionHeaders = [
  "authorization",
  "better-auth-cookie",
  "cookie",
  "x-keppo-e2e-namespace",
  "x-e2e-test-id",
  "x-e2e-scenario-id",
] as const;

const buildForwardedRequest = (path: string, init: RequestInit): Request => {
  const currentRequest = getStartContext().request;
  const url = new URL(path, currentRequest.url);
  const headers = new Headers();

  for (const name of forwardedSessionHeaders) {
    const value = currentRequest.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  const cookieHeader = headers.get("cookie");
  if (cookieHeader && !headers.has("better-auth-cookie")) {
    headers.set("better-auth-cookie", cookieHeader);
  }

  if (init.headers) {
    for (const [key, value] of new Headers(init.headers).entries()) {
      headers.set(key, value);
    }
  }

  const requestInit: RequestInit = {
    method: init.method ?? "GET",
    headers,
  };
  if (init.body !== undefined) {
    requestInit.body = init.body;
  }
  return new Request(url, requestInit);
};

const loadStartOwnedDispatchers = async () => {
  const [
    { dispatchStartOwnedAdminHealthRequest },
    { dispatchStartOwnedAutomationApiRequest },
    { dispatchStartOwnedBillingRequest },
    { dispatchStartOwnedInternalApiRequest },
    { dispatchStartOwnedOAuthApiRequest },
  ] = await Promise.all([
    import("../../../app/lib/server/admin-health-api"),
    import("../../../app/lib/server/automation-api"),
    import("../../../app/lib/server/billing-api"),
    import("../../../app/lib/server/internal-api"),
    import("../../../app/lib/server/oauth-api"),
  ]);

  return {
    dispatchStartOwnedAdminHealthRequest,
    dispatchStartOwnedAutomationApiRequest,
    dispatchStartOwnedBillingRequest,
    dispatchStartOwnedInternalApiRequest,
    dispatchStartOwnedOAuthApiRequest,
  };
};

const resolveE2EServerFnMock = async <T>(
  name: E2EServerFnMockName,
  data: unknown,
): Promise<T | typeof NO_E2E_SERVER_FN_MOCK> => {
  if (typeof window === "undefined" || window.__KEPPO_E2E_METADATA__ === undefined) {
    return NO_E2E_SERVER_FN_MOCK;
  }
  const entry = window.__KEPPO_E2E_SERVER_FN_MOCKS__?.[name];
  if (entry === undefined) {
    return NO_E2E_SERVER_FN_MOCK;
  }
  if (typeof entry === "function") {
    return (await entry(data)) as T;
  }
  return entry as T;
};

const callInternalJson = async <T extends JsonRecord>(
  path: string,
  init: RequestInit,
  betterAuthCookie?: string,
): Promise<ApiResult<T>> => {
  const request = buildForwardedRequest(path, init);
  if (betterAuthCookie) {
    request.headers.set("better-auth-cookie", betterAuthCookie);
    if (!request.headers.has("cookie")) {
      request.headers.set("cookie", betterAuthCookie);
    }
  }

  const {
    dispatchStartOwnedAdminHealthRequest,
    dispatchStartOwnedAutomationApiRequest,
    dispatchStartOwnedBillingRequest,
    dispatchStartOwnedInternalApiRequest,
    dispatchStartOwnedOAuthApiRequest,
  } = await loadStartOwnedDispatchers();

  const response =
    (await dispatchStartOwnedBillingRequest(request)) ??
    (await dispatchStartOwnedInternalApiRequest(request)) ??
    (await dispatchStartOwnedAutomationApiRequest(request)) ??
    (await dispatchStartOwnedAdminHealthRequest(request)) ??
    (await dispatchStartOwnedOAuthApiRequest(request)) ??
    createProtocolNotFoundResponse(request);

  if (!response.ok) {
    return {
      ok: false,
      error: await toSerializedApiError(response, path),
    };
  }

  const responseText = await response.text();
  const parsedResponse = responseText.length > 0 ? parseJsonValue(responseText) : null;
  return {
    ok: true,
    data: parsedResponse as T,
  };
};

const postJson = async <T extends JsonRecord>(
  path: string,
  body: unknown,
  betterAuthCookie?: string,
): Promise<ApiResult<T>> => {
  return await callInternalJson<T>(
    path,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    },
    betterAuthCookie,
  );
};

const getJson = async <T extends JsonRecord>(
  path: string,
  betterAuthCookie?: string,
): Promise<ApiResult<T>> => {
  return await callInternalJson<T>(
    path,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
    betterAuthCookie,
  );
};

const inviteCreateServerFn = createServerFn({ method: "POST" })
  .inputValidator(inviteCreateInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<{ inviteId: string }>(
        "/api/invites/create",
        {
          orgId: data.orgId,
          inviterUserId: data.inviterUserId,
          inviterName: data.inviterName,
          email: data.email,
          role: data.role,
        },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const inviteAcceptServerFn = createServerFn({ method: "POST" })
  .inputValidator(inviteAcceptInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<{ orgName?: string }>(
        "/api/invites/accept",
        { token: data.token, userId: data.userId },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const billingCheckoutServerFn = createServerFn({ method: "POST" })
  .inputValidator(billingCheckoutInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<{ checkout_url?: string; url?: string } | null>(
        "/api/billing/checkout",
        {
          orgId: data.orgId,
          tier: data.tier,
          ...(data.successUrl ? { successUrl: data.successUrl } : {}),
          ...(data.cancelUrl ? { cancelUrl: data.cancelUrl } : {}),
        },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const billingPortalServerFn = createServerFn({ method: "POST" })
  .inputValidator(billingPortalInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<{ portal_url?: string; url?: string } | null>(
        "/api/billing/portal",
        {
          orgId: data.orgId,
          ...(data.returnUrl ? { returnUrl: data.returnUrl } : {}),
        },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const billingCreditsCheckoutServerFn = createServerFn({ method: "POST" })
  .inputValidator(billingCreditsCheckoutInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<{ checkout_url?: string } | null>(
        "/api/billing/credits/checkout",
        {
          orgId: data.orgId,
          packageIndex: data.packageIndex,
          ...(data.customerEmail ? { customerEmail: data.customerEmail } : {}),
          ...(data.successUrl ? { successUrl: data.successUrl } : {}),
          ...(data.cancelUrl ? { cancelUrl: data.cancelUrl } : {}),
        },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const billingAutomationRunCheckoutServerFn = createServerFn({ method: "POST" })
  .inputValidator(billingAutomationRunCheckoutInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<{ checkout_url?: string } | null>(
        "/api/billing/automation-runs/checkout",
        {
          orgId: data.orgId,
          packageIndex: data.packageIndex,
          ...(data.customerEmail ? { customerEmail: data.customerEmail } : {}),
          ...(data.successUrl ? { successUrl: data.successUrl } : {}),
          ...(data.cancelUrl ? { cancelUrl: data.cancelUrl } : {}),
        },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const billingSubscriptionChangeServerFn = createServerFn({ method: "POST" })
  .inputValidator(billingSubscriptionChangeInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<JsonRecord>(
        "/api/billing/subscription/change",
        {
          orgId: data.orgId,
          targetTier: data.targetTier,
          ...(data.billing
            ? {
                billing: {
                  name: data.billing.name,
                  ...(data.billing.companyName ? { companyName: data.billing.companyName } : {}),
                  address: {
                    line1: data.billing.address.line1,
                    ...(data.billing.address.line2 ? { line2: data.billing.address.line2 } : {}),
                    ...(data.billing.address.city ? { city: data.billing.address.city } : {}),
                    ...(data.billing.address.state ? { state: data.billing.address.state } : {}),
                    postalCode: data.billing.address.postalCode,
                    country: data.billing.address.country.toUpperCase(),
                  },
                },
              }
            : {}),
        },
        data.betterAuthCookie,
      ),
  );

const billingSubscriptionUndoCancelServerFn = createServerFn({ method: "POST" })
  .inputValidator(billingSubscriptionUndoCancelInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<JsonRecord>(
        "/api/billing/subscription/change",
        { orgId: data.orgId, undoCancelAtPeriodEnd: true },
        data.betterAuthCookie,
      ),
  );

const billingSubscriptionPendingServerFn = createServerFn({ method: "GET" })
  .inputValidator(billingSubscriptionPendingInputSchema)
  .handler(async ({ data }) => {
    const search = new URLSearchParams({ orgId: data.orgId }).toString();
    return await getJson<JsonRecord>(
      `/api/billing/subscription/pending-change?${search}`,
      data.betterAuthCookie,
    );
  });

const generateAutomationPromptServerFn = createServerFn({ method: "POST" })
  .inputValidator(automationPromptInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<JsonRecord>(
        "/api/automations/generate-prompt",
        {
          workspace_id: data.workspace_id,
          user_description: data.user_description,
          ...(data.generation_mode ? { generation_mode: data.generation_mode } : {}),
          ...(data.automation_context ? { automation_context: data.automation_context } : {}),
          clarification_questions: data.clarification_questions,
          clarification_answers: data.clarification_answers,
        },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const generateAutomationQuestionsServerFn = createServerFn({ method: "POST" })
  .inputValidator(automationQuestionsInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<JsonRecord>(
        "/api/automations/generate-questions",
        {
          workspace_id: data.workspace_id,
          user_description: data.user_description,
          ...(data.automation_context ? { automation_context: data.automation_context } : {}),
        },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const openAiHelperSessionServerFn = createServerFn({ method: "POST" })
  .inputValidator(openAiHelperSessionInputSchema)
  .handler(async ({ data }) => {
    const search = new URLSearchParams({ return_to: data.return_to }).toString();
    return await getJson<JsonRecord>(
      `/api/automations/openai/helper-session?${search}`,
      normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
    );
  });

const completeOpenAiOauthServerFn = createServerFn({ method: "POST" })
  .inputValidator(completeOpenAiOauthInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<JsonRecord>(
        "/api/automations/openai/complete",
        { callback_url: data.callback_url },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const workspaceMcpTestServerFn = createServerFn({ method: "POST" })
  .inputValidator(workspaceMcpTestInputSchema)
  .handler(async ({ data }) => {
    const search = new URLSearchParams({ workspaceId: data.workspaceId }).toString();
    return await getJson<{ ok?: boolean; error?: string; message?: string }>(
      `/api/mcp/test?${search}`,
      normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
    );
  });

const oauthProviderConnectServerFn = createServerFn({ method: "POST" })
  .inputValidator(oauthProviderConnectInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<JsonRecord>(
        `/api/oauth/integrations/${encodeURIComponent(data.provider)}/connect`,
        {
          org_id: data.org_id,
          return_to: data.return_to,
        },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const pushSubscribeServerFn = createServerFn({ method: "POST" })
  .inputValidator(pushSubscribeInputSchema)
  .handler(
    async ({ data }) =>
      await postJson<JsonRecord>(
        "/api/notifications/push/subscribe",
        {
          orgId: data.orgId,
          userId: data.userId,
          subscription: data.subscription,
        },
        normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      ),
  );

const adminDeepHealthServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const payload = unwrapApiResult(
    (await getJson<Record<string, NonNullable<unknown>>>("/api/health/deep")) as ApiResult<
      Record<string, NonNullable<unknown>>
    >,
  );
  return parseDeepHealth(payload);
});

const adminHealthDlqServerFn = createServerFn({ method: "GET" })
  .inputValidator(adminHealthListInputSchema)
  .handler(async ({ data }) => {
    const search = new URLSearchParams();
    if (typeof data.limit === "number") {
      search.set("limit", String(data.limit));
    }
    const payload = unwrapApiResult(
      (await getJson<Record<string, NonNullable<unknown>>>(
        `/api/health/dlq${search.size > 0 ? `?${search.toString()}` : ""}`,
      )) as ApiResult<Record<string, NonNullable<unknown>>>,
    );
    return parseDlqList(payload);
  });

const adminFeatureFlagsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const payload = unwrapApiResult(
    (await getJson<Record<string, NonNullable<unknown>>>("/api/health/flags")) as ApiResult<
      Record<string, NonNullable<unknown>>
    >,
  );
  return parseFeatureFlags(payload);
});

const adminAuditErrorsServerFn = createServerFn({ method: "GET" })
  .inputValidator(adminHealthListInputSchema)
  .handler(async ({ data }) => {
    const search = new URLSearchParams();
    if (typeof data.limit === "number") {
      search.set("limit", String(data.limit));
    }
    const payload = unwrapApiResult(
      (await getJson<Record<string, NonNullable<unknown>>>(
        `/api/health/audit-errors${search.size > 0 ? `?${search.toString()}` : ""}`,
      )) as ApiResult<Record<string, NonNullable<unknown>>>,
    );
    return parseAuditErrors(payload);
  });

const adminDlqActionServerFn = createServerFn({ method: "POST" })
  .inputValidator(adminDlqActionInputSchema)
  .handler(async ({ data }) => {
    return unwrapApiResult(
      (await postJson<JsonRecord>(
        `/api/health/dlq/${encodeURIComponent(data.id)}/${data.action}`,
        {},
      )) as ApiResult<JsonRecord>,
    );
  });

export const createInvite = async (data: InviteCreateInput): Promise<{ inviteId: string }> =>
  unwrapApiResult(
    (await inviteCreateServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<{ inviteId: string }>,
  );

export const acceptInvite = async (data: InviteAcceptInput): Promise<{ orgName?: string }> =>
  unwrapApiResult(
    (await inviteAcceptServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<{ orgName?: string }>,
  );

export const startBillingCheckout = async (
  data: BillingCheckoutInput,
): Promise<{ checkout_url?: string; url?: string } | null> =>
  unwrapApiResult(
    (await billingCheckoutServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<{
      checkout_url?: string;
      url?: string;
    } | null>,
  );

export const openBillingPortal = async (
  data: BillingPortalInput,
): Promise<{ portal_url?: string; url?: string } | null> =>
  unwrapApiResult(
    (await billingPortalServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<{
      portal_url?: string;
      url?: string;
    } | null>,
  );

export const startBillingCreditsCheckout = async (
  data: BillingCreditsCheckoutInput,
): Promise<{ checkout_url?: string } | null> =>
  unwrapApiResult(
    (await billingCreditsCheckoutServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<{ checkout_url?: string } | null>,
  );

export const startBillingAutomationRunCheckout = async (
  data: BillingAutomationRunCheckoutInput,
): Promise<{ checkout_url?: string } | null> =>
  unwrapApiResult(
    (await billingAutomationRunCheckoutServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<{ checkout_url?: string } | null>,
  );

export const changeBillingSubscription = async (
  data: BillingSubscriptionChangeInput,
): Promise<JsonRecord> =>
  unwrapApiResult((await billingSubscriptionChangeServerFn({ data })) as ApiResult<JsonRecord>);

export const undoBillingCancelAtPeriodEnd = async (
  data: BillingSubscriptionUndoCancelInput,
): Promise<JsonRecord> =>
  unwrapApiResult((await billingSubscriptionUndoCancelServerFn({ data })) as ApiResult<JsonRecord>);

export const getBillingSubscriptionPending = async (
  data: BillingSubscriptionPendingInput,
): Promise<JsonRecord> =>
  unwrapApiResult((await billingSubscriptionPendingServerFn({ data })) as ApiResult<JsonRecord>);

export const generateAutomationPrompt = async (
  data: AutomationPromptInput,
): Promise<JsonRecord> => {
  const mock = await resolveE2EServerFnMock<JsonRecord>("generateAutomationPrompt", data);
  if (mock !== NO_E2E_SERVER_FN_MOCK) {
    return mock;
  }
  return unwrapApiResult(
    (await generateAutomationPromptServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<JsonRecord>,
  );
};

export const generateAutomationQuestions = async (
  data: AutomationQuestionsInput,
): Promise<JsonRecord> => {
  const mock = await resolveE2EServerFnMock<JsonRecord>("generateAutomationQuestions", data);
  if (mock !== NO_E2E_SERVER_FN_MOCK) {
    return mock;
  }
  return unwrapApiResult(
    (await generateAutomationQuestionsServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<JsonRecord>,
  );
};

export const getOpenAiHelperSession = async (data: OpenAiHelperSessionInput): Promise<JsonRecord> =>
  unwrapApiResult(
    (await openAiHelperSessionServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<JsonRecord>,
  );

export const completeOpenAiOauth = async (data: CompleteOpenAiOauthInput): Promise<JsonRecord> =>
  unwrapApiResult(
    (await completeOpenAiOauthServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<JsonRecord>,
  );

export const testWorkspaceMcp = async (
  data: WorkspaceMcpTestInput,
): Promise<{ ok?: boolean; error?: string; message?: string } | null> =>
  unwrapApiResult(
    (await workspaceMcpTestServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<{
      ok?: boolean;
      error?: string;
      message?: string;
    } | null>,
  );

export const requestOAuthProviderConnect = async (
  data: OAuthProviderConnectInput,
): Promise<OAuthConnectResponse> =>
  parseOAuthConnectResponse(
    unwrapApiResult(
      (await oauthProviderConnectServerFn({
        data: {
          ...data,
          betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
        },
      })) as ApiResult<JsonRecord>,
    ),
  );

export const subscribePushNotifications = async (
  data: PushSubscribeInput,
): Promise<{ endpointId?: string }> =>
  unwrapApiResult(
    (await pushSubscribeServerFn({
      data: {
        ...data,
        betterAuthCookie: normalizeOptionalBetterAuthCookie(data.betterAuthCookie),
      },
    })) as ApiResult<{ endpointId?: string }>,
  );

export const getAdminDeepHealth = async (): Promise<DeepHealthResponse> =>
  (await adminDeepHealthServerFn()) as DeepHealthResponse;

export const getAdminHealthDlq = async (data: AdminHealthListInput): Promise<DlqListResponse> =>
  (await adminHealthDlqServerFn({ data })) as DlqListResponse;

export const getAdminFeatureFlags = async (): Promise<FeatureFlagListResponse> =>
  (await adminFeatureFlagsServerFn()) as FeatureFlagListResponse;

export const getAdminAuditErrors = async (
  data: AdminHealthListInput,
): Promise<AuditErrorListResponse> =>
  (await adminAuditErrorsServerFn({ data })) as AuditErrorListResponse;

export const runAdminDlqAction = async (data: AdminDlqActionInput): Promise<JsonRecord> =>
  (await adminDlqActionServerFn({ data })) as JsonRecord;
