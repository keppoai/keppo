import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
  type Triggers,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { buildMagicLinkTemplate, sendMailgunEmail } from "@keppo/shared/email";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import type { BetterAuthOptions } from "better-auth/minimal";
import { magicLink, organization } from "better-auth/plugins";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { DataModel } from "./_generated/dataModel";
import { isDisposableEmail, normalizeEmailDomain } from "./disposable_emails";
import { isKeppoToken, validateTokenEntropy } from "./credential_utils";
import {
  ABUSE_FLAG_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  CREDENTIAL_TYPE,
  DEFAULT_ACTION_BEHAVIOR,
  POLICY_MODE,
  USER_ROLE,
  WORKSPACE_STATUS,
} from "./domain_constants";
import { nowIso } from "./_auth";
import { components } from "./_generated/api";
import { internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { roleValidator } from "./validators";
import authConfig from "./auth.config";
import { authAccessControl, authAccessControlRoles } from "./betterAuth/access_control";
import betterAuthSchema from "./betterAuth/schema";
import { slugifyWorkspaceName } from "./workspaces_shared";
import { subscriptionIdForOrg } from "./billing/shared";
import { SUBSCRIPTION_STATUS, SUBSCRIPTION_TIER } from "./domain_constants";
import { getDefaultBillingPeriod } from "../packages/shared/src/subscriptions.js";

type AuthCtx = GenericCtx<DataModel>;
type AuthMutationCtx = MutationCtx;
const DEFAULT_MAILGUN_FROM_EMAIL = "notifications@keppo.ai";
const SECURITY_SYSTEM_ORG_ID = "system";
const CONVEX_ANALYSIS_SECRET = "convex-analysis-placeholder-secret-0123456789";
const CONVEX_ANALYSIS_TRUSTED_ORIGIN = "https://convex-analysis.invalid";
const LOCAL_TRUSTED_ORIGIN = "http://localhost:3000";

const toHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const randomId = (prefix: string): string =>
  `${prefix}_${toHex(crypto.getRandomValues(new Uint8Array(8)))}`;

const buildWorkspaceCredentialSecret = (): string => {
  const token = `keppo_${randomId("secret")}_${randomId("secret")}`;
  if (!isKeppoToken(token) || !validateTokenEntropy(token)) {
    throw new Error("Generated workspace credential failed entropy validation");
  }
  return token;
};

const isTruthyEnvFlag = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const resolveBetterAuthSecret = (options?: { allowAnalysisPlaceholder?: boolean }): string => {
  const value = process.env.BETTER_AUTH_SECRET?.trim();
  if (value) {
    return value;
  }
  if (options?.allowAnalysisPlaceholder) {
    // `authComponent.registerRoutes()` evaluates auth options during Convex analysis before runtime env exists.
    return CONVEX_ANALYSIS_SECRET;
  }
  throw new Error("Missing BETTER_AUTH_SECRET.");
};

const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const toMagicLinkLogMetadata = async (params: {
  email: string;
  url: string;
}): Promise<{
  correlationId: string;
  emailRef: string;
  emailDomain: string | null;
  magicLinkRef: string;
}> => {
  const normalizedEmail = params.email.trim().toLowerCase();
  return {
    correlationId: randomId("mlog"),
    emailRef: (await sha256Hex(normalizedEmail)).slice(0, 12),
    emailDomain: normalizeEmailDomain(params.email),
    magicLinkRef: (await sha256Hex(params.url)).slice(0, 12),
  };
};

const parseAllowedEmailDomains = (): Set<string> => {
  return new Set(
    (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
};

const hasMutationDb = (ctx: AuthCtx): ctx is AuthMutationCtx => "db" in ctx && "scheduler" in ctx;

const getOrgPrimaryEmailDomain = async (ctx: AuthCtx, orgId: string): Promise<string | null> => {
  const members = await ctx.runQuery(components.betterAuth.queries.listOrgMembers, { orgId });
  const member = members.find((entry) => entry.role === USER_ROLE.owner) ?? members[0];
  if (!member?.userId) {
    return null;
  }

  const user = await ctx.runQuery(components.betterAuth.queries.getUserById, {
    userId: member.userId,
  });
  if (!user?.email) {
    return null;
  }

  return normalizeEmailDomain(String(user.email));
};

const maybeCreateAbuseFlag = async (
  ctx: AuthMutationCtx,
  params: {
    orgId: string;
    flagType: string;
    severity: "low" | "medium" | "high";
    details: Record<string, unknown>;
  },
): Promise<void> => {
  const detailsJson = JSON.stringify(params.details);
  const existing = await ctx.db
    .query("abuse_flags")
    .withIndex("by_org", (q) => q.eq("org_id", params.orgId))
    .collect();
  const duplicate = existing.find(
    (entry) =>
      entry.status === ABUSE_FLAG_STATUS.open &&
      entry.flag_type === params.flagType &&
      entry.details === detailsJson,
  );
  if (duplicate) {
    return;
  }

  const createdAt = nowIso();
  const flagId = randomId("aflag");
  await ctx.db.insert("abuse_flags", {
    id: flagId,
    org_id: params.orgId,
    flag_type: params.flagType,
    severity: params.severity,
    details: detailsJson,
    status: ABUSE_FLAG_STATUS.open,
    reviewed_by: null,
    reviewed_at: null,
    created_at: createdAt,
  });

  await ctx.db.insert("audit_events", {
    id: randomId("audit"),
    org_id: params.orgId,
    actor_type: AUDIT_ACTOR_TYPE.system,
    actor_id: "auth",
    event_type: AUDIT_EVENT_TYPES.securityAbuseFlagged,
    payload: {
      flag_id: flagId,
      flag_type: params.flagType,
      severity: params.severity,
      details: params.details,
    },
    created_at: createdAt,
  });
};

const recordSignupVelocitySignals = async (ctx: AuthMutationCtx, orgId: string): Promise<void> => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentWorkspaces = await ctx.db
    .query("workspaces")
    .withIndex("by_created_at", (q) => q.gte("created_at", oneHourAgo))
    .collect();

  const recentByOrg = new Map<string, string>();
  for (const workspace of recentWorkspaces) {
    const existing = recentByOrg.get(workspace.org_id);
    if (!existing || workspace.created_at < existing) {
      recentByOrg.set(workspace.org_id, workspace.created_at);
    }
  }

  const globalOrgCount = recentByOrg.size;
  if (globalOrgCount > 20) {
    await ctx.db.insert("audit_events", {
      id: randomId("audit"),
      org_id: orgId,
      actor_type: AUDIT_ACTOR_TYPE.system,
      actor_id: "auth",
      event_type: AUDIT_EVENT_TYPES.securitySignupVelocityWarning,
      payload: {
        scope: "global",
        count: globalOrgCount,
        threshold: 20,
      },
      created_at: nowIso(),
    });

    await maybeCreateAbuseFlag(ctx, {
      orgId,
      flagType: "velocity_anomaly",
      severity: "high",
      details: {
        scope: "global",
        count: globalOrgCount,
        threshold: 20,
      },
    });
  }

  const currentDomain = await getOrgPrimaryEmailDomain(ctx, orgId);
  if (!currentDomain) {
    return;
  }

  let matchingDomainCount = 0;
  for (const recentOrgId of recentByOrg.keys()) {
    const domain = await getOrgPrimaryEmailDomain(ctx, recentOrgId);
    if (domain === currentDomain) {
      matchingDomainCount += 1;
    }
  }

  if (matchingDomainCount > 5) {
    await ctx.db.insert("audit_events", {
      id: randomId("audit"),
      org_id: orgId,
      actor_type: AUDIT_ACTOR_TYPE.system,
      actor_id: "auth",
      event_type: AUDIT_EVENT_TYPES.securitySignupVelocityWarning,
      payload: {
        scope: "domain",
        domain: currentDomain,
        count: matchingDomainCount,
        threshold: 5,
      },
      created_at: nowIso(),
    });

    await maybeCreateAbuseFlag(ctx, {
      orgId,
      flagType: "velocity_anomaly",
      severity: "medium",
      details: {
        scope: "domain",
        domain: currentDomain,
        count: matchingDomainCount,
        threshold: 5,
      },
    });
  }
};

const recordDisposableBlock = async (
  ctx: AuthCtx,
  params: { email: string; domain: string; route: string },
): Promise<void> => {
  if (!hasMutationDb(ctx)) {
    return;
  }
  await ctx.db.insert("audit_events", {
    id: randomId("audit"),
    org_id: SECURITY_SYSTEM_ORG_ID,
    actor_type: AUDIT_ACTOR_TYPE.system,
    actor_id: "auth",
    event_type: AUDIT_EVENT_TYPES.authSignupBlocked,
    payload: {
      reason: "disposable_email",
      email: params.email,
      domain: params.domain,
      route: params.route,
    },
    created_at: nowIso(),
  });
};

const buildSocialProviders = (): BetterAuthOptions["socialProviders"] | undefined => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

  const providers: Record<string, { clientId: string; clientSecret: string }> = {};

  if (googleClientId && googleClientSecret) {
    providers.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    };
  }
  if (githubClientId && githubClientSecret) {
    providers.github = {
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    };
  }

  return Object.keys(providers).length > 0 ? providers : undefined;
};

