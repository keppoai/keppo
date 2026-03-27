import {
  createFakeStripeClientStore,
  createFakeStripeSdk,
  type FakeStripeClientStore,
} from "../../../../packages/shared/src/provider-sdk/stripe/fake.js";
import { BaseProviderFake } from "../base-fake";
import type { ProviderReadRequest, ProviderWriteRequest } from "../contract/provider-contract";

const defaultFakeToken = (): string =>
  process.env.KEPPO_FAKE_STRIPE_ACCESS_TOKEN ?? "fake_stripe_access_token";

const parseBody = (input: unknown): Record<string, unknown> => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string" && input.trim().length > 0) {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return Object.fromEntries(new URLSearchParams(input).entries());
    }
  }
  return {};
};

const parseLimit = (value: string | undefined, fallback = 20): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const parseOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const parseOptionalBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  return undefined;
};

export class StripeFake extends BaseProviderFake {
  private readonly clientStore: FakeStripeClientStore = createFakeStripeClientStore();
  private readonly sdk = createFakeStripeSdk({ clientStore: this.clientStore });

  override async getProfile(namespace: string): Promise<Record<string, unknown>> {
    return {
      id: `acct_${namespace}`,
      business_profile: {
        name: "Keppo Test Stripe",
      },
    };
  }

  override async listResources(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource === "customers") {
      const customer = await this.sdk.retrieveCustomer({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: request.query.customer ?? "cus_100",
      });
      return {
        object: "list",
        has_more: false,
        url: "/v1/customers",
        data: [customer],
      };
    }

    if (request.resource === "customers/search") {
      const customers = await this.sdk.searchCustomers({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        query: request.query.query ?? "",
        limit: parseLimit(request.query.limit, 20),
      });
      return {
        object: "search_result",
        data: customers,
      };
    }

