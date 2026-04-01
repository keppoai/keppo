import { buildProviderIdempotencyKey } from "../../../provider-write-utils.js";
import { redactByPolicy, stripeTools, toolMap } from "../../../tool-definitions.js";
import type { Connector, ConnectorContext, PreparedWrite } from "../../../connectors/base.js";
import { BaseConnector } from "../../../connectors/base-connector.js";
import { createRealStripeSdk } from "../../../provider-sdk/stripe/real.js";
import type { StripeSdkPort } from "../../../provider-sdk/stripe/types.js";
import { resolveNamespaceFromContext } from "../_shared/connector_helpers.js";
import {
  createProviderCircuitBreaker,
  wrapObjectWithCircuitBreaker,
} from "../../../circuit-breaker.js";

const requiredScopesByTool: Record<string, string[]> = {
  "stripe.lookupCustomer": ["stripe.read"],
  "stripe.listSubscriptions": ["stripe.read"],
  "stripe.listCharges": ["stripe.read"],
  "stripe.invoiceHistory": ["stripe.read"],
  "stripe.searchCustomers": ["stripe.read"],
  "stripe.getSubscription": ["stripe.read"],
  "stripe.getInvoice": ["stripe.read"],
  "stripe.previewInvoice": ["stripe.read"],
  "stripe.listPaymentMethods": ["stripe.read"],
  "stripe.getRefund": ["stripe.read"],
  "stripe.listRefunds": ["stripe.read"],
  "stripe.getCharge": ["stripe.read"],
  "stripe.listCreditNotes": ["stripe.read"],
  "stripe.getDispute": ["stripe.read"],
  "stripe.listDisputes": ["stripe.read"],
  "stripe.listBalanceTransactions": ["stripe.read"],
  "stripe.searchCharges": ["stripe.read"],
  "stripe.searchSubscriptions": ["stripe.read"],
  "stripe.searchInvoices": ["stripe.read"],
  "stripe.getPaymentIntent": ["stripe.read"],
  "stripe.listPaymentIntents": ["stripe.read"],
  "stripe.searchPaymentIntents": ["stripe.read"],
  "stripe.getCoupon": ["stripe.read"],
  "stripe.listCoupons": ["stripe.read"],
  "stripe.getPromotionCode": ["stripe.read"],
  "stripe.listPromotionCodes": ["stripe.read"],
  "stripe.getProduct": ["stripe.read"],
  "stripe.listProducts": ["stripe.read"],
  "stripe.getPrice": ["stripe.read"],
  "stripe.listPrices": ["stripe.read"],
  "stripe.getBalanceTransaction": ["stripe.read"],
  "stripe.listGlobalBalanceTransactions": ["stripe.read"],
  "stripe.getCreditNote": ["stripe.read"],
  "stripe.previewCreditNote": ["stripe.read"],
  "stripe.listSubscriptionItems": ["stripe.read"],
  "stripe.getSubscriptionSchedule": ["stripe.read"],
  "stripe.listSubscriptionSchedules": ["stripe.read"],
  "stripe.listCustomerTaxIds": ["stripe.read"],
  "stripe.getCheckoutSession": ["stripe.read"],
  "stripe.listEvents": ["stripe.read"],
  "stripe.getEvent": ["stripe.read"],
  "stripe.issueRefund": ["stripe.write"],
  "stripe.cancelSubscription": ["stripe.write"],
  "stripe.adjustBalance": ["stripe.write"],
  "stripe.updateCustomer": ["stripe.write"],
  "stripe.updateSubscription": ["stripe.write"],
  "stripe.resumeSubscription": ["stripe.write"],
  "stripe.sendInvoice": ["stripe.write"],
  "stripe.voidInvoice": ["stripe.write"],
  "stripe.payInvoice": ["stripe.write"],
  "stripe.createCreditNote": ["stripe.write"],
  "stripe.updateDispute": ["stripe.write"],
  "stripe.closeDispute": ["stripe.write"],
  "stripe.createPortalSession": ["stripe.write"],
  "stripe.detachPaymentMethod": ["stripe.write"],
  "stripe.cancelRefund": ["stripe.write"],
  "stripe.createInvoiceItem": ["stripe.write"],
  "stripe.deleteInvoiceItem": ["stripe.write"],
  "stripe.finalizeInvoice": ["stripe.write"],
  "stripe.markUncollectible": ["stripe.write"],
  "stripe.updateRefund": ["stripe.write"],
  "stripe.voidCreditNote": ["stripe.write"],
  "stripe.createSubscriptionItem": ["stripe.write"],
  "stripe.updateSubscriptionItem": ["stripe.write"],
  "stripe.deleteSubscriptionItem": ["stripe.write"],
  "stripe.updateSubscriptionSchedule": ["stripe.write"],
  "stripe.cancelSubscriptionSchedule": ["stripe.write"],
  "stripe.createCustomerTaxId": ["stripe.write"],
  "stripe.deleteCustomerTaxId": ["stripe.write"],
  "stripe.createCoupon": ["stripe.write"],
  "stripe.createPromotionCode": ["stripe.write"],
  "stripe.createCheckoutSession": ["stripe.write"],
  "stripe.createSetupIntent": ["stripe.write"],
  "stripe.updateCharge": ["stripe.write"],
  "stripe.createInvoice": ["stripe.write"],
  "stripe.createSubscription": ["stripe.write"],
  "stripe.deleteCustomerDiscount": ["stripe.write"],
  "stripe.deleteSubscriptionDiscount": ["stripe.write"],
};

type StripeWriteMode =
  | "refund"
  | "cancel_subscription"
  | "adjust_balance"
  | "update_customer"
  | "update_subscription"
  | "resume_subscription"
  | "invoice_actions"
  | "credit_notes"
  | "disputes"
  | "portal_session"
  | "payment_methods"
  | "invoice_items";

const writeModeByTool: Record<string, StripeWriteMode> = {
  "stripe.issueRefund": "refund",
  "stripe.cancelSubscription": "cancel_subscription",
  "stripe.adjustBalance": "adjust_balance",
  "stripe.updateCustomer": "update_customer",
  "stripe.updateSubscription": "update_subscription",
  "stripe.resumeSubscription": "resume_subscription",
  "stripe.sendInvoice": "invoice_actions",
  "stripe.voidInvoice": "invoice_actions",
  "stripe.payInvoice": "invoice_actions",
  "stripe.createCreditNote": "credit_notes",
  "stripe.updateDispute": "disputes",
  "stripe.closeDispute": "disputes",
  "stripe.createPortalSession": "portal_session",
  "stripe.detachPaymentMethod": "payment_methods",
  "stripe.cancelRefund": "refund",
  "stripe.updateRefund": "refund",
  "stripe.createInvoiceItem": "invoice_items",
  "stripe.deleteInvoiceItem": "invoice_items",
  "stripe.finalizeInvoice": "invoice_actions",
  "stripe.markUncollectible": "invoice_actions",
  "stripe.voidCreditNote": "credit_notes",
  "stripe.createSubscriptionItem": "update_subscription",
  "stripe.updateSubscriptionItem": "update_subscription",
  "stripe.deleteSubscriptionItem": "update_subscription",
  "stripe.updateSubscriptionSchedule": "update_subscription",
  "stripe.cancelSubscriptionSchedule": "update_subscription",
  "stripe.createCustomerTaxId": "update_customer",
  "stripe.deleteCustomerTaxId": "update_customer",
  "stripe.createCoupon": "invoice_actions",
  "stripe.createPromotionCode": "invoice_actions",
  "stripe.createCheckoutSession": "invoice_actions",
  "stripe.createSetupIntent": "invoice_actions",
  "stripe.updateCharge": "invoice_actions",
  "stripe.createInvoice": "invoice_actions",
  "stripe.createSubscription": "update_subscription",
  "stripe.deleteCustomerDiscount": "update_customer",
  "stripe.deleteSubscriptionDiscount": "update_subscription",
};