const createDefaultWorkspaceForOrg = async (ctx: AuthMutationCtx, orgId: string): Promise<void> => {
  const existingWorkspace = await ctx.db
    .query("workspaces")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .first();
  if (existingWorkspace) {
    return;
  }

  const workspaceId = randomId("workspace");
  const createdAt = nowIso();
  const period = getDefaultBillingPeriod(new Date());
  const subscriptionId = await subscriptionIdForOrg(orgId);

  await ctx.db.insert("workspaces", {
    id: workspaceId,
    org_id: orgId,
    slug: slugifyWorkspaceName("Default Workspace"),
    name: "Default Workspace",
    status: WORKSPACE_STATUS.active,
    policy_mode: POLICY_MODE.manualOnly,
    default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    code_mode_enabled: true,
    created_at: createdAt,
  });

  const existingSubscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_custom_id", (q) => q.eq("id", subscriptionId))
    .first();
  if (!existingSubscription) {
    await ctx.db.insert("subscriptions", {
      id: subscriptionId,
      org_id: orgId,
      tier: SUBSCRIPTION_TIER.free,
      status: SUBSCRIPTION_STATUS.active,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      workspace_count: 1,
      current_period_start: period.periodStart,
      current_period_end: period.periodEnd,
      created_at: createdAt,
      updated_at: createdAt,
    });
  }

  await ctx.db.insert("workspace_credentials", {
    id: randomId("hcred"),
    workspace_id: workspaceId,
    type: CREDENTIAL_TYPE.bearerToken,
    hashed_secret: await sha256Hex(buildWorkspaceCredentialSecret()),
    last_used_at: null,
    revoked_at: null,
    created_at: createdAt,
  });

  await ctx.db.insert("audit_events", {
    id: randomId("audit"),
    org_id: orgId,
    actor_type: AUDIT_ACTOR_TYPE.system,
    actor_id: "system",
    event_type: AUDIT_EVENT_TYPES.workspaceCreated,
    payload: {
      workspace_id: workspaceId,
      name: "Default Workspace",
    },
    created_at: createdAt,
  });
};