    if (request.resource === "charges") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/charges",
        data: await this.sdk.listCharges({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer ?? "cus_100",
        }),
      };
    }

    if (request.resource === "charges/search") {
      return {
        object: "search_result",
        data: await this.sdk.searchCharges({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          query: request.query.query ?? "",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "invoices") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/invoices",
        data: await this.sdk.listInvoices({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer ?? "cus_100",
        }),
      };
    }

    if (request.resource === "invoices/search") {
      return {
        object: "search_result",
        data: await this.sdk.searchInvoices({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          query: request.query.query ?? "",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "payment_methods") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/payment_methods",
        data: await this.sdk.listPaymentMethods({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer ?? "cus_100",
          type: request.query.type === "us_bank_account" ? "us_bank_account" : "card",
        }),
      };
    }

    if (request.resource === "payment_intents") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/payment_intents",
        data: await this.sdk.listPaymentIntents({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer ?? "cus_100",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "payment_intents/search") {
      return {
        object: "search_result",
        data: await this.sdk.searchPaymentIntents({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          query: request.query.query ?? "",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "refunds") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/refunds",
        data: await this.sdk.listRefunds({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer ?? "cus_100",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "credit_notes") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/credit_notes",
        data: await this.sdk.listCreditNotes({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer ?? "cus_100",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "disputes") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/disputes",
        data: await this.sdk.listDisputes({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer ?? "cus_100",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "balance_transactions") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/customers/cus_100/balance_transactions",
        data: await this.sdk.listBalanceTransactions({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer ?? "cus_100",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "balance_transactions/global") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/balance_transactions",
        data: await this.sdk.listGlobalBalanceTransactions({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "subscriptions/search") {
      return {
        object: "search_result",
        data: await this.sdk.searchSubscriptions({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          query: request.query.query ?? "",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "subscription_items") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/subscription_items",
        data: await this.sdk.listSubscriptionItems({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer ?? "cus_100",
          subscriptionId: request.query.subscription ?? "sub_100",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "subscription_schedules") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/subscription_schedules",
        data: await this.sdk.listSubscriptionSchedules({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer,
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "customer_tax_ids") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/customers/cus_100/tax_ids",
        data: await this.sdk.listCustomerTaxIds({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          customerId: request.query.customer ?? "cus_100",
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "events") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/events",
        data: await this.sdk.listEvents({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          type: request.query.type,
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "coupons") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/coupons",
        data: await this.sdk.listCoupons({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "promotion_codes") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/promotion_codes",
        data: await this.sdk.listPromotionCodes({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          code: request.query.code,
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "products") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/products",
        data: await this.sdk.listProducts({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          active:
            typeof request.query.active === "string" ? request.query.active === "true" : undefined,
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    if (request.resource === "prices") {
      return {
        object: "list",
        has_more: false,
        url: "/v1/prices",
        data: await this.sdk.listPrices({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          productId: request.query.product,
          active:
            typeof request.query.active === "string" ? request.query.active === "true" : undefined,
          limit: parseLimit(request.query.limit, 20),
        }),
      };
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async readResource(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource.startsWith("customers/")) {
      const customerId = request.resource.replace("customers/", "");
      return await this.sdk.retrieveCustomer({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId,
      });
    }

    if (request.resource.startsWith("subscriptions/")) {
      const subscriptionId = request.resource.replace("subscriptions/", "");
      return await this.sdk.getSubscription({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: request.query.customer ?? "cus_100",
        subscriptionId,
      });
    }

    if (request.resource.startsWith("charges/")) {
      const chargeId = request.resource.replace("charges/", "");
      return await this.sdk.getCharge({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: request.query.customer ?? "cus_100",
        chargeId,
      });
    }

    if (request.resource.startsWith("invoices/")) {
      const invoiceId = request.resource.replace("invoices/", "");
      return await this.sdk.getInvoice({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: request.query.customer ?? "cus_100",
        invoiceId,
      });
    }

    if (request.resource.startsWith("refunds/")) {
      const refundId = request.resource.replace("refunds/", "");
      return await this.sdk.getRefund({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: request.query.customer ?? "cus_100",
        refundId,
      });
    }

    if (request.resource.startsWith("payment_intents/")) {
      const paymentIntentId = request.resource.replace("payment_intents/", "");
      return await this.sdk.getPaymentIntent({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: request.query.customer ?? "cus_100",
        paymentIntentId,
      });
    }

    if (request.resource.startsWith("coupons/")) {
      const couponId = request.resource.replace("coupons/", "");
      return await this.sdk.getCoupon({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        couponId,
      });
    }

    if (request.resource.startsWith("promotion_codes/")) {
      const promotionCodeId = request.resource.replace("promotion_codes/", "");
      return await this.sdk.getPromotionCode({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        promotionCodeId,
      });
    }

    if (request.resource.startsWith("products/")) {
      const productId = request.resource.replace("products/", "");
      return await this.sdk.getProduct({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        productId,
      });
    }

    if (request.resource.startsWith("prices/")) {
      const priceId = request.resource.replace("prices/", "");
      return await this.sdk.getPrice({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        priceId,
      });
    }

    if (request.resource.startsWith("credit_notes/")) {
      const creditNoteId = request.resource.replace("credit_notes/", "");
      return await this.sdk.getCreditNote({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        creditNoteId,
      });
    }

    if (request.resource.startsWith("balance_transactions/")) {
      const balanceTransactionId = request.resource.replace("balance_transactions/", "");
      return await this.sdk.getBalanceTransaction({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        balanceTransactionId,
      });
    }

    if (request.resource.startsWith("disputes/")) {
      const disputeId = request.resource.replace("disputes/", "");
      return await this.sdk.getDispute({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: request.query.customer ?? "cus_100",
        disputeId,
      });
    }

    if (request.resource.startsWith("subscription_schedules/")) {
      const subscriptionScheduleId = request.resource.replace("subscription_schedules/", "");
      return await this.sdk.getSubscriptionSchedule({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subscriptionScheduleId,
      });
    }

    if (request.resource.startsWith("checkout/sessions/")) {
      const checkoutSessionId = request.resource.replace("checkout/sessions/", "");
      return await this.sdk.getCheckoutSession({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        checkoutSessionId,
      });
    }

    if (request.resource.startsWith("events/")) {
      const eventId = request.resource.replace("events/", "");
      return await this.sdk.getEvent({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        eventId,
      });
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async writeResource(request: ProviderWriteRequest): Promise<Record<string, unknown>> {
    const payload = parseBody(request.body);
    const idempotencyKey =
      request.headers.get("x-idempotency-key") ??
      request.headers.get("Idempotency-Key") ??
      undefined;

    if (request.resource === "refunds") {
      return await this.sdk.createRefund({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customerId ?? "cus_100"),
        chargeId: String(payload.charge ?? payload.chargeId ?? "ch_cus_100"),
        amount: Number(payload.amount ?? 0),
        currency: String(payload.currency ?? "usd"),
        idempotencyKey,
      });
    }

    if (request.resource === "customers/update") {
      return await this.sdk.updateCustomer({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customerId ?? "cus_100"),
        email: typeof payload.email === "string" ? payload.email : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
        phone: typeof payload.phone === "string" ? payload.phone : undefined,
        metadata:
          payload.metadata &&
          typeof payload.metadata === "object" &&
          !Array.isArray(payload.metadata)
            ? (payload.metadata as Record<string, string>)
            : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "subscriptions/cancel") {
      return await this.sdk.cancelSubscription({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        subscriptionId: String(payload.subscription ?? payload.subscriptionId ?? "sub_100"),
        atPeriodEnd: String(payload.cancel_at_period_end ?? "false") === "true",
        idempotencyKey,
      });
    }

    if (request.resource === "subscriptions/update") {
      return await this.sdk.updateSubscription({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        subscriptionId: String(payload.subscription ?? payload.subscriptionId ?? "sub_100"),
        priceId: typeof payload.priceId === "string" ? payload.priceId : undefined,
        quantity: typeof payload.quantity === "number" ? payload.quantity : undefined,
        cancelAtPeriodEnd:
          typeof payload.cancel_at_period_end === "boolean"
            ? payload.cancel_at_period_end
            : typeof payload.cancel_at_period_end === "string"
              ? payload.cancel_at_period_end === "true"
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "subscriptions/resume") {
      return await this.sdk.resumeSubscription({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        subscriptionId: String(payload.subscription ?? payload.subscriptionId ?? "sub_100"),
        idempotencyKey,
      });
    }

    if (request.resource === "customers/balance") {
      return await this.sdk.adjustBalance({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        amount: Number(payload.amount ?? 0),
        currency: String(payload.currency ?? "usd"),
        reason: String(payload.description ?? payload.reason ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "invoices/send") {
      return await this.sdk.sendInvoice({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        invoiceId: String(payload.invoice ?? payload.invoiceId ?? "in_cus_100_1"),
        idempotencyKey,
      });
    }

    if (request.resource === "invoices/void") {
      return await this.sdk.voidInvoice({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        invoiceId: String(payload.invoice ?? payload.invoiceId ?? "in_cus_100_1"),
        idempotencyKey,
      });
    }

    if (request.resource === "invoices/pay") {
      return await this.sdk.payInvoice({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        invoiceId: String(payload.invoice ?? payload.invoiceId ?? "in_cus_100_1"),
        idempotencyKey,
      });
    }

    if (request.resource === "invoices/finalize") {
      return await this.sdk.finalizeInvoice({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        invoiceId: String(payload.invoice ?? payload.invoiceId ?? "in_cus_100_1"),
        idempotencyKey,
      });
    }

    if (request.resource === "invoices/mark_uncollectible") {
      return await this.sdk.markUncollectible({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        invoiceId: String(payload.invoice ?? payload.invoiceId ?? "in_cus_100_1"),
        idempotencyKey,
      });
    }

    if (request.resource === "invoices/preview") {
      return await this.sdk.previewInvoice({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        subscriptionId: typeof payload.subscription === "string" ? payload.subscription : undefined,
        priceId: typeof payload.price === "string" ? payload.price : undefined,
        quantity: typeof payload.quantity === "number" ? payload.quantity : undefined,
      });
    }

    if (request.resource === "credit_notes") {
      return await this.sdk.createCreditNote({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        invoiceId: String(payload.invoice ?? payload.invoiceId ?? "in_cus_100_1"),
        amount: Number(payload.amount ?? 0),
        reason: typeof payload.reason === "string" ? payload.reason : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "credit_notes/preview") {
      return await this.sdk.previewCreditNote({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        invoiceId: String(payload.invoice ?? payload.invoiceId ?? "in_cus_100_1"),
        amount: Number(payload.amount ?? 0),
        reason: typeof payload.reason === "string" ? payload.reason : undefined,
      });
    }

    if (request.resource === "payment_methods/detach") {
      return await this.sdk.detachPaymentMethod({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        paymentMethodId: String(payload.payment_method ?? payload.paymentMethodId ?? "pm_card_1"),
        idempotencyKey,
      });
    }

    if (request.resource === "refunds/cancel") {
      return await this.sdk.cancelRefund({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        refundId: String(payload.refund ?? payload.refundId ?? "re_seed_1"),
        idempotencyKey,
      });
    }

    if (request.resource === "refunds/update") {
      const metadata =
        payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
          ? Object.fromEntries(
              Object.entries(payload.metadata as Record<string, unknown>).map(([key, value]) => [
                key,
                String(value),
              ]),
            )
          : {};
      return await this.sdk.updateRefund({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        refundId: String(payload.refund ?? payload.refundId ?? "re_seed_1"),
        metadata,
        idempotencyKey,
      });
    }

    if (request.resource === "invoice_items") {
      return await this.sdk.createInvoiceItem({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        amount: Number(payload.amount ?? 0),
        currency: String(payload.currency ?? "usd"),
        description: typeof payload.description === "string" ? payload.description : undefined,
        invoiceId: typeof payload.invoice === "string" ? payload.invoice : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "invoice_items/delete") {
      return await this.sdk.deleteInvoiceItem({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        invoiceItemId: String(payload.invoiceItemId ?? payload.invoice_item ?? "ii_seed_1"),
        idempotencyKey,
      });
    }

    if (request.resource === "subscription_items") {
      return await this.sdk.createSubscriptionItem({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        subscriptionId: String(payload.subscription ?? payload.subscriptionId ?? "sub_100"),
        priceId: String(payload.price ?? payload.priceId ?? "price_seed_1"),
        quantity: parseOptionalNumber(payload.quantity),
        idempotencyKey,
      });
    }

    if (request.resource === "subscription_items/update") {
      return await this.sdk.updateSubscriptionItem({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        subscriptionItemId: String(
          payload.subscription_item ?? payload.subscriptionItemId ?? "si_seed_1",
        ),
        quantity: parseOptionalNumber(payload.quantity),
        priceId:
          typeof payload.price === "string"
            ? payload.price
            : typeof payload.priceId === "string"
              ? payload.priceId
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "subscription_items/delete") {
      return await this.sdk.deleteSubscriptionItem({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        subscriptionItemId: String(
          payload.subscription_item ?? payload.subscriptionItemId ?? "si_seed_1",
        ),
        idempotencyKey,
      });
    }

    if (request.resource === "subscription_schedules/update") {
      return await this.sdk.updateSubscriptionSchedule({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        subscriptionScheduleId: String(
          payload.subscription_schedule ?? payload.subscriptionScheduleId ?? "sub_sched_seed_1",
        ),
        endBehavior:
          typeof payload.end_behavior === "string"
            ? payload.end_behavior
            : typeof payload.endBehavior === "string"
              ? payload.endBehavior
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "subscription_schedules/cancel") {
      return await this.sdk.cancelSubscriptionSchedule({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        subscriptionScheduleId: String(
          payload.subscription_schedule ?? payload.subscriptionScheduleId ?? "sub_sched_seed_1",
        ),
        idempotencyKey,
      });
    }

    if (request.resource === "customer_tax_ids") {
      return await this.sdk.createCustomerTaxId({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        type: String(payload.type ?? "eu_vat"),
        value: String(payload.value ?? "DE123456789"),
        idempotencyKey,
      });
    }

    if (request.resource === "customer_tax_ids/delete") {
      return await this.sdk.deleteCustomerTaxId({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        taxId: String(payload.tax_id ?? payload.taxId ?? "txi_seed_1"),
        idempotencyKey,
      });
    }

    if (request.resource === "coupons/create") {
      return await this.sdk.createCoupon({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        id: typeof payload.id === "string" ? payload.id : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
        percentOff: parseOptionalNumber(payload.percent_off),
        amountOff: parseOptionalNumber(payload.amount_off),
        currency: typeof payload.currency === "string" ? payload.currency : undefined,
        duration:
          payload.duration === "once" ||
          payload.duration === "repeating" ||
          payload.duration === "forever"
            ? payload.duration
            : undefined,
        durationInMonths: parseOptionalNumber(payload.duration_in_months),
        maxRedemptions: parseOptionalNumber(payload.max_redemptions),
        idempotencyKey,
      });
    }

    if (request.resource === "promotion_codes/create") {
      return await this.sdk.createPromotionCode({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        couponId: String(payload.coupon ?? payload.couponId ?? "cpn_seed_1"),
        code: typeof payload.code === "string" ? payload.code : undefined,
        maxRedemptions: parseOptionalNumber(payload.max_redemptions),
        idempotencyKey,
      });
    }

    if (request.resource === "checkout/sessions") {
      const sourceItems = Array.isArray(payload.line_items) ? payload.line_items : [];
      const firstItem =
        sourceItems.length > 0 &&
        sourceItems[0] &&
        typeof sourceItems[0] === "object" &&
        !Array.isArray(sourceItems[0])
          ? (sourceItems[0] as Record<string, unknown>)
          : {};
      return await this.sdk.createCheckoutSession({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        successUrl: String(
          payload.success_url ?? payload.successUrl ?? "https://example.test/success",
        ),
        cancelUrl: String(payload.cancel_url ?? payload.cancelUrl ?? "https://example.test/cancel"),
        mode:
          payload.mode === "setup" || payload.mode === "subscription" ? payload.mode : "payment",
        priceId:
          typeof firstItem.price === "string"
            ? firstItem.price
            : typeof payload.priceId === "string"
              ? payload.priceId
              : undefined,
        quantity: parseOptionalNumber(firstItem.quantity) ?? parseOptionalNumber(payload.quantity),
        idempotencyKey,
      });
    }

    if (request.resource === "setup_intents") {
      const paymentMethodTypes = Array.isArray(payload.payment_method_types)
        ? payload.payment_method_types
        : [];
      const firstPaymentMethodType = paymentMethodTypes[0];
      return await this.sdk.createSetupIntent({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        paymentMethodType:
          firstPaymentMethodType === "us_bank_account" ||
          payload.paymentMethodType === "us_bank_account"
            ? "us_bank_account"
            : "card",
        usage: payload.usage === "on_session" ? "on_session" : "off_session",
        idempotencyKey,
      });
    }

    if (request.resource === "charges/update") {
      const metadata =
        payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
          ? Object.fromEntries(
              Object.entries(payload.metadata as Record<string, unknown>).map(([key, value]) => [
                key,
                String(value),
              ]),
            )
          : undefined;
      return await this.sdk.updateCharge({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        chargeId: String(payload.charge ?? payload.chargeId ?? "ch_cus_100"),
        description: typeof payload.description === "string" ? payload.description : undefined,
        metadata,
        idempotencyKey,
      });
    }

    if (request.resource === "invoices/create") {
      return await this.sdk.createInvoice({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        autoAdvance:
          parseOptionalBoolean(payload.auto_advance) ?? parseOptionalBoolean(payload.autoAdvance),
        collectionMethod:
          payload.collection_method === "send_invoice" ||
          payload.collectionMethod === "send_invoice"
            ? "send_invoice"
            : payload.collection_method === "charge_automatically" ||
                payload.collectionMethod === "charge_automatically"
              ? "charge_automatically"
              : undefined,
        daysUntilDue:
          parseOptionalNumber(payload.days_until_due) ?? parseOptionalNumber(payload.daysUntilDue),
        description: typeof payload.description === "string" ? payload.description : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "subscriptions/create") {
      const sourceItems = Array.isArray(payload.items) ? payload.items : [];
      const firstItem =
        sourceItems.length > 0 &&
        sourceItems[0] &&
        typeof sourceItems[0] === "object" &&
        !Array.isArray(sourceItems[0])
          ? (sourceItems[0] as Record<string, unknown>)
          : {};
      return await this.sdk.createSubscription({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        priceId:
          typeof firstItem.price === "string"
            ? firstItem.price
            : typeof payload.priceId === "string"
              ? payload.priceId
              : "price_seed_1",
        quantity: parseOptionalNumber(firstItem.quantity) ?? parseOptionalNumber(payload.quantity),
        trialPeriodDays:
          parseOptionalNumber(payload.trial_period_days) ??
          parseOptionalNumber(payload.trialPeriodDays),
        idempotencyKey,
      });
    }

    if (request.resource === "customers/discount/delete") {
      return await this.sdk.deleteCustomerDiscount({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        idempotencyKey,
      });
    }

    if (request.resource === "subscriptions/discount/delete") {
      return await this.sdk.deleteSubscriptionDiscount({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        subscriptionId: String(payload.subscription ?? payload.subscriptionId ?? "sub_100"),
        idempotencyKey,
      });
    }

    if (request.resource === "disputes/update") {
      return await this.sdk.updateDispute({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        disputeId: String(payload.dispute ?? payload.disputeId ?? "dp_seed_1"),
        evidenceSummary: String(payload.evidenceSummary ?? payload.evidence ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "disputes/close") {
      return await this.sdk.closeDispute({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        disputeId: String(payload.dispute ?? payload.disputeId ?? "dp_seed_1"),
        idempotencyKey,
      });
    }

    if (request.resource === "billing_portal/sessions") {
      return await this.sdk.createPortalSession({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        returnUrl: String(payload.return_url ?? payload.returnUrl ?? "https://example.test"),
        idempotencyKey,
      });
    }

    if (request.resource === "credit_notes/void") {
      return await this.sdk.voidCreditNote({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        customerId: String(payload.customer ?? payload.customerId ?? "cus_100"),
        creditNoteId: String(payload.credit_note ?? payload.creditNoteId ?? "cn_seed_1"),
        idempotencyKey,
      });
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override reset(namespace?: string): void {
    super.reset(namespace);
    this.clientStore.reset(namespace);
  }

  override seed(namespace: string, seedData: Record<string, unknown>): void {
    super.seed(namespace, seedData);
    this.clientStore.seed(namespace, seedData);
  }

  getSdkCalls(namespace?: string): Array<Record<string, unknown>> {
    return this.sdk.callLog.list(namespace);
  }
}
