import { z } from "zod";
export {
  BILLING_SOURCE,
  calculatePromoExpiry,
  chooseLatestRedemption,
  isActiveStripeSubscriptionStatus,
  isPaidInviteGrantTier,
  resolveInviteGrantTier,
  type BillingSource,
} from "./contracts/billing.js";

const nonEmptyStringSchema = z.string().trim().min(1);
const optionalNonEmptyStringSchema = nonEmptyStringSchema.optional();
const optionalEmailSchema = z.email().optional();

export const billingPlanTierSchema = z.enum(["free", "starter", "pro"]);
export const billingPaidTierSchema = z.enum(["starter", "pro"]);

export const billingCheckoutRequestSchema = z.object({
  orgId: nonEmptyStringSchema,
  tier: billingPaidTierSchema,
  successUrl: optionalNonEmptyStringSchema,
  cancelUrl: optionalNonEmptyStringSchema,
  customerEmail: optionalEmailSchema,
});

export const billingPortalRequestSchema = z.object({
  orgId: nonEmptyStringSchema,
  returnUrl: optionalNonEmptyStringSchema,
});

export const billingCreditsCheckoutRequestSchema = z.object({
  orgId: nonEmptyStringSchema,
  packageIndex: z.number().int().min(0),
  customerEmail: optionalEmailSchema,
  successUrl: optionalNonEmptyStringSchema,
  cancelUrl: optionalNonEmptyStringSchema,
});

export const billingAutomationRunCheckoutRequestSchema = billingCreditsCheckoutRequestSchema;

export const billingSubscriptionAddressSchema = z.object({
  line1: z.string().trim().min(1).max(256),
  line2: z.string().trim().max(256).optional(),
  city: z.string().trim().max(256).optional(),
  state: z.string().trim().max(256).optional(),
  postalCode: z.string().trim().min(1).max(32),
  country: z.string().trim().length(2),
});

export const billingSubscriptionDetailsSchema = z.object({
  name: z.string().trim().min(1).max(256),
  companyName: z.string().trim().max(256).optional(),
  address: billingSubscriptionAddressSchema,
});

export const billingSubscriptionChangeRequestSchema = z
  .object({
    orgId: nonEmptyStringSchema,
    targetTier: billingPlanTierSchema.optional(),
    billing: billingSubscriptionDetailsSchema.optional(),
    undoCancelAtPeriodEnd: z.literal(true).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.undoCancelAtPeriodEnd) {
      return;
    }
    if (!value.targetTier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetTier"],
        message: "targetTier is required unless undoCancelAtPeriodEnd is true.",
      });
      return;
    }
    if (value.targetTier !== "free" && !value.billing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["billing"],
        message: "billing is required unless targetTier is free.",
      });
    }
  });

export const billingSubscriptionPendingRequestSchema = z.object({
  orgId: nonEmptyStringSchema,
});

const billingRedirectPayloadSourceSchema = z
  .object({
    url: optionalNonEmptyStringSchema,
    checkout_url: optionalNonEmptyStringSchema,
    portal_url: optionalNonEmptyStringSchema,
    session_id: optionalNonEmptyStringSchema,
    sessionId: optionalNonEmptyStringSchema,
  })
  .refine((value) => Boolean(value.url ?? value.checkout_url ?? value.portal_url), {
    message: "Billing redirect responses must include a URL.",
  });

export const billingRedirectResponseSchema = billingRedirectPayloadSourceSchema.transform(
  (value) => ({
    url: value.url ?? value.checkout_url ?? value.portal_url ?? "",
    sessionId: value.sessionId ?? value.session_id ?? null,
  }),
);

const optionalIsoDateSchema = z.string().trim().min(1).nullable();

const billingPendingChangeResponseSourceSchema = z.object({
  cancel_at_period_end: z.boolean().optional(),
  pending_tier: billingPlanTierSchema.nullable().optional(),
  pending_effective_at: optionalIsoDateSchema.optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  pendingTier: billingPlanTierSchema.nullable().optional(),
  pendingEffectiveAt: optionalIsoDateSchema.optional(),
});

export const billingPendingChangeResponseSchema =
  billingPendingChangeResponseSourceSchema.transform((value) => ({
    cancelAtPeriodEnd: value.cancelAtPeriodEnd ?? value.cancel_at_period_end ?? false,
    pendingTier: value.pendingTier ?? value.pending_tier ?? null,
    pendingEffectiveAt: value.pendingEffectiveAt ?? value.pending_effective_at ?? null,
  }));

const billingSubscriptionMutationResponseSourceSchema = z.object({
  ok: z.boolean().optional(),
  upgrade: z.boolean().optional(),
  downgrade_scheduled: z.boolean().optional(),
  downgradeScheduled: z.boolean().optional(),
  cancel_at_period_end: z.boolean().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  undo_cancel_at_period_end: z.boolean().optional(),
  undoCancelAtPeriodEnd: z.boolean().optional(),
  effective_at: optionalIsoDateSchema.optional(),
  effectiveAt: optionalIsoDateSchema.optional(),
  pending_tier: billingPlanTierSchema.nullable().optional(),
  pendingTier: billingPlanTierSchema.nullable().optional(),
});

export const billingSubscriptionMutationResponseSchema =
  billingSubscriptionMutationResponseSourceSchema.transform((value) => ({
    ok: value.ok ?? false,
    upgrade: value.upgrade ?? false,
    downgradeScheduled: value.downgradeScheduled ?? value.downgrade_scheduled ?? false,
    cancelAtPeriodEnd: value.cancelAtPeriodEnd ?? value.cancel_at_period_end ?? false,
    undoCancelAtPeriodEnd: value.undoCancelAtPeriodEnd ?? value.undo_cancel_at_period_end ?? false,
    effectiveAt: value.effectiveAt ?? value.effective_at ?? null,
    pendingTier: value.pendingTier ?? value.pending_tier ?? null,
  }));

export type BillingPlanTier = z.infer<typeof billingPlanTierSchema>;
export type BillingPaidTier = z.infer<typeof billingPaidTierSchema>;
export type BillingCheckoutRequest = z.infer<typeof billingCheckoutRequestSchema>;
export type BillingPortalRequest = z.infer<typeof billingPortalRequestSchema>;
export type BillingCreditsCheckoutRequest = z.infer<typeof billingCreditsCheckoutRequestSchema>;
export type BillingAutomationRunCheckoutRequest = z.infer<
  typeof billingAutomationRunCheckoutRequestSchema
>;
export type BillingSubscriptionDetails = z.infer<typeof billingSubscriptionDetailsSchema>;
export type BillingSubscriptionChangeRequest = z.infer<
  typeof billingSubscriptionChangeRequestSchema
>;
export type BillingSubscriptionPendingRequest = z.infer<
  typeof billingSubscriptionPendingRequestSchema
>;
export type BillingRedirectResponse = z.infer<typeof billingRedirectResponseSchema>;
export type BillingPendingChangeResponse = z.infer<typeof billingPendingChangeResponseSchema>;
export type BillingSubscriptionMutationResponse = z.infer<
  typeof billingSubscriptionMutationResponseSchema
>;