const triggers = {
  organization: {
    onCreate: async (ctx: AuthMutationCtx, org: { _id: string }) => {
      const existingRetention = await ctx.db
        .query("retention_policies")
        .withIndex("by_org", (q) => q.eq("org_id", org._id))
        .first();
      if (!existingRetention) {
        await ctx.db.insert("retention_policies", {
          id: randomId("ret"),
          org_id: org._id,
          raw_tool_io_retention_days: null,
          action_payload_retention_days: 30,
          audit_retention_days: null,
          updated_by: "system",
          updated_at: nowIso(),
        });
      }
      await createDefaultWorkspaceForOrg(ctx, org._id);
      await recordSignupVelocitySignals(ctx, org._id);
    },
  },
} satisfies Triggers<DataModel, typeof betterAuthSchema>;

// BetterAuth trigger wiring uses string refs to avoid TS7022 recursive inference with createClient.

const authFunctions: Required<AuthFunctions> = {
  onCreate: makeFunctionReference<"mutation", Record<string, unknown>>(
    "auth:onCreate",
  ) as unknown as NonNullable<AuthFunctions["onCreate"]>,
  onUpdate: makeFunctionReference<"mutation", Record<string, unknown>>(
    "auth:onUpdate",
  ) as unknown as NonNullable<AuthFunctions["onUpdate"]>,
  onDelete: makeFunctionReference<"mutation", Record<string, unknown>>(
    "auth:onDelete",
  ) as unknown as NonNullable<AuthFunctions["onDelete"]>,
};

export const authComponent = createClient<DataModel, typeof betterAuthSchema>(
  components.betterAuth,
  {
    local: { schema: betterAuthSchema },
    triggers,
    authFunctions,
  },
);

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();
export const { getAuthUser } = authComponent.clientApi();

const TRUSTED_ORIGIN_ENV = "BETTER_AUTH_TRUSTED_ORIGINS";
const LOOPBACK_TRUSTED_ORIGINS = [
  "http://127.0.0.1:*",
  "http://localhost:*",
  "https://127.0.0.1:*",
  "https://localhost:*",
] as const;