const FAKE_STRIPE_ACCESS_TOKEN = process.env.KEPPO_FAKE_STRIPE_ACCESS_TOKEN?.trim();

const normalizeWriteModes = (value: unknown): StripeWriteMode[] => {
  const normalized = (
    Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  )
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);

  const supported = new Set<StripeWriteMode>([
    "refund",
    "cancel_subscription",
    "adjust_balance",
    "update_customer",
    "update_subscription",
    "resume_subscription",
    "invoice_actions",
    "credit_notes",
    "disputes",
    "portal_session",
    "payment_methods",
    "invoice_items",
  ]);
  return normalized.filter((entry): entry is StripeWriteMode =>
    supported.has(entry as StripeWriteMode),
  );
};

const enforceWriteMode = (toolName: string, context: ConnectorContext): void => {
  const requiredMode = writeModeByTool[toolName];
  if (!requiredMode) {
    return;
  }

  const rawPolicy = context.metadata?.allowed_write_modes ?? context.metadata?.allowedWriteModes;

  if (rawPolicy === undefined || rawPolicy === null) {
    return;
  }

  const configuredModes = normalizeWriteModes(rawPolicy);

  if (configuredModes.length === 0) {
    throw new Error(
      `Stripe write mode policy blocks ${requiredMode} operations for this integration.`,
    );
  }
  if (!configuredModes.includes(requiredMode)) {
    throw new Error(
      `Stripe write mode policy blocks ${requiredMode} operations for this integration.`,
    );
  }
};

const getToken = (context: ConnectorContext): string => {
  if (context.access_token) {
    return context.access_token;
  }
  if (FAKE_STRIPE_ACCESS_TOKEN) {
    return FAKE_STRIPE_ACCESS_TOKEN;
  }
  throw new Error("Stripe access token missing. Reconnect Stripe integration.");
};

const toOptionalString = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

const toOptionalNumber = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const toOptionalBoolean = (value: unknown): boolean | undefined => {
  return typeof value === "boolean" ? value : undefined;
};

const providerCircuitBreaker = createProviderCircuitBreaker("stripe");

const stripeReadToolNames = [
  "stripe.lookupCustomer",
  "stripe.searchCustomers",
  "stripe.listSubscriptions",
  "stripe.getSubscription",
  "stripe.listCharges",
  "stripe.getCharge",
  "stripe.invoiceHistory",
  "stripe.getInvoice",
  "stripe.previewInvoice",
  "stripe.listPaymentMethods",
  "stripe.getRefund",
  "stripe.listRefunds",
  "stripe.listCreditNotes",
  "stripe.getDispute",
  "stripe.listDisputes",
  "stripe.listBalanceTransactions",
  "stripe.searchCharges",
  "stripe.searchSubscriptions",
  "stripe.searchInvoices",
  "stripe.getPaymentIntent",
  "stripe.listPaymentIntents",
  "stripe.searchPaymentIntents",
  "stripe.getCoupon",
  "stripe.listCoupons",
  "stripe.getPromotionCode",
  "stripe.listPromotionCodes",
  "stripe.getProduct",
  "stripe.listProducts",
  "stripe.getPrice",
  "stripe.listPrices",
  "stripe.getBalanceTransaction",
  "stripe.listGlobalBalanceTransactions",
  "stripe.getCreditNote",
  "stripe.previewCreditNote",
  "stripe.listSubscriptionItems",
  "stripe.getSubscriptionSchedule",
  "stripe.listSubscriptionSchedules",
  "stripe.listCustomerTaxIds",
  "stripe.getCheckoutSession",
  "stripe.listEvents",
  "stripe.getEvent",
] as const;

const stripeWriteToolNames = [
  "stripe.issueRefund",
  "stripe.cancelSubscription",
  "stripe.adjustBalance",
  "stripe.updateCustomer",
  "stripe.updateSubscription",
  "stripe.resumeSubscription",
  "stripe.sendInvoice",
  "stripe.voidInvoice",
  "stripe.payInvoice",
  "stripe.createCreditNote",
  "stripe.updateDispute",
  "stripe.closeDispute",
  "stripe.createPortalSession",
  "stripe.detachPaymentMethod",
  "stripe.cancelRefund",
  "stripe.updateRefund",
  "stripe.createInvoiceItem",
  "stripe.deleteInvoiceItem",
  "stripe.finalizeInvoice",
  "stripe.markUncollectible",
  "stripe.voidCreditNote",
  "stripe.createSubscriptionItem",
  "stripe.updateSubscriptionItem",
  "stripe.deleteSubscriptionItem",
  "stripe.updateSubscriptionSchedule",
  "stripe.cancelSubscriptionSchedule",
  "stripe.createCustomerTaxId",
  "stripe.deleteCustomerTaxId",
  "stripe.createCoupon",
  "stripe.createPromotionCode",
  "stripe.createCheckoutSession",
  "stripe.createSetupIntent",
  "stripe.updateCharge",
  "stripe.createInvoice",
  "stripe.createSubscription",
  "stripe.deleteCustomerDiscount",
  "stripe.deleteSubscriptionDiscount",
] as const;

type StripeReadToolName = (typeof stripeReadToolNames)[number];
type StripeWriteToolName = (typeof stripeWriteToolNames)[number];

type StripeReadDispatchInput = {
  validated: Record<string, unknown>;
  customerId: string;
  accessToken: string;
  namespace: string | undefined;
  context: ConnectorContext;
};

type StripePrepareDispatchInput = {
  validated: Record<string, unknown>;
  toolName: StripeWriteToolName;
};

type StripeWriteDispatchInput = {
  normalizedPayload: Record<string, unknown>;
  customerId: string;
  idempotencyKey: string;
  accessToken: string;
  namespace: string | undefined;
  context: ConnectorContext;
};