const parseTrustedOriginsFromEnv = (): string[] => {
  return (process.env[TRUSTED_ORIGIN_ENV] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
};

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const isLoopbackOrigin = (origin: string): boolean => {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(origin);
};

const hasLocalAuthRuntimeSignal = (env: NodeJS.ProcessEnv): boolean => {
  const deployment = env.CONVEX_DEPLOYMENT?.trim().toLowerCase();
  if (deployment?.startsWith("local:") || deployment?.startsWith("anonymous:")) {
    return true;
  }

  if (env.NODE_ENV === "development" || env.NODE_ENV === "test" || env.KEPPO_E2E_MODE === "true") {
    return true;
  }

  const loopbackCandidates = [
    env.KEPPO_URL,
    env.CONVEX_SITE_URL,
    env.CONVEX_CLOUD_URL,
    env.CONVEX_URL,
    env.CONVEX_SELF_HOSTED_URL,
  ];
  return loopbackCandidates.some((value) => {
    const normalized = value?.trim();
    return normalized ? isLoopbackOrigin(normalized) : false;
  });
};

export const resolveTrustedOriginForRuntime = (
  env: NodeJS.ProcessEnv = process.env,
  options?: { allowAnalysisPlaceholder?: boolean },
): string => {
  const configuredOrigin = env.KEPPO_URL?.trim();
  if (configuredOrigin) {
    return configuredOrigin;
  }
  if (hasLocalAuthRuntimeSignal(env)) {
    return LOCAL_TRUSTED_ORIGIN;
  }
  if (options?.allowAnalysisPlaceholder) {
    // `authComponent.registerRoutes()` evaluates auth options during Convex analysis before runtime env exists.
    return CONVEX_ANALYSIS_TRUSTED_ORIGIN;
  }
  throw new Error("Missing KEPPO_URL. Set KEPPO_URL for non-local Better Auth deployments.");
};

const getTrustedOriginsForRequest = (trustedOrigin: string, request?: Request): string[] => {
  const origins = new Set<string>([
    trustedOrigin,
    ...LOOPBACK_TRUSTED_ORIGINS,
    ...parseTrustedOriginsFromEnv(),
  ]);
  if (!request) {
    return [...origins];
  }

  const candidateHeaders = [request.headers.get("origin"), request.headers.get("referer")];
  for (const candidate of candidateHeaders) {
    if (!candidate) {
      continue;
    }
    const normalized = normalizeOrigin(candidate);
    if (normalized && isLoopbackOrigin(normalized)) {
      origins.add(normalized);
    }
  }

  return [...origins];
};

export const createAuth = (ctx: AuthCtx): ReturnType<typeof betterAuth> => {
  const allowAnalysisPlaceholder = !("runQuery" in ctx);
  const trustedOrigin = resolveTrustedOriginForRuntime(process.env, {
    allowAnalysisPlaceholder,
  });
  const socialProviders = buildSocialProviders();
  const allowedEmailDomains = parseAllowedEmailDomains();
  const emailPasswordEnabled =
    isTruthyEnvFlag(process.env.ENABLE_EMAIL_PASSWORD) || isLoopbackOrigin(trustedOrigin);
  return betterAuth({
    database: authComponent.adapter(ctx),
    baseURL: trustedOrigin,
    trustedOrigins: (request) => getTrustedOriginsForRequest(trustedOrigin, request),
    secret: resolveBetterAuthSecret({ allowAnalysisPlaceholder: true }),
    rateLimit: {
      storage: "database",
    },
    ...(emailPasswordEnabled
      ? {
          emailAndPassword: {
            enabled: true,
            requireEmailVerification: false,
          },
        }
      : {}),
    hooks: {
      before: createAuthMiddleware(async (hookContext) => {
        if (hookContext.path !== "/sign-up/email") {
          return;
        }

        const email = typeof hookContext.body?.email === "string" ? hookContext.body.email : "";
        const domain = normalizeEmailDomain(email);
        if (!domain) {
          return;
        }
        if (!isDisposableEmail(email, { allowDomains: allowedEmailDomains })) {
          return;
        }

        await recordDisposableBlock(ctx, {
          email,
          domain,
          route: hookContext.path,
        });
        throw new APIError("BAD_REQUEST", {
          message: "Disposable email domains are not allowed.",
        });
      }),
    },
    ...(socialProviders ? { socialProviders } : {}),
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          const logMetadata = await toMagicLinkLogMetadata({ email, url });
          const domain = normalizeEmailDomain(email);
          if (domain && isDisposableEmail(email, { allowDomains: allowedEmailDomains })) {
            await recordDisposableBlock(ctx, {
              email,
              domain,
              route: "magic_link",
            });
            throw new Error("Disposable email domains are not allowed.");
          }

          const apiKey = process.env.MAILGUN_API_KEY;
          const mailgunDomain = process.env.MAILGUN_DOMAIN;
          const from = process.env.MAILGUN_FROM_EMAIL?.trim() || DEFAULT_MAILGUN_FROM_EMAIL;

          if (!apiKey?.trim() || !mailgunDomain?.trim()) {
            console.log("Magic link email delivery skipped; Mailgun is not configured.", {
              correlation_id: logMetadata.correlationId,
              email_ref: logMetadata.emailRef,
              email_domain: logMetadata.emailDomain,
              delivery: "mailgun_not_configured",
              magic_link_ref: logMetadata.magicLinkRef,
            });
            return;
          }

          const template = buildMagicLinkTemplate(email, url);
          const result = await sendMailgunEmail({
            apiKey,
            domain: mailgunDomain,
            from,
            to: email,
            subject: template.subject,
            html: template.html,
            text: template.text,
          });

          console.log("Magic link Mailgun delivery result", {
            correlation_id: logMetadata.correlationId,
            email_ref: logMetadata.emailRef,
            email_domain: logMetadata.emailDomain,
            success: result.success,
            error: result.error,
            retryable: result.retryable,
            magic_link_ref: logMetadata.magicLinkRef,
          });

          if (!result.success) {
            console.log("Magic link Mailgun delivery failed.", {
              correlation_id: logMetadata.correlationId,
              email_ref: logMetadata.emailRef,
              email_domain: logMetadata.emailDomain,
              delivery: "mailgun_failed",
              magic_link_ref: logMetadata.magicLinkRef,
            });
          }
        },
      }),
      organization({
        ac: authAccessControl as NonNullable<Parameters<typeof organization>[0]>["ac"],
        roles: authAccessControlRoles,
        creatorRole: USER_ROLE.owner,
      }),
      convex({
        authConfig,
        jwt: {
          definePayload: ({ session }) =>
            typeof session?.session?.activeOrganizationId === "string" &&
            session.session.activeOrganizationId.length > 0
              ? { activeOrganizationId: session.session.activeOrganizationId }
              : {},
        },
      }),
    ],
  });
};