export const createStripeConnector = (options?: { sdk?: StripeSdkPort }): Connector => {
  const sdk = wrapObjectWithCircuitBreaker(
    options?.sdk ?? createRealStripeSdk(),
    providerCircuitBreaker,
  );

  const ensureCustomerExists = async (
    context: ConnectorContext,
    customerId: string,
  ): Promise<Record<string, unknown>> => {
    const customer = await sdk.retrieveCustomer({
      accessToken: getToken(context),
      namespace: resolveNamespaceFromContext(context),
      customerId,
    });
    return customer;
  };

  const readMap: Record<
    StripeReadToolName,
    (payload: StripeReadDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "stripe.lookupCustomer": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const customer = await sdk.retrieveCustomer({
        accessToken,
        namespace,
        customerId,
      });
      return { found: true, customer };
    },
    "stripe.searchCustomers": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const customers = await sdk.searchCustomers({
        accessToken,
        namespace,
        query: String(validated.query ?? ""),
        limit: Number(validated.limit ?? 20),
      });
      return {
        query: String(validated.query ?? ""),
        customers,
      };
    },
    "stripe.listSubscriptions": async ({
      validated,
      customerId,
      context,
    }: StripeReadDispatchInput) => {
      const customer = await ensureCustomerExists(context, customerId);
      return {
        customerId,
        subscriptions: Array.isArray(customer.subscriptions) ? customer.subscriptions : [],
      };
    },
    "stripe.getSubscription": async ({
      validated,
      customerId,
      accessToken,
      namespace,
      context,
    }: StripeReadDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const subscription = await sdk.getSubscription({
        accessToken,
        namespace,
        customerId,
        subscriptionId: String(validated.subscriptionId ?? ""),
      });
      return {
        customerId,
        subscription,
      };
    },
    "stripe.listCharges": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const charges = await sdk.listCharges({
        accessToken,
        namespace,
        customerId,
      });
      return {
        customerId,
        charges,
      };
    },
    "stripe.getCharge": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const charge = await sdk.getCharge({
        accessToken,
        namespace,
        customerId,
        chargeId: String(validated.chargeId ?? ""),
      });
      return {
        customerId,
        charge,
      };
    },
    "stripe.invoiceHistory": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const invoices = await sdk.listInvoices({
        accessToken,
        namespace,
        customerId,
      });
      return {
        customerId,
        invoices,
      };
    },
    "stripe.getInvoice": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const invoice = await sdk.getInvoice({
        accessToken,
        namespace,
        customerId,
        invoiceId: String(validated.invoiceId ?? ""),
      });
      return {
        customerId,
        invoice,
      };
    },
    "stripe.previewInvoice": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const invoicePreview = await sdk.previewInvoice({
        accessToken,
        namespace,
        customerId,
        subscriptionId: toOptionalString(validated.subscriptionId),
        priceId: toOptionalString(validated.priceId),
        quantity: toOptionalNumber(validated.quantity),
      });
      return {
        customerId,
        invoice_preview: invoicePreview,
      };
    },
    "stripe.listPaymentMethods": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const paymentMethods = await sdk.listPaymentMethods({
        accessToken,
        namespace,
        customerId,
        type: String(validated.type ?? "card") === "us_bank_account" ? "us_bank_account" : "card",
      });
      return {
        customerId,
        payment_methods: paymentMethods,
      };
    },
    "stripe.getRefund": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const refund = await sdk.getRefund({
        accessToken,
        namespace,
        customerId,
        refundId: String(validated.refundId ?? ""),
      });
      return {
        customerId,
        refund,
      };
    },
    "stripe.listRefunds": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const refunds = await sdk.listRefunds({
        accessToken,
        namespace,
        customerId,
        limit: Number(validated.limit ?? 20),
      });
      return {
        customerId,
        refunds,
      };
    },
    "stripe.listCreditNotes": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const creditNotes = await sdk.listCreditNotes({
        accessToken,
        namespace,
        customerId,
        limit: Number(validated.limit ?? 20),
      });
      return {
        customerId,
        credit_notes: creditNotes,
      };
    },
    "stripe.getDispute": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const dispute = await sdk.getDispute({
        accessToken,
        namespace,
        customerId,
        disputeId: String(validated.disputeId ?? ""),
      });
      return {
        customerId,
        dispute,
      };
    },
    "stripe.listDisputes": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const disputes = await sdk.listDisputes({
        accessToken,
        namespace,
        customerId,
        limit: Number(validated.limit ?? 20),
      });
      return {
        customerId,
        disputes,
      };
    },
    "stripe.listBalanceTransactions": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const balanceTransactions = await sdk.listBalanceTransactions({
        accessToken,
        namespace,
        customerId,
        limit: Number(validated.limit ?? 20),
      });
      return {
        customerId,
        balance_transactions: balanceTransactions,
      };
    },
    "stripe.searchCharges": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const charges = await sdk.searchCharges({
        accessToken,
        namespace,
        query: String(validated.query ?? ""),
        limit: Number(validated.limit ?? 20),
      });
      return {
        query: String(validated.query ?? ""),
        charges,
      };
    },
    "stripe.searchSubscriptions": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const subscriptions = await sdk.searchSubscriptions({
        accessToken,
        namespace,
        query: String(validated.query ?? ""),
        limit: Number(validated.limit ?? 20),
      });
      return {
        query: String(validated.query ?? ""),
        subscriptions,
      };
    },
    "stripe.searchInvoices": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const invoices = await sdk.searchInvoices({
        accessToken,
        namespace,
        query: String(validated.query ?? ""),
        limit: Number(validated.limit ?? 20),
      });
      return {
        query: String(validated.query ?? ""),
        invoices,
      };
    },
    "stripe.getPaymentIntent": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const paymentIntent = await sdk.getPaymentIntent({
        accessToken,
        namespace,
        customerId,
        paymentIntentId: String(validated.paymentIntentId ?? ""),
      });
      return {
        customerId,
        payment_intent: paymentIntent,
      };
    },
    "stripe.listPaymentIntents": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const paymentIntents = await sdk.listPaymentIntents({
        accessToken,
        namespace,
        customerId,
        limit: Number(validated.limit ?? 20),
      });
      return {
        customerId,
        payment_intents: paymentIntents,
      };
    },
    "stripe.searchPaymentIntents": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const paymentIntents = await sdk.searchPaymentIntents({
        accessToken,
        namespace,
        query: String(validated.query ?? ""),
        limit: Number(validated.limit ?? 20),
      });
      return {
        query: String(validated.query ?? ""),
        payment_intents: paymentIntents,
      };
    },
    "stripe.getCoupon": async ({ validated, accessToken, namespace }: StripeReadDispatchInput) => {
      const coupon = await sdk.getCoupon({
        accessToken,
        namespace,
        couponId: String(validated.couponId ?? ""),
      });
      return {
        coupon,
      };
    },
    "stripe.listCoupons": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const coupons = await sdk.listCoupons({
        accessToken,
        namespace,
        limit: Number(validated.limit ?? 20),
      });
      return {
        coupons,
      };
    },
    "stripe.getPromotionCode": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const promotionCode = await sdk.getPromotionCode({
        accessToken,
        namespace,
        promotionCodeId: String(validated.promotionCodeId ?? ""),
      });
      return {
        promotion_code: promotionCode,
      };
    },
    "stripe.listPromotionCodes": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const promotionCodes = await sdk.listPromotionCodes({
        accessToken,
        namespace,
        code: toOptionalString(validated.code),
        limit: Number(validated.limit ?? 20),
      });
      return {
        promotion_codes: promotionCodes,
      };
    },
    "stripe.getProduct": async ({ validated, accessToken, namespace }: StripeReadDispatchInput) => {
      const product = await sdk.getProduct({
        accessToken,
        namespace,
        productId: String(validated.productId ?? ""),
      });
      return {
        product,
      };
    },
    "stripe.listProducts": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const products = await sdk.listProducts({
        accessToken,
        namespace,
        active: toOptionalBoolean(validated.active),
        limit: Number(validated.limit ?? 20),
      });
      return {
        products,
      };
    },
    "stripe.getPrice": async ({ validated, accessToken, namespace }: StripeReadDispatchInput) => {
      const price = await sdk.getPrice({
        accessToken,
        namespace,
        priceId: String(validated.priceId ?? ""),
      });
      return {
        price,
      };
    },
    "stripe.listPrices": async ({ validated, accessToken, namespace }: StripeReadDispatchInput) => {
      const prices = await sdk.listPrices({
        accessToken,
        namespace,
        productId: toOptionalString(validated.productId),
        active: toOptionalBoolean(validated.active),
        limit: Number(validated.limit ?? 20),
      });
      return {
        prices,
      };
    },
    "stripe.getBalanceTransaction": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const balanceTransaction = await sdk.getBalanceTransaction({
        accessToken,
        namespace,
        balanceTransactionId: String(validated.balanceTransactionId ?? ""),
      });
      return {
        balance_transaction: balanceTransaction,
      };
    },
    "stripe.listGlobalBalanceTransactions": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const balanceTransactions = await sdk.listGlobalBalanceTransactions({
        accessToken,
        namespace,
        limit: Number(validated.limit ?? 20),
      });
      return {
        balance_transactions: balanceTransactions,
      };
    },
    "stripe.getCreditNote": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const creditNote = await sdk.getCreditNote({
        accessToken,
        namespace,
        creditNoteId: String(validated.creditNoteId ?? ""),
      });
      return {
        credit_note: creditNote,
      };
    },
    "stripe.previewCreditNote": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const creditNotePreview = await sdk.previewCreditNote({
        accessToken,
        namespace,
        invoiceId: String(validated.invoiceId ?? ""),
        amount: Number(validated.amount ?? 0),
        reason: toOptionalString(validated.reason),
      });
      return {
        credit_note_preview: creditNotePreview,
      };
    },
    "stripe.listSubscriptionItems": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const subscriptionItems = await sdk.listSubscriptionItems({
        accessToken,
        namespace,
        customerId: String(validated.customerId ?? ""),
        subscriptionId: String(validated.subscriptionId ?? ""),
        limit: Number(validated.limit ?? 20),
      });
      return {
        subscription_items: subscriptionItems,
      };
    },
    "stripe.getSubscriptionSchedule": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const subscriptionSchedule = await sdk.getSubscriptionSchedule({
        accessToken,
        namespace,
        subscriptionScheduleId: String(validated.subscriptionScheduleId ?? ""),
      });
      return {
        subscription_schedule: subscriptionSchedule,
      };
    },
    "stripe.listSubscriptionSchedules": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const subscriptionSchedules = await sdk.listSubscriptionSchedules({
        accessToken,
        namespace,
        customerId: toOptionalString(validated.customerId),
        limit: Number(validated.limit ?? 20),
      });
      return {
        subscription_schedules: subscriptionSchedules,
      };
    },
    "stripe.listCustomerTaxIds": async ({
      validated,
      customerId,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const taxIds = await sdk.listCustomerTaxIds({
        accessToken,
        namespace,
        customerId: String(validated.customerId ?? ""),
        limit: Number(validated.limit ?? 20),
      });
      return {
        tax_ids: taxIds,
      };
    },
    "stripe.getCheckoutSession": async ({
      validated,
      accessToken,
      namespace,
    }: StripeReadDispatchInput) => {
      const checkoutSession = await sdk.getCheckoutSession({
        accessToken,
        namespace,
        checkoutSessionId: String(validated.checkoutSessionId ?? ""),
      });
      return {
        checkout_session: checkoutSession,
      };
    },
    "stripe.listEvents": async ({ validated, accessToken, namespace }: StripeReadDispatchInput) => {
      const events = await sdk.listEvents({
        accessToken,
        namespace,
        type: toOptionalString(validated.type),
        limit: Number(validated.limit ?? 20),
      });
      return {
        events,
      };
    },
    "stripe.getEvent": async ({ validated, accessToken, namespace }: StripeReadDispatchInput) => {
      const event = await sdk.getEvent({
        accessToken,
        namespace,
        eventId: String(validated.eventId ?? ""),
      });
      return {
        event,
      };
    },
  };

  const prepareMap: Record<
    StripeWriteToolName,
    (payload: StripePrepareDispatchInput) => Promise<PreparedWrite>
  > = {
    "stripe.issueRefund": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "refund",
        customerId: validated.customerId,
        chargeId: validated.chargeId,
        amount: validated.amount,
        currency: String(validated.currency).toLowerCase(),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          charge_id: validated.chargeId,
          amount: validated.amount,
          currency: String(validated.currency).toLowerCase(),
        },
      };
    },
    "stripe.cancelSubscription": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "cancel_subscription",
        customerId: validated.customerId,
        subscriptionId: validated.subscriptionId,
        atPeriodEnd: validated.atPeriodEnd,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          subscription_id: validated.subscriptionId,
          at_period_end: validated.atPeriodEnd,
        },
      };
    },
    "stripe.adjustBalance": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "adjust_credits",
        customerId: validated.customerId,
        amount: validated.amount,
        currency: String(validated.currency).toLowerCase(),
        reason: validated.reason,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          amount: validated.amount,
          currency: String(validated.currency).toLowerCase(),
          reason: validated.reason,
        },
      };
    },
    "stripe.updateCustomer": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "update_customer",
        customerId: validated.customerId,
        email: toOptionalString(validated.email),
        name: toOptionalString(validated.name),
        phone: toOptionalString(validated.phone),
        metadata:
          validated.metadata && typeof validated.metadata === "object"
            ? (validated.metadata as Record<string, string>)
            : undefined,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          update_fields: Object.keys(normalized).filter(
            (key) =>
              key !== "type" &&
              key !== "customerId" &&
              normalized[key as keyof typeof normalized] !== undefined,
          ),
        },
      };
    },
    "stripe.updateSubscription": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "update_subscription",
        customerId: validated.customerId,
        subscriptionId: validated.subscriptionId,
        priceId: toOptionalString(validated.priceId),
        quantity: toOptionalNumber(validated.quantity),
        cancelAtPeriodEnd: toOptionalBoolean(validated.cancelAtPeriodEnd),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          subscription_id: validated.subscriptionId,
          price_id: normalized.priceId,
          quantity: normalized.quantity,
          cancel_at_period_end: normalized.cancelAtPeriodEnd,
        },
      };
    },
    "stripe.resumeSubscription": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "resume_subscription",
        customerId: validated.customerId,
        subscriptionId: validated.subscriptionId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          subscription_id: validated.subscriptionId,
        },
      };
    },
    "stripe.sendInvoice": async ({ validated, toolName }: StripePrepareDispatchInput) => {
      const normalized = {
        type:
          toolName === "stripe.sendInvoice"
            ? "send_invoice"
            : toolName === "stripe.voidInvoice"
              ? "void_invoice"
              : "pay_invoice",
        customerId: validated.customerId,
        invoiceId: validated.invoiceId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          invoice_id: validated.invoiceId,
          operation: normalized.type,
        },
      };
    },
    "stripe.voidInvoice": async ({ validated, toolName }: StripePrepareDispatchInput) => {
      const normalized = {
        type:
          toolName === "stripe.sendInvoice"
            ? "send_invoice"
            : toolName === "stripe.voidInvoice"
              ? "void_invoice"
              : "pay_invoice",
        customerId: validated.customerId,
        invoiceId: validated.invoiceId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          invoice_id: validated.invoiceId,
          operation: normalized.type,
        },
      };
    },
    "stripe.payInvoice": async ({ validated, toolName }: StripePrepareDispatchInput) => {
      const normalized = {
        type:
          toolName === "stripe.sendInvoice"
            ? "send_invoice"
            : toolName === "stripe.voidInvoice"
              ? "void_invoice"
              : "pay_invoice",
        customerId: validated.customerId,
        invoiceId: validated.invoiceId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          invoice_id: validated.invoiceId,
          operation: normalized.type,
        },
      };
    },
    "stripe.createCreditNote": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_credit_note",
        customerId: validated.customerId,
        invoiceId: validated.invoiceId,
        amount: validated.amount,
        reason: toOptionalString(validated.reason),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          invoice_id: validated.invoiceId,
          amount: validated.amount,
        },
      };
    },
    "stripe.updateDispute": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "update_dispute",
        customerId: validated.customerId,
        disputeId: validated.disputeId,
        evidenceSummary: validated.evidenceSummary,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          dispute_id: validated.disputeId,
          evidence_preview: String(validated.evidenceSummary).slice(0, 100),
        },
      };
    },
    "stripe.closeDispute": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "close_dispute",
        customerId: validated.customerId,
        disputeId: validated.disputeId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          dispute_id: validated.disputeId,
        },
      };
    },
    "stripe.createPortalSession": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_portal_session",
        customerId: validated.customerId,
        returnUrl: validated.returnUrl,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          return_url: validated.returnUrl,
        },
      };
    },
    "stripe.detachPaymentMethod": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "detach_payment_method",
        customerId: validated.customerId,
        paymentMethodId: validated.paymentMethodId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          payment_method_id: validated.paymentMethodId,
        },
      };
    },
    "stripe.cancelRefund": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "cancel_refund",
        customerId: validated.customerId,
        refundId: validated.refundId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          refund_id: validated.refundId,
        },
      };
    },
    "stripe.updateRefund": async ({ validated }: StripePrepareDispatchInput) => {
      const metadata =
        validated.metadata && typeof validated.metadata === "object"
          ? (validated.metadata as Record<string, string>)
          : {};
      const normalized = {
        type: "update_refund",
        customerId: validated.customerId,
        refundId: validated.refundId,
        metadata,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          refund_id: validated.refundId,
          metadata_keys: Object.keys(metadata),
        },
      };
    },
    "stripe.createInvoiceItem": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_invoice_item",
        customerId: validated.customerId,
        amount: validated.amount,
        currency: String(validated.currency).toLowerCase(),
        description: toOptionalString(validated.description),
        invoiceId: toOptionalString(validated.invoiceId),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          amount: validated.amount,
          currency: String(validated.currency).toLowerCase(),
          has_description: typeof normalized.description === "string",
          invoice_id: normalized.invoiceId,
        },
      };
    },
    "stripe.deleteInvoiceItem": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "delete_invoice_item",
        customerId: validated.customerId,
        invoiceItemId: validated.invoiceItemId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          invoice_item_id: validated.invoiceItemId,
        },
      };
    },
    "stripe.finalizeInvoice": async ({ validated, toolName }: StripePrepareDispatchInput) => {
      const normalized = {
        type: toolName === "stripe.finalizeInvoice" ? "finalize_invoice" : "mark_uncollectible",
        customerId: validated.customerId,
        invoiceId: validated.invoiceId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          invoice_id: validated.invoiceId,
          operation: normalized.type,
        },
      };
    },
    "stripe.markUncollectible": async ({ validated, toolName }: StripePrepareDispatchInput) => {
      const normalized = {
        type: toolName === "stripe.finalizeInvoice" ? "finalize_invoice" : "mark_uncollectible",
        customerId: validated.customerId,
        invoiceId: validated.invoiceId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          invoice_id: validated.invoiceId,
          operation: normalized.type,
        },
      };
    },
    "stripe.voidCreditNote": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "void_credit_note",
        customerId: validated.customerId,
        creditNoteId: validated.creditNoteId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          credit_note_id: validated.creditNoteId,
        },
      };
    },
    "stripe.createSubscriptionItem": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_subscription_item",
        customerId: validated.customerId,
        subscriptionId: validated.subscriptionId,
        priceId: validated.priceId,
        quantity: toOptionalNumber(validated.quantity),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          subscription_id: validated.subscriptionId,
          price_id: validated.priceId,
          quantity: normalized.quantity,
        },
      };
    },
    "stripe.updateSubscriptionItem": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "update_subscription_item",
        customerId: validated.customerId,
        subscriptionItemId: validated.subscriptionItemId,
        quantity: toOptionalNumber(validated.quantity),
        priceId: toOptionalString(validated.priceId),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          subscription_item_id: validated.subscriptionItemId,
          quantity: normalized.quantity,
          price_id: normalized.priceId,
        },
      };
    },
    "stripe.deleteSubscriptionItem": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "delete_subscription_item",
        customerId: validated.customerId,
        subscriptionItemId: validated.subscriptionItemId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          subscription_item_id: validated.subscriptionItemId,
        },
      };
    },
    "stripe.updateSubscriptionSchedule": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "update_subscription_schedule",
        customerId: validated.customerId,
        subscriptionScheduleId: validated.subscriptionScheduleId,
        endBehavior: toOptionalString(validated.endBehavior),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          subscription_schedule_id: validated.subscriptionScheduleId,
          end_behavior: normalized.endBehavior,
        },
      };
    },
    "stripe.cancelSubscriptionSchedule": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "cancel_subscription_schedule",
        customerId: validated.customerId,
        subscriptionScheduleId: validated.subscriptionScheduleId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          subscription_schedule_id: validated.subscriptionScheduleId,
        },
      };
    },
    "stripe.createCustomerTaxId": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_customer_tax_id",
        customerId: validated.customerId,
        taxType: validated.type,
        value: validated.value,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          type: validated.type,
          value_preview: String(validated.value).slice(0, 8),
        },
      };
    },
    "stripe.deleteCustomerTaxId": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "delete_customer_tax_id",
        customerId: validated.customerId,
        taxId: validated.taxId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          tax_id: validated.taxId,
        },
      };
    },
    "stripe.createCoupon": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_coupon",
        id: toOptionalString(validated.id),
        name: toOptionalString(validated.name),
        percentOff: toOptionalNumber(validated.percentOff),
        amountOff: toOptionalNumber(validated.amountOff),
        currency: toOptionalString(validated.currency)?.toLowerCase(),
        duration: toOptionalString(validated.duration),
        durationInMonths: toOptionalNumber(validated.durationInMonths),
        maxRedemptions: toOptionalNumber(validated.maxRedemptions),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          coupon_id: normalized.id,
          percent_off: normalized.percentOff,
          amount_off: normalized.amountOff,
          currency: normalized.currency,
          duration: normalized.duration,
        },
      };
    },
    "stripe.createPromotionCode": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_promotion_code",
        couponId: validated.couponId,
        code: toOptionalString(validated.code),
        maxRedemptions: toOptionalNumber(validated.maxRedemptions),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          coupon_id: validated.couponId,
          code: normalized.code,
          max_redemptions: normalized.maxRedemptions,
        },
      };
    },
    "stripe.createCheckoutSession": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_checkout_session",
        customerId: validated.customerId,
        successUrl: validated.successUrl,
        cancelUrl: validated.cancelUrl,
        mode: validated.mode,
        priceId: toOptionalString(validated.priceId),
        quantity: toOptionalNumber(validated.quantity),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          mode: validated.mode,
          price_id: normalized.priceId,
          quantity: normalized.quantity,
        },
      };
    },
    "stripe.createSetupIntent": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_setup_intent",
        customerId: validated.customerId,
        paymentMethodType: toOptionalString(validated.paymentMethodType),
        usage: toOptionalString(validated.usage),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          payment_method_type: normalized.paymentMethodType,
          usage: normalized.usage,
        },
      };
    },
    "stripe.updateCharge": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "update_charge",
        customerId: validated.customerId,
        chargeId: validated.chargeId,
        description: toOptionalString(validated.description),
        metadata:
          validated.metadata && typeof validated.metadata === "object"
            ? (validated.metadata as Record<string, string>)
            : undefined,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          charge_id: validated.chargeId,
          has_description: typeof normalized.description === "string",
          metadata_keys: Object.keys(normalized.metadata ?? {}),
        },
      };
    },
    "stripe.createInvoice": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_invoice",
        customerId: validated.customerId,
        autoAdvance: toOptionalBoolean(validated.autoAdvance),
        collectionMethod: toOptionalString(validated.collectionMethod),
        daysUntilDue: toOptionalNumber(validated.daysUntilDue),
        description: toOptionalString(validated.description),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          auto_advance: normalized.autoAdvance,
          collection_method: normalized.collectionMethod,
          days_until_due: normalized.daysUntilDue,
        },
      };
    },
    "stripe.createSubscription": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "create_subscription",
        customerId: validated.customerId,
        priceId: validated.priceId,
        quantity: toOptionalNumber(validated.quantity),
        trialPeriodDays: toOptionalNumber(validated.trialPeriodDays),
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          price_id: validated.priceId,
          quantity: normalized.quantity,
          trial_period_days: normalized.trialPeriodDays,
        },
      };
    },
    "stripe.deleteCustomerDiscount": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "delete_customer_discount",
        customerId: validated.customerId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
        },
      };
    },
    "stripe.deleteSubscriptionDiscount": async ({ validated }: StripePrepareDispatchInput) => {
      const normalized = {
        type: "delete_subscription_discount",
        customerId: validated.customerId,
        subscriptionId: validated.subscriptionId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          customer_id: validated.customerId,
          subscription_id: validated.subscriptionId,
        },
      };
    },
  };

  const writeMap: Record<
    StripeWriteToolName,
    (payload: StripeWriteDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "stripe.issueRefund": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const charges = await sdk.listCharges({
        accessToken,
        namespace,
        customerId,
      });

      const chargeId = String(normalizedPayload.chargeId ?? "");
      const knownCharge = charges.some((charge) => String(charge.id ?? "") === chargeId);
      if (!knownCharge) {
        throw new Error(`Charge ${chargeId} is not available for customer precondition checks.`);
      }

      const refund = await sdk.createRefund({
        accessToken,
        namespace,
        customerId,
        chargeId,
        amount: Number(normalizedPayload.amount ?? 0),
        currency: String(normalizedPayload.currency ?? "usd"),
        idempotencyKey,
      });

      return {
        provider_action_id: String(refund.id ?? `stripe_refund_${Date.now()}`),
        status: String(refund.status ?? "succeeded"),
        refunded_amount: refund.amount ?? normalizedPayload.amount,
        currency: refund.currency ?? normalizedPayload.currency,
      };
    },
    "stripe.cancelSubscription": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const result = await sdk.cancelSubscription({
        accessToken,
        namespace,
        customerId,
        subscriptionId: String(normalizedPayload.subscriptionId ?? ""),
        atPeriodEnd: Boolean(normalizedPayload.atPeriodEnd),
        idempotencyKey,
      });

      return {
        provider_action_id: String(result.id ?? `stripe_cancel_${Date.now()}`),
        status: String(result.status ?? "succeeded"),
        subscription_id: normalizedPayload.subscriptionId,
      };
    },
    "stripe.adjustBalance": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const result = await sdk.adjustBalance({
        accessToken,
        namespace,
        customerId,
        amount: Number(normalizedPayload.amount ?? 0),
        currency: String(normalizedPayload.currency ?? "usd"),
        reason: String(normalizedPayload.reason ?? ""),
        idempotencyKey,
      });

      return {
        provider_action_id: String(result.id ?? `stripe_adjust_${Date.now()}`),
        status: String(result.status ?? "succeeded"),
        amount: result.amount ?? normalizedPayload.amount,
        currency: result.currency ?? normalizedPayload.currency,
      };
    },
    "stripe.updateCustomer": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const customer = await sdk.updateCustomer({
        accessToken,
        namespace,
        customerId,
        email: toOptionalString(normalizedPayload.email),
        name: toOptionalString(normalizedPayload.name),
        phone: toOptionalString(normalizedPayload.phone),
        metadata:
          normalizedPayload.metadata && typeof normalizedPayload.metadata === "object"
            ? (normalizedPayload.metadata as Record<string, string>)
            : undefined,
        idempotencyKey,
      });

      return {
        provider_action_id: String(customer.id ?? `stripe_customer_${Date.now()}`),
        status: "updated",
        customer_id: customerId,
      };
    },
    "stripe.updateSubscription": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const subscription = await sdk.updateSubscription({
        accessToken,
        namespace,
        customerId,
        subscriptionId: String(normalizedPayload.subscriptionId ?? ""),
        priceId: toOptionalString(normalizedPayload.priceId),
        quantity: toOptionalNumber(normalizedPayload.quantity),
        cancelAtPeriodEnd: toOptionalBoolean(normalizedPayload.cancelAtPeriodEnd),
        idempotencyKey,
      });

      return {
        provider_action_id: String(subscription.id ?? `stripe_subscription_${Date.now()}`),
        status: String(subscription.status ?? "updated"),
        subscription_id: normalizedPayload.subscriptionId,
      };
    },
    "stripe.resumeSubscription": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const subscription = await sdk.resumeSubscription({
        accessToken,
        namespace,
        customerId,
        subscriptionId: String(normalizedPayload.subscriptionId ?? ""),
        idempotencyKey,
      });

      return {
        provider_action_id: String(subscription.id ?? `stripe_subscription_${Date.now()}`),
        status: String(subscription.status ?? "active"),
        subscription_id: normalizedPayload.subscriptionId,
      };
    },
    "stripe.sendInvoice": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const invoice = await sdk.sendInvoice({
        accessToken,
        namespace,
        customerId,
        invoiceId: String(normalizedPayload.invoiceId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(invoice.id ?? `stripe_invoice_${Date.now()}`),
        status: String(invoice.status ?? "open"),
        invoice_id: normalizedPayload.invoiceId,
      };
    },
    "stripe.voidInvoice": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const invoice = await sdk.voidInvoice({
        accessToken,
        namespace,
        customerId,
        invoiceId: String(normalizedPayload.invoiceId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(invoice.id ?? `stripe_invoice_${Date.now()}`),
        status: String(invoice.status ?? "void"),
        invoice_id: normalizedPayload.invoiceId,
      };
    },
    "stripe.payInvoice": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const invoice = await sdk.payInvoice({
        accessToken,
        namespace,
        customerId,
        invoiceId: String(normalizedPayload.invoiceId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(invoice.id ?? `stripe_invoice_${Date.now()}`),
        status: String(invoice.status ?? "paid"),
        invoice_id: normalizedPayload.invoiceId,
      };
    },
    "stripe.createCreditNote": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const creditNote = await sdk.createCreditNote({
        accessToken,
        namespace,
        customerId,
        invoiceId: String(normalizedPayload.invoiceId ?? ""),
        amount: Number(normalizedPayload.amount ?? 0),
        reason: toOptionalString(normalizedPayload.reason),
        idempotencyKey,
      });
      return {
        provider_action_id: String(creditNote.id ?? `stripe_credit_note_${Date.now()}`),
        status: "created",
        credit_note_id: creditNote.id,
      };
    },
    "stripe.updateDispute": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const dispute = await sdk.updateDispute({
        accessToken,
        namespace,
        customerId,
        disputeId: String(normalizedPayload.disputeId ?? ""),
        evidenceSummary: String(normalizedPayload.evidenceSummary ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(dispute.id ?? `stripe_dispute_${Date.now()}`),
        status: String(dispute.status ?? "under_review"),
        dispute_id: normalizedPayload.disputeId,
      };
    },
    "stripe.closeDispute": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const dispute = await sdk.closeDispute({
        accessToken,
        namespace,
        customerId,
        disputeId: String(normalizedPayload.disputeId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(dispute.id ?? `stripe_dispute_${Date.now()}`),
        status: String(dispute.status ?? "lost"),
        dispute_id: normalizedPayload.disputeId,
      };
    },
    "stripe.createPortalSession": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const session = await sdk.createPortalSession({
        accessToken,
        namespace,
        customerId,
        returnUrl: String(normalizedPayload.returnUrl ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(session.id ?? `stripe_portal_${Date.now()}`),
        status: "created",
        url: session.url,
      };
    },
    "stripe.detachPaymentMethod": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const paymentMethod = await sdk.detachPaymentMethod({
        accessToken,
        namespace,
        customerId,
        paymentMethodId: String(normalizedPayload.paymentMethodId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(paymentMethod.id ?? `stripe_payment_method_${Date.now()}`),
        status: "detached",
        payment_method_id: normalizedPayload.paymentMethodId,
      };
    },
    "stripe.cancelRefund": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const refund = await sdk.cancelRefund({
        accessToken,
        namespace,
        customerId,
        refundId: String(normalizedPayload.refundId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(refund.id ?? `stripe_refund_${Date.now()}`),
        status: String(refund.status ?? "canceled"),
        refund_id: normalizedPayload.refundId,
      };
    },
    "stripe.updateRefund": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const refund = await sdk.updateRefund({
        accessToken,
        namespace,
        customerId,
        refundId: String(normalizedPayload.refundId ?? ""),
        metadata:
          normalizedPayload.metadata && typeof normalizedPayload.metadata === "object"
            ? (normalizedPayload.metadata as Record<string, string>)
            : {},
        idempotencyKey,
      });
      return {
        provider_action_id: String(refund.id ?? `stripe_refund_${Date.now()}`),
        status: String(refund.status ?? "updated"),
        refund_id: normalizedPayload.refundId,
      };
    },
    "stripe.createInvoiceItem": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const invoiceItem = await sdk.createInvoiceItem({
        accessToken,
        namespace,
        customerId,
        amount: Number(normalizedPayload.amount ?? 0),
        currency: String(normalizedPayload.currency ?? "usd"),
        description: toOptionalString(normalizedPayload.description),
        invoiceId: toOptionalString(normalizedPayload.invoiceId),
        idempotencyKey,
      });
      return {
        provider_action_id: String(invoiceItem.id ?? `stripe_invoice_item_${Date.now()}`),
        status: "created",
        invoice_item_id: invoiceItem.id,
      };
    },
    "stripe.deleteInvoiceItem": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const invoiceItem = await sdk.deleteInvoiceItem({
        accessToken,
        namespace,
        customerId,
        invoiceItemId: String(normalizedPayload.invoiceItemId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(invoiceItem.id ?? `stripe_invoice_item_${Date.now()}`),
        status: "deleted",
        invoice_item_id: normalizedPayload.invoiceItemId,
        deleted: Boolean(invoiceItem.deleted),
      };
    },
    "stripe.finalizeInvoice": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const invoice = await sdk.finalizeInvoice({
        accessToken,
        namespace,
        customerId,
        invoiceId: String(normalizedPayload.invoiceId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(invoice.id ?? `stripe_invoice_${Date.now()}`),
        status: String(invoice.status ?? "open"),
        invoice_id: normalizedPayload.invoiceId,
      };
    },
    "stripe.markUncollectible": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const invoice = await sdk.markUncollectible({
        accessToken,
        namespace,
        customerId,
        invoiceId: String(normalizedPayload.invoiceId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(invoice.id ?? `stripe_invoice_${Date.now()}`),
        status: String(invoice.status ?? "uncollectible"),
        invoice_id: normalizedPayload.invoiceId,
      };
    },
    "stripe.voidCreditNote": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const creditNote = await sdk.voidCreditNote({
        accessToken,
        namespace,
        customerId,
        creditNoteId: String(normalizedPayload.creditNoteId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(creditNote.id ?? `stripe_credit_note_${Date.now()}`),
        status: String(creditNote.status ?? "void"),
        credit_note_id: normalizedPayload.creditNoteId,
      };
    },
    "stripe.createSubscriptionItem": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const subscriptionItem = await sdk.createSubscriptionItem({
        accessToken,
        namespace,
        customerId,
        subscriptionId: String(normalizedPayload.subscriptionId ?? ""),
        priceId: String(normalizedPayload.priceId ?? ""),
        quantity: toOptionalNumber(normalizedPayload.quantity),
        idempotencyKey,
      });
      return {
        provider_action_id: String(subscriptionItem.id ?? `stripe_subscription_item_${Date.now()}`),
        status: "created",
        subscription_item_id: subscriptionItem.id,
      };
    },
    "stripe.updateSubscriptionItem": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const subscriptionItem = await sdk.updateSubscriptionItem({
        accessToken,
        namespace,
        customerId,
        subscriptionItemId: String(normalizedPayload.subscriptionItemId ?? ""),
        quantity: toOptionalNumber(normalizedPayload.quantity),
        priceId: toOptionalString(normalizedPayload.priceId),
        idempotencyKey,
      });
      return {
        provider_action_id: String(subscriptionItem.id ?? `stripe_subscription_item_${Date.now()}`),
        status: "updated",
        subscription_item_id: subscriptionItem.id,
      };
    },
    "stripe.deleteSubscriptionItem": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const deleted = await sdk.deleteSubscriptionItem({
        accessToken,
        namespace,
        customerId,
        subscriptionItemId: String(normalizedPayload.subscriptionItemId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(deleted.id ?? `stripe_subscription_item_${Date.now()}`),
        status: "deleted",
        subscription_item_id: normalizedPayload.subscriptionItemId,
        deleted: Boolean(deleted.deleted),
      };
    },
    "stripe.updateSubscriptionSchedule": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const schedule = await sdk.updateSubscriptionSchedule({
        accessToken,
        namespace,
        customerId,
        subscriptionScheduleId: String(normalizedPayload.subscriptionScheduleId ?? ""),
        endBehavior: toOptionalString(normalizedPayload.endBehavior),
        idempotencyKey,
      });
      return {
        provider_action_id: String(schedule.id ?? `stripe_subscription_schedule_${Date.now()}`),
        status: String(schedule.status ?? "updated"),
        subscription_schedule_id: schedule.id,
      };
    },
    "stripe.cancelSubscriptionSchedule": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const schedule = await sdk.cancelSubscriptionSchedule({
        accessToken,
        namespace,
        customerId,
        subscriptionScheduleId: String(normalizedPayload.subscriptionScheduleId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(schedule.id ?? `stripe_subscription_schedule_${Date.now()}`),
        status: String(schedule.status ?? "canceled"),
        subscription_schedule_id: schedule.id,
      };
    },
    "stripe.createCustomerTaxId": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const taxId = await sdk.createCustomerTaxId({
        accessToken,
        namespace,
        customerId,
        type: String(normalizedPayload.taxType ?? ""),
        value: String(normalizedPayload.value ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(taxId.id ?? `stripe_tax_id_${Date.now()}`),
        status: "created",
        tax_id: taxId.id,
      };
    },
    "stripe.deleteCustomerTaxId": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const deleted = await sdk.deleteCustomerTaxId({
        accessToken,
        namespace,
        customerId,
        taxId: String(normalizedPayload.taxId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(deleted.id ?? `stripe_tax_id_${Date.now()}`),
        status: "deleted",
        tax_id: normalizedPayload.taxId,
        deleted: Boolean(deleted.deleted),
      };
    },
    "stripe.createCoupon": async ({
      normalizedPayload,
      idempotencyKey,
      accessToken,
      namespace,
    }: StripeWriteDispatchInput) => {
      const coupon = await sdk.createCoupon({
        accessToken,
        namespace,
        id: toOptionalString(normalizedPayload.id),
        name: toOptionalString(normalizedPayload.name),
        percentOff: toOptionalNumber(normalizedPayload.percentOff),
        amountOff: toOptionalNumber(normalizedPayload.amountOff),
        currency: toOptionalString(normalizedPayload.currency),
        duration:
          normalizedPayload.duration === "forever" ||
          normalizedPayload.duration === "repeating" ||
          normalizedPayload.duration === "once"
            ? normalizedPayload.duration
            : undefined,
        durationInMonths: toOptionalNumber(normalizedPayload.durationInMonths),
        maxRedemptions: toOptionalNumber(normalizedPayload.maxRedemptions),
        idempotencyKey,
      });
      return {
        provider_action_id: String(coupon.id ?? `stripe_coupon_${Date.now()}`),
        status: "created",
        coupon_id: coupon.id,
      };
    },
    "stripe.createPromotionCode": async ({
      normalizedPayload,
      idempotencyKey,
      accessToken,
      namespace,
    }: StripeWriteDispatchInput) => {
      const promotionCode = await sdk.createPromotionCode({
        accessToken,
        namespace,
        couponId: String(normalizedPayload.couponId ?? ""),
        code: toOptionalString(normalizedPayload.code),
        maxRedemptions: toOptionalNumber(normalizedPayload.maxRedemptions),
        idempotencyKey,
      });
      return {
        provider_action_id: String(promotionCode.id ?? `stripe_promotion_code_${Date.now()}`),
        status: "created",
        promotion_code_id: promotionCode.id,
      };
    },
    "stripe.createCheckoutSession": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const checkoutSession = await sdk.createCheckoutSession({
        accessToken,
        namespace,
        customerId,
        successUrl: String(normalizedPayload.successUrl ?? ""),
        cancelUrl: String(normalizedPayload.cancelUrl ?? ""),
        mode:
          normalizedPayload.mode === "setup" || normalizedPayload.mode === "subscription"
            ? normalizedPayload.mode
            : "payment",
        priceId: toOptionalString(normalizedPayload.priceId),
        quantity: toOptionalNumber(normalizedPayload.quantity),
        idempotencyKey,
      });
      return {
        provider_action_id: String(checkoutSession.id ?? `stripe_checkout_session_${Date.now()}`),
        status: "created",
        checkout_session_id: checkoutSession.id,
        url: checkoutSession.url,
      };
    },
    "stripe.createSetupIntent": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const setupIntent = await sdk.createSetupIntent({
        accessToken,
        namespace,
        customerId,
        paymentMethodType:
          normalizedPayload.paymentMethodType === "us_bank_account" ? "us_bank_account" : "card",
        usage: normalizedPayload.usage === "on_session" ? "on_session" : "off_session",
        idempotencyKey,
      });
      return {
        provider_action_id: String(setupIntent.id ?? `stripe_setup_intent_${Date.now()}`),
        status: String(setupIntent.status ?? "created"),
        setup_intent_id: setupIntent.id,
        client_secret: setupIntent.client_secret,
      };
    },
    "stripe.updateCharge": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const charge = await sdk.updateCharge({
        accessToken,
        namespace,
        customerId,
        chargeId: String(normalizedPayload.chargeId ?? ""),
        description: toOptionalString(normalizedPayload.description),
        metadata:
          normalizedPayload.metadata && typeof normalizedPayload.metadata === "object"
            ? (normalizedPayload.metadata as Record<string, string>)
            : undefined,
        idempotencyKey,
      });
      return {
        provider_action_id: String(charge.id ?? `stripe_charge_${Date.now()}`),
        status: String(charge.status ?? "updated"),
        charge_id: charge.id,
      };
    },
    "stripe.createInvoice": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const invoice = await sdk.createInvoice({
        accessToken,
        namespace,
        customerId,
        autoAdvance: toOptionalBoolean(normalizedPayload.autoAdvance),
        collectionMethod:
          normalizedPayload.collectionMethod === "send_invoice"
            ? "send_invoice"
            : normalizedPayload.collectionMethod === "charge_automatically"
              ? "charge_automatically"
              : undefined,
        daysUntilDue: toOptionalNumber(normalizedPayload.daysUntilDue),
        description: toOptionalString(normalizedPayload.description),
        idempotencyKey,
      });
      return {
        provider_action_id: String(invoice.id ?? `stripe_invoice_${Date.now()}`),
        status: String(invoice.status ?? "draft"),
        invoice_id: invoice.id,
      };
    },
    "stripe.createSubscription": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const subscription = await sdk.createSubscription({
        accessToken,
        namespace,
        customerId,
        priceId: String(normalizedPayload.priceId ?? ""),
        quantity: toOptionalNumber(normalizedPayload.quantity),
        trialPeriodDays: toOptionalNumber(normalizedPayload.trialPeriodDays),
        idempotencyKey,
      });
      return {
        provider_action_id: String(subscription.id ?? `stripe_subscription_${Date.now()}`),
        status: String(subscription.status ?? "active"),
        subscription_id: subscription.id,
      };
    },
    "stripe.deleteCustomerDiscount": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const deleted = await sdk.deleteCustomerDiscount({
        accessToken,
        namespace,
        customerId,
        idempotencyKey,
      });
      return {
        provider_action_id: String(normalizedPayload.customerId ?? `stripe_discount_${Date.now()}`),
        status: deleted.deleted ? "deleted" : "processed",
        customer_id: normalizedPayload.customerId,
      };
    },
    "stripe.deleteSubscriptionDiscount": async ({
      normalizedPayload,
      customerId,
      idempotencyKey,
      accessToken,
      namespace,
      context,
    }: StripeWriteDispatchInput) => {
      await ensureCustomerExists(context, customerId);
      const deleted = await sdk.deleteSubscriptionDiscount({
        accessToken,
        namespace,
        customerId,
        subscriptionId: String(normalizedPayload.subscriptionId ?? ""),
        idempotencyKey,
      });
      return {
        provider_action_id: String(
          normalizedPayload.subscriptionId ?? `stripe_subscription_discount_${Date.now()}`,
        ),
        status: deleted.deleted ? "deleted" : "processed",
        subscription_id: normalizedPayload.subscriptionId,
      };
    },
  };

  class StripeConnector extends BaseConnector<
    StripeReadDispatchInput,
    StripePrepareDispatchInput,
    StripeWriteDispatchInput,
    typeof stripeTools
  > {
    constructor() {
      super({
        provider: "stripe",
        tools: stripeTools,
        requiredScopesByTool,
        readMap,
        prepareMap,
        writeMap,
      });
    }

    protected getToken(context: ConnectorContext): string {
      return getToken(context);
    }

    protected override async beforePrepareWrite(
      toolName: string,
      _validated: Record<string, unknown>,
      context: ConnectorContext,
    ): Promise<void> {
      enforceWriteMode(toolName, context);
    }

    protected override async beforeWrite(
      toolName: string,
      _normalizedPayload: Record<string, unknown>,
      context: ConnectorContext,
    ): Promise<void> {
      enforceWriteMode(toolName, context);
    }

    protected buildReadDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): StripeReadDispatchInput {
      return {
        validated,
        customerId: String(validated.customerId ?? ""),
        accessToken: runtime.accessToken,
        namespace: runtime.namespace,
        context,
      };
    }

    protected buildPrepareDispatchInput(
      toolName: string,
      validated: Record<string, unknown>,
      _context: ConnectorContext,
    ): StripePrepareDispatchInput {
      return {
        validated,
        toolName: toolName as StripeWriteToolName,
      };
    }

    protected buildWriteDispatchInput(
      toolName: string,
      normalizedPayload: Record<string, unknown>,
      context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): StripeWriteDispatchInput {
      return {
        normalizedPayload,
        customerId: String(normalizedPayload.customerId ?? ""),
        idempotencyKey: buildProviderIdempotencyKey(toolName, normalizedPayload),
        accessToken: runtime.accessToken,
        namespace: runtime.namespace,
        context,
      };
    }

    protected override unsupportedToolMessage(
      phase: "read" | "prepare" | "write",
      toolName: string,
    ): string {
      if (phase === "prepare") {
        return `Unsupported Stripe write tool ${toolName}`;
      }
      if (phase === "write") {
        return `Unsupported Stripe write execution tool ${toolName}`;
      }
      return `Unsupported Stripe read tool ${toolName}`;
    }

    protected override redactFallback(data: Record<string, unknown>): Record<string, unknown> {
      return { ...data };
    }
  }

  return new StripeConnector();
};

const connector = createStripeConnector();

export default connector;