export const resolveApiSessionFromToken = internalQuery({
  args: {
    sessionToken: v.string(),
  },
  returns: v.union(
    v.object({
      userId: v.string(),
      orgId: v.string(),
      role: roleValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const token = args.sessionToken.trim();
    if (!token) {
      return null;
    }

    const session = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "session",
      where: [{ field: "token", value: token }],
    })) as {
      userId: string;
      expiresAt: number;
      activeOrganizationId?: string | null;
    } | null;
    if (!session) {
      return null;
    }
    if (typeof session.expiresAt === "number" && session.expiresAt <= Date.now()) {
      return null;
    }

    let orgId =
      typeof session.activeOrganizationId === "string" ? session.activeOrganizationId.trim() : "";
    if (!orgId) {
      const memberships = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "member",
        where: [{ field: "userId", value: session.userId }],
        paginationOpts: {
          numItems: 20,
          cursor: null,
        },
      })) as { page: Array<{ organizationId: string }>; isDone: boolean };
      const fallbackOrgId = memberships.page[0]?.organizationId;
      orgId = typeof fallbackOrgId === "string" ? fallbackOrgId.trim() : "";
    }
    if (!orgId) {
      return null;
    }

    const member = await ctx.runQuery(components.betterAuth.queries.getMemberByOrgAndUser, {
      orgId,
      userId: session.userId,
    });
    if (!member) {
      return null;
    }
    let role: (typeof USER_ROLE)[keyof typeof USER_ROLE];
    if (member.role === USER_ROLE.owner) {
      role = USER_ROLE.owner;
    } else if (member.role === USER_ROLE.admin) {
      role = USER_ROLE.admin;
    } else if (member.role === USER_ROLE.approver) {
      role = USER_ROLE.approver;
    } else if (member.role === USER_ROLE.viewer) {
      role = USER_ROLE.viewer;
    } else {
      return null;
    }

    return {
      userId: session.userId,
      orgId,
      role,
    };
  },
});

export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      id: v.string(),
      email: v.string(),
      name: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx: QueryCtx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      return null;
    }
    return {
      id: user._id,
      email: user.email,
      name: user.name,
    };
  },
});
