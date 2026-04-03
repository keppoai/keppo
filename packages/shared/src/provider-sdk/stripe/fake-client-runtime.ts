import type Stripe from "stripe";
import { BaseFakeClient, createNoopProviderSdkCallLog } from "../base-fake-client.js";
import { createFakeProviderSdkErrorFactory, matchErrorCodes } from "../fake-error.js";
import type { ProviderSdkCallLog } from "../port.js";
import type { CreateStripeClient } from "./client-interface.js";
import { createFakeStripeClient as createBoundFakeStripeClient } from "./fake-client-adapter.js";
import {
  seedStripeBalanceTransactions,
  seedStripeCharges,
  seedStripeCoupons,
  seedStripeCreditNotes,
  seedStripeCheckoutSessions,
  seedStripeCustomers,
  seedStripeDisputes,
  seedStripeEvents,
  seedStripeInvoiceItems,
  seedStripeInvoices,
  seedStripePaymentIntents,
  seedStripePaymentMethods,
  seedStripePrices,
  seedStripeProducts,
  seedStripePromotionCodes,
  seedStripeRefunds,
  seedStripeSetupIntents,
  seedStripeSubscriptionItems,
  seedStripeSubscriptionSchedules,
  seedStripeTaxIds,
  type StripeFixtureBalanceTransaction,
  type StripeFixtureCharge,
  type StripeFixtureCheckoutSession,
  type StripeFixtureCoupon,
  type StripeFixtureCreditNote,
  type StripeFixtureCustomer,
  type StripeFixtureDispute,
  type StripeFixtureEvent,
  type StripeFixtureInvoiceItem,
  type StripeFixtureInvoice,
  type StripeFixturePaymentIntent,
  type StripeFixturePaymentMethod,
  type StripeFixturePrice,
  type StripeFixtureProduct,
  type StripeFixturePromotionCode,
  type StripeFixtureRefund,
  type StripeFixtureSetupIntent,
  type StripeFixtureSubscriptionItem,
  type StripeFixtureSubscriptionSchedule,
  type StripeFixtureTaxId,
} from "./fixtures.js";
import type {
  StripeAdjustBalanceArgs,
  StripeBalanceTransactionResult,
  StripeCancelSubscriptionArgs,
  StripeCharge,
  StripeCoupon,
  StripeCancelRefundArgs,
  StripeCloseDisputeArgs,
  StripeCreateInvoiceItemArgs,
  StripeCreateInvoiceArgs,
  StripeCreateCreditNoteArgs,
  StripeCreateCouponArgs,
  StripeCreateCustomerTaxIdArgs,
  StripeCreateCheckoutSessionArgs,
  StripeCreatePortalSessionArgs,
  StripeCreatePromotionCodeArgs,
  StripeCreateRefundArgs,
  StripeCreateSetupIntentArgs,
  StripeCreateSubscriptionArgs,
  StripeCreateSubscriptionItemArgs,
  StripeCreditNote,
  StripeDeleteCustomerDiscountArgs,
  StripeDeleteCustomerTaxIdArgs,
  StripeDeleteInvoiceItemArgs,
  StripeDeleteSubscriptionDiscountArgs,
  StripeDeleteSubscriptionItemArgs,
  StripeDeletedDiscount,
  StripeDeletedSubscriptionItem,
  StripeDeletedTaxId,
  StripeDeletedInvoiceItem,
  StripeDetachPaymentMethodArgs,
  StripeEvent,
  StripeCustomer,
  StripeDispute,
  StripeCheckoutSession,
  StripeGetCouponArgs,
  StripeGetBalanceTransactionArgs,
  StripeGetCheckoutSessionArgs,
  StripeGetChargeArgs,
  StripeGetCreditNoteArgs,
  StripeGetDisputeArgs,
  StripeGetEventArgs,
  StripeGetInvoiceArgs,
  StripeGetPaymentIntentArgs,
  StripeGetPriceArgs,
  StripeGetProductArgs,
  StripeGetPromotionCodeArgs,
  StripeGetSubscriptionScheduleArgs,
  StripeGetRefundArgs,
  StripeGetSubscriptionArgs,
  StripeInvoice,
  StripeInvoiceItem,
  StripeInvoiceMutateArgs,
  StripeInvoiceWriteArgs,
  StripeListBalanceTransactionsArgs,
  StripeListCouponsArgs,
  StripeListChargesArgs,
  StripeListCreditNotesArgs,
  StripeListDisputesArgs,
  StripeListInvoicesArgs,
  StripeListPaymentIntentsArgs,
  StripeListPaymentMethodsArgs,
  StripeListPricesArgs,
  StripeListProductsArgs,
  StripeListPromotionCodesArgs,
  StripeListRefundsArgs,
  StripeListCustomerTaxIdsArgs,
  StripeListEventsArgs,
  StripeListGlobalBalanceTransactionsArgs,
  StripeListSubscriptionItemsArgs,
  StripeListSubscriptionSchedulesArgs,
  StripePaymentIntent,
  StripePaymentMethod,
  StripePrice,
  StripeProduct,
  StripePromotionCode,
  StripePortalSession,
  StripePreviewInvoiceArgs,
  StripeRefund,
  StripeSearchChargesArgs,
  StripeSearchInvoicesArgs,
  StripeSearchPaymentIntentsArgs,
  StripeSearchSubscriptionsArgs,
  StripeRetrieveCustomerArgs,
  StripeSdkPort,
  StripeSetupIntent,
  StripeSearchCustomersArgs,
  StripePreviewCreditNoteArgs,
  StripeSubscriptionItem,
  StripeSubscriptionSchedule,
  StripeUpdateRefundArgs,
  StripeUpdateChargeArgs,
  StripeUpdateSubscriptionItemArgs,
  StripeUpdateSubscriptionScheduleArgs,
  StripeVoidCreditNoteArgs,
  StripeSubscriptionResult,
  StripeTaxId,
  StripeUpdateCustomerArgs,
  StripeUpdateDisputeArgs,
  StripeUpdateSubscriptionArgs,
  StripeCancelSubscriptionScheduleArgs,
  StripeResumeSubscriptionArgs,
} from "./types.js";

export type StripeNamespaceState = {
  customers: Record<string, StripeFixtureCustomer>;
  invoices: Record<string, StripeFixtureInvoice>;
  charges: Record<string, StripeFixtureCharge>;
  refunds: Record<string, StripeFixtureRefund>;
  paymentMethods: Record<string, StripeFixturePaymentMethod>;
  paymentIntents: Record<string, StripeFixturePaymentIntent>;
  creditNotes: Record<string, StripeFixtureCreditNote>;
  disputes: Record<string, StripeFixtureDispute>;
  balanceTransactions: Record<string, StripeFixtureBalanceTransaction>;
  coupons: Record<string, StripeFixtureCoupon>;
  promotionCodes: Record<string, StripeFixturePromotionCode>;
  products: Record<string, StripeFixtureProduct>;
  prices: Record<string, StripeFixturePrice>;
  invoiceItems: Record<string, StripeFixtureInvoiceItem>;
  subscriptionItems: Record<string, StripeFixtureSubscriptionItem>;
  subscriptionSchedules: Record<string, StripeFixtureSubscriptionSchedule>;
  taxIds: Record<string, StripeFixtureTaxId>;
  checkoutSessions: Record<string, StripeFixtureCheckoutSession>;
  setupIntents: Record<string, StripeFixtureSetupIntent>;
  events: Record<string, StripeFixtureEvent>;
  refundCount: number;
  refundCancelCount: number;
  cancelCount: number;
  adjustmentCount: number;
  customerUpdateCount: number;
  subscriptionUpdateCount: number;
  creditNoteCount: number;
  disputeUpdateCount: number;
  portalSessionCount: number;
  paymentMethodDetachCount: number;
  invoiceItemCount: number;
  invoiceFinalizeCount: number;
  invoiceMarkUncollectibleCount: number;
  subscriptionItemCount: number;
  subscriptionScheduleUpdateCount: number;
  taxIdCount: number;
  couponCount: number;
  promotionCodeCount: number;
  checkoutSessionCount: number;
  setupIntentCount: number;
  eventCount: number;
  invoiceCreateCount: number;
  subscriptionCreateCount: number;
  discountDeleteCount: number;
  forceRateLimit: boolean;
  idempotentResponses: Map<string, unknown>;
};

type StripeCounterKey = {
  [K in keyof StripeNamespaceState]: StripeNamespaceState[K] extends number ? K : never;
}[keyof StripeNamespaceState];

const toProviderSdkError = createFakeProviderSdkErrorFactory("stripe", [
  {
    match: matchErrorCodes("missing_access_token", "invalid_access_token"),
    category: "auth",
    code: "invalid_token",
    status: 401,
    retryable: false,
  },
  {
    match: matchErrorCodes("rate_limited"),
    category: "rate_limit",
    code: "rate_limited",
    status: 429,
    retryable: true,
  },
  {
    match: matchErrorCodes("not_found"),
    category: "not_found",
    code: "not_found",
    status: 404,
    retryable: false,
  },
]);

const toStripeSubscriptionResult = (
  customerId: string,
  subscription: Record<string, unknown>,
): StripeSubscriptionResult => {
  const currentPeriodStart =
    typeof subscription.current_period_start === "number"
      ? subscription.current_period_start
      : undefined;
  const currentPeriodEnd =
    typeof subscription.current_period_end === "number"
      ? subscription.current_period_end
      : undefined;
  return {
    id: String(subscription.id ?? ""),
    status: String(subscription.status ?? "active"),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end ?? false),
    customer: customerId,
    ...(typeof currentPeriodStart === "number" ? { current_period_start: currentPeriodStart } : {}),
    ...(typeof currentPeriodEnd === "number" ? { current_period_end: currentPeriodEnd } : {}),
    items: {
      object: "list",
      data:
        typeof subscription.priceId === "string"
          ? [
              {
                id: `si_${String(subscription.id ?? "seed")}`,
                ...(typeof currentPeriodStart === "number"
                  ? { current_period_start: currentPeriodStart }
                  : {}),
                ...(typeof currentPeriodEnd === "number"
                  ? { current_period_end: currentPeriodEnd }
                  : {}),
                price: {
                  id: subscription.priceId,
                },
                quantity: Number(subscription.quantity ?? 1),
              },
            ]
          : [],
      has_more: false,
      url: "/v1/subscription_items",
    },
  };
};

export class InMemoryStripeSdk
  extends BaseFakeClient<StripeNamespaceState>
  implements StripeSdkPort
{
  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    super({
      providerId: "stripe",
      ...(options?.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async retrieveCustomer(args: StripeRetrieveCustomerArgs): Promise<StripeCustomer> {
    return this.getStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.customers.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
      },
      notFound: "customer_not_found",
      load: (state) => state.customers[args.customerId],
      map: (customer) => ({ ...customer }),
    });
  }

  async searchCustomers(args: StripeSearchCustomersArgs): Promise<StripeCustomer[]> {
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.customers.search",
      normalizedArgs: {
        namespace: args.namespace,
        query: args.query,
        limit: args.limit,
      },
      load: (state) => {
        const normalizedQuery = args.query.trim().toLowerCase();
        return Object.values(state.customers).filter((customer) => {
          return (
            customer.id.toLowerCase().includes(normalizedQuery) ||
            customer.email.toLowerCase().includes(normalizedQuery) ||
            customer.name.toLowerCase().includes(normalizedQuery)
          );
        });
      },
      limit: args.limit,
      map: (customer) => ({ ...customer }),
    });
  }

  async updateCustomer(args: StripeUpdateCustomerArgs): Promise<StripeCustomer> {
    const method = "stripe.customers.update";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      email: args.email,
      name: args.name,
      phone: args.phone,
      metadata: args.metadata,
    };

    return this.runStripeCachedOperation(
      args.namespace,
      args.accessToken,
      args.idempotencyKey,
      method,
      normalizedArgs,
      (state) => {
        const customer = state.customers[args.customerId];
        if (!customer) {
          throw new Error("customer_not_found");
        }

        state.customerUpdateCount += 1;
        if (typeof args.email === "string") {
          customer.email = args.email;
        }
        if (typeof args.name === "string") {
          customer.name = args.name;
        }
        if (typeof args.phone === "string") {
          customer.phone = args.phone;
        }
        if (args.metadata) {
          customer.metadata = {
            ...customer.metadata,
            ...args.metadata,
          };
        }

        return {
          ...customer,
        };
      },
    );
  }

  async listCharges(args: StripeListChargesArgs): Promise<StripeCharge[]> {
    return this.listCustomerStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.charges.list",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
      },
      customerId: args.customerId,
      load: (state) => Object.values(state.charges),
      matches: (charge) => charge.customer === args.customerId,
      map: (charge) => ({ ...charge }),
    });
  }

  async getCharge(args: StripeGetChargeArgs): Promise<StripeCharge> {
    return this.getCustomerStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.charges.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        chargeId: args.chargeId,
      },
      customerId: args.customerId,
      notFound: "charge_not_found",
      load: (state) => state.charges[args.chargeId],
      matches: (charge) => charge.customer === args.customerId,
      map: (charge) => ({ ...charge }),
    });
  }

  async listInvoices(args: StripeListInvoicesArgs): Promise<StripeInvoice[]> {
    return this.listCustomerStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.invoices.list",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
      },
      customerId: args.customerId,
      load: (state) => Object.values(state.invoices),
      matches: (invoice) => invoice.customer === args.customerId,
      map: (invoice) => ({ ...invoice }),
    });
  }

  async getInvoice(args: StripeGetInvoiceArgs): Promise<StripeInvoice> {
    return this.getCustomerStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.invoices.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        invoiceId: args.invoiceId,
      },
      customerId: args.customerId,
      notFound: "invoice_not_found",
      load: (state) => state.invoices[args.invoiceId],
      matches: (invoice) => invoice.customer === args.customerId,
      map: (invoice) => ({ ...invoice }),
    });
  }

  async previewInvoice(args: StripePreviewInvoiceArgs): Promise<StripeInvoice> {
    const method = "stripe.invoices.createPreview";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
      priceId: args.priceId,
      quantity: args.quantity,
    };

    return this.runStripeOperation(
      args.namespace,
      args.accessToken,
      method,
      normalizedArgs,
      (state) => {
        this.assertCustomerExists(state, args.customerId);

        const amountDue =
          typeof args.quantity === "number" && Number.isFinite(args.quantity)
            ? Math.max(1, Math.trunc(args.quantity)) * 1000
            : 4900;
        return {
          id: `in_preview_${args.customerId}`,
          customer: args.customerId,
          amount_due: amountDue,
          status: "draft",
          paid: false,
          subscription: args.subscriptionId ?? null,
          price: args.priceId ?? null,
        };
      },
    );
  }

  async createRefund(args: StripeCreateRefundArgs): Promise<StripeRefund> {
    const method = "stripe.refunds.create";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      chargeId: args.chargeId,
      amount: args.amount,
      currency: args.currency,
    };

    return this.runStripeCachedOperation(
      args.namespace,
      args.accessToken,
      args.idempotencyKey,
      method,
      normalizedArgs,
      (state) => {
        this.assertCustomerExists(state, args.customerId);
        const charge = state.charges[args.chargeId];
        if (!charge || charge.customer !== args.customerId) {
          throw new Error("charge_not_found");
        }

        state.refundCount += 1;
        const response: StripeRefund = {
          id: `re_${state.refundCount}`,
          object: "refund",
          status: "succeeded",
          amount: args.amount,
          currency: args.currency,
          charge: args.chargeId,
          metadata: {},
        };

        state.refunds[response.id] = {
          id: response.id,
          customer: args.customerId,
          charge: args.chargeId,
          amount: args.amount,
          currency: args.currency,
          status: String(response.status ?? "succeeded"),
          metadata: {},
        };

        return response;
      },
    );
  }

  async getRefund(args: StripeGetRefundArgs): Promise<StripeRefund> {
    return this.getCustomerStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.refunds.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        refundId: args.refundId,
      },
      customerId: args.customerId,
      notFound: "refund_not_found",
      load: (state) => state.refunds[args.refundId],
      matches: (refund) => refund.customer === args.customerId,
      map: (refund) => this.toRefund(refund),
    });
  }

  async listRefunds(args: StripeListRefundsArgs): Promise<StripeRefund[]> {
    return this.listCustomerStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.refunds.list",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        limit: args.limit,
      },
      customerId: args.customerId,
      load: (state) => Object.values(state.refunds),
      matches: (refund) => refund.customer === args.customerId,
      limit: args.limit,
      map: (refund) => this.toRefund(refund),
    });
  }

  async cancelSubscription(args: StripeCancelSubscriptionArgs): Promise<StripeSubscriptionResult> {
    const method = "stripe.subscriptions.cancel";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
      atPeriodEnd: args.atPeriodEnd,
    };

    return this.runStripeCachedOperation(
      args.namespace,
      args.accessToken,
      args.idempotencyKey,
      method,
      normalizedArgs,
      (state) => {
        const subscription = this.findSubscription(state, args.customerId, args.subscriptionId);
        state.cancelCount += 1;
        subscription.status = "canceled";
        subscription.cancel_at_period_end = Boolean(args.atPeriodEnd);
        return toStripeSubscriptionResult(args.customerId, subscription);
      },
    );
  }

  async getSubscription(args: StripeGetSubscriptionArgs): Promise<StripeSubscriptionResult> {
    const method = "stripe.subscriptions.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
    };

    return this.runStripeOperation(
      args.namespace,
      args.accessToken,
      method,
      normalizedArgs,
      (state) => {
        const subscription = this.findSubscription(state, args.customerId, args.subscriptionId);
        return toStripeSubscriptionResult(args.customerId, subscription);
      },
    );
  }

  async updateSubscription(args: StripeUpdateSubscriptionArgs): Promise<StripeSubscriptionResult> {
    const method = "stripe.subscriptions.update";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
      priceId: args.priceId,
      quantity: args.quantity,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
    };

    return this.runStripeCachedOperation(
      args.namespace,
      args.accessToken,
      args.idempotencyKey,
      method,
      normalizedArgs,
      (state) => {
        const subscription = this.findSubscription(state, args.customerId, args.subscriptionId);
        state.subscriptionUpdateCount += 1;
        if (typeof args.cancelAtPeriodEnd === "boolean") {
          subscription.cancel_at_period_end = args.cancelAtPeriodEnd;
        }
        if (typeof args.priceId === "string") {
          subscription.priceId = args.priceId;
        }
        if (typeof args.quantity === "number") {
          subscription.quantity = args.quantity;
        }
        if (subscription.status === "canceled") {
          subscription.status = "active";
        }
        return toStripeSubscriptionResult(args.customerId, subscription);
      },
    );
  }

  async resumeSubscription(args: StripeResumeSubscriptionArgs): Promise<StripeSubscriptionResult> {
    const method = "stripe.subscriptions.resume";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
    };

    return this.runStripeCachedOperation(
      args.namespace,
      args.accessToken,
      args.idempotencyKey,
      method,
      normalizedArgs,
      (state) => {
        const subscription = this.findSubscription(state, args.customerId, args.subscriptionId);
        subscription.status = "active";
        subscription.cancel_at_period_end = false;
        return toStripeSubscriptionResult(args.customerId, subscription);
      },
    );
  }

  async adjustBalance(args: StripeAdjustBalanceArgs): Promise<StripeBalanceTransactionResult> {
    const method = "stripe.customers.createBalanceTransaction";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      amount: args.amount,
      currency: args.currency,
      reason: args.reason,
    };

    return this.runStripeIdempotentOperation(args, method, normalizedArgs, (state) => {
      this.assertCustomerExists(state, args.customerId);
      state.adjustmentCount += 1;
      const response: StripeBalanceTransactionResult = {
        id: `cbtxn_${state.adjustmentCount}`,
        status: "succeeded",
        amount: args.amount,
        currency: args.currency,
        description: args.reason,
      };

      state.balanceTransactions[response.id] = {
        id: response.id,
        customer: args.customerId,
        amount: args.amount,
        currency: args.currency,
        description: args.reason,
        status: "succeeded",
      };

      return response;
    });
  }

  async sendInvoice(args: StripeInvoiceWriteArgs): Promise<StripeInvoice> {
    return this.mutateInvoice("stripe.invoices.sendInvoice", args, (invoice) => {
      invoice.status = "open";
    });
  }

  async voidInvoice(args: StripeInvoiceWriteArgs): Promise<StripeInvoice> {
    return this.mutateInvoice("stripe.invoices.voidInvoice", args, (invoice) => {
      invoice.status = "void";
      invoice.paid = false;
    });
  }

  async payInvoice(args: StripeInvoiceWriteArgs): Promise<StripeInvoice> {
    return this.mutateInvoice("stripe.invoices.pay", args, (invoice) => {
      invoice.status = "paid";
      invoice.paid = true;
    });
  }

  async listPaymentMethods(args: StripeListPaymentMethodsArgs): Promise<StripePaymentMethod[]> {
    return this.listCustomerStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.paymentMethods.list",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        type: args.type,
      },
      customerId: args.customerId,
      load: (state) => Object.values(state.paymentMethods),
      matches: (paymentMethod) =>
        paymentMethod.customer === args.customerId && paymentMethod.type === args.type,
      map: (paymentMethod) => ({ ...paymentMethod }),
    });
  }

  async createCreditNote(args: StripeCreateCreditNoteArgs): Promise<StripeCreditNote> {
    return this.createStoredStripeResource({
      args,
      method: "stripe.creditNotes.create",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        invoiceId: args.invoiceId,
        amount: args.amount,
        reason: args.reason,
      },
      counter: "creditNoteCount",
      store: (state) => state.creditNotes,
      create: (state, count) => {
        const invoice = state.invoices[args.invoiceId];
        if (!invoice || invoice.customer !== args.customerId) {
          throw new Error("invoice_not_found");
        }

        return {
          id: `cn_${count}`,
          customer: args.customerId,
          invoice: args.invoiceId,
          amount: args.amount,
          reason: args.reason ?? null,
          status: "issued",
        };
      },
      map: (note) => this.toCreditNote(note),
      cacheMode: "cached",
    });
  }

  async listCreditNotes(args: StripeListCreditNotesArgs): Promise<StripeCreditNote[]> {
    return this.listCustomerStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.creditNotes.list",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        limit: args.limit,
      },
      customerId: args.customerId,
      load: (state) => Object.values(state.creditNotes),
      matches: (note) => note.customer === args.customerId,
      limit: args.limit,
      map: (note) => this.toCreditNote(note),
    });
  }

  async getDispute(args: StripeGetDisputeArgs): Promise<StripeDispute> {
    return this.getCustomerStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.disputes.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        disputeId: args.disputeId,
      },
      customerId: args.customerId,
      notFound: "dispute_not_found",
      load: (state) => state.disputes[args.disputeId],
      matches: (dispute) => dispute.customer === args.customerId,
      map: (dispute) => this.toDispute(dispute),
    });
  }

  async listDisputes(args: StripeListDisputesArgs): Promise<StripeDispute[]> {
    return this.listCustomerStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.disputes.list",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        limit: args.limit,
      },
      customerId: args.customerId,
      load: (state) => Object.values(state.disputes),
      matches: (dispute) => dispute.customer === args.customerId,
      limit: args.limit,
      map: (dispute) => this.toDispute(dispute),
    });
  }

  async updateDispute(args: StripeUpdateDisputeArgs): Promise<StripeDispute> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.disputes.update",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        disputeId: args.disputeId,
        evidenceSummary: args.evidenceSummary,
      },
      customerId: args.customerId,
      notFound: "dispute_not_found",
      load: (state) => state.disputes[args.disputeId],
      cacheMode: "cached",
      execute: (state, dispute) => {
        state.disputeUpdateCount += 1;
        dispute.evidence_summary = args.evidenceSummary;
        dispute.status = "under_review";

        return {
          id: dispute.id,
          charge: dispute.charge,
          reason: dispute.reason,
          status: dispute.status,
          evidence_details: {
            summary: dispute.evidence_summary,
          },
        };
      },
    });
  }

  async closeDispute(args: StripeCloseDisputeArgs): Promise<StripeDispute> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.disputes.close",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        disputeId: args.disputeId,
      },
      customerId: args.customerId,
      notFound: "dispute_not_found",
      load: (state) => state.disputes[args.disputeId],
      cacheMode: "cached",
      execute: (_state, dispute) => {
        dispute.status = "lost";
        return {
          id: dispute.id,
          charge: dispute.charge,
          reason: dispute.reason,
          status: dispute.status,
        };
      },
    });
  }

  async createPortalSession(args: StripeCreatePortalSessionArgs): Promise<StripePortalSession> {
    const method = "stripe.billingPortal.sessions.create";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      returnUrl: args.returnUrl,
    };

    return this.runStripeCachedOperation(
      args.namespace,
      args.accessToken,
      args.idempotencyKey,
      method,
      normalizedArgs,
      (state) => {
        this.assertCustomerExists(state, args.customerId);
        state.portalSessionCount += 1;
        return {
          id: `bps_${state.portalSessionCount}`,
          customer: args.customerId,
          url: `${args.returnUrl}?session=bps_${state.portalSessionCount}`,
        };
      },
    );
  }

  async listBalanceTransactions(
    args: StripeListBalanceTransactionsArgs,
  ): Promise<StripeBalanceTransactionResult[]> {
    return this.listCustomerStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.customers.listBalanceTransactions",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        limit: args.limit,
      },
      customerId: args.customerId,
      load: (state) => Object.values(state.balanceTransactions),
      matches: (transaction) => transaction.customer === args.customerId,
      limit: args.limit,
      map: (transaction) => ({ ...transaction }),
    });
  }

  async searchCharges(args: StripeSearchChargesArgs): Promise<StripeCharge[]> {
    const normalizedQuery = args.query.trim().toLowerCase();
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.charges.search",
      normalizedArgs: {
        namespace: args.namespace,
        query: args.query,
        limit: args.limit,
      },
      load: (state) =>
        Object.values(state.charges).filter((charge) => {
          return (
            charge.id.toLowerCase().includes(normalizedQuery) ||
            charge.customer.toLowerCase().includes(normalizedQuery) ||
            String(charge.status ?? "")
              .toLowerCase()
              .includes(normalizedQuery)
          );
        }),
      limit: args.limit,
      map: (charge) => ({ ...charge }),
    });
  }

  async searchSubscriptions(
    args: StripeSearchSubscriptionsArgs,
  ): Promise<StripeSubscriptionResult[]> {
    const normalizedQuery = args.query.trim().toLowerCase();
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.subscriptions.search",
      normalizedArgs: {
        namespace: args.namespace,
        query: args.query,
        limit: args.limit,
      },
      load: (state) =>
        Object.values(state.customers).flatMap((customer) =>
          customer.subscriptions
            .filter((subscription) => {
              const id = String(subscription.id ?? "");
              const status = String(subscription.status ?? "");
              const plan = String(subscription.plan ?? "");
              return (
                id.toLowerCase().includes(normalizedQuery) ||
                status.toLowerCase().includes(normalizedQuery) ||
                plan.toLowerCase().includes(normalizedQuery) ||
                customer.id.toLowerCase().includes(normalizedQuery)
              );
            })
            .map((subscription) => ({
              customerId: customer.id,
              subscription,
            })),
        ),
      limit: args.limit,
      map: ({ customerId, subscription }) => toStripeSubscriptionResult(customerId, subscription),
    });
  }

  async searchInvoices(args: StripeSearchInvoicesArgs): Promise<StripeInvoice[]> {
    const normalizedQuery = args.query.trim().toLowerCase();
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.invoices.search",
      normalizedArgs: {
        namespace: args.namespace,
        query: args.query,
        limit: args.limit,
      },
      load: (state) =>
        Object.values(state.invoices).filter((invoice) => {
          return (
            invoice.id.toLowerCase().includes(normalizedQuery) ||
            invoice.customer.toLowerCase().includes(normalizedQuery) ||
            String(invoice.status ?? "")
              .toLowerCase()
              .includes(normalizedQuery)
          );
        }),
      limit: args.limit,
      map: (invoice) => ({ ...invoice }),
    });
  }

  async getPaymentIntent(args: StripeGetPaymentIntentArgs): Promise<StripePaymentIntent> {
    return this.getCustomerStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.paymentIntents.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        paymentIntentId: args.paymentIntentId,
      },
      customerId: args.customerId,
      notFound: "payment_intent_not_found",
      load: (state) => state.paymentIntents[args.paymentIntentId],
      matches: (paymentIntent) => paymentIntent.customer === args.customerId,
      map: (paymentIntent) => ({ ...paymentIntent }),
    });
  }

  async listPaymentIntents(args: StripeListPaymentIntentsArgs): Promise<StripePaymentIntent[]> {
    return this.listCustomerStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.paymentIntents.list",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        limit: args.limit,
      },
      customerId: args.customerId,
      load: (state) => Object.values(state.paymentIntents),
      matches: (intent) => intent.customer === args.customerId,
      limit: args.limit,
      map: (intent) => ({ ...intent }),
    });
  }

  async searchPaymentIntents(args: StripeSearchPaymentIntentsArgs): Promise<StripePaymentIntent[]> {
    const normalizedQuery = args.query.trim().toLowerCase();
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.paymentIntents.search",
      normalizedArgs: {
        namespace: args.namespace,
        query: args.query,
        limit: args.limit,
      },
      load: (state) =>
        Object.values(state.paymentIntents).filter((intent) => {
          return (
            intent.id.toLowerCase().includes(normalizedQuery) ||
            intent.customer.toLowerCase().includes(normalizedQuery) ||
            String(intent.status ?? "")
              .toLowerCase()
              .includes(normalizedQuery)
          );
        }),
      limit: args.limit,
      map: (intent) => ({ ...intent }),
    });
  }

  async detachPaymentMethod(args: StripeDetachPaymentMethodArgs): Promise<StripePaymentMethod> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.paymentMethods.detach",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        paymentMethodId: args.paymentMethodId,
      },
      customerId: args.customerId,
      notFound: "payment_method_not_found",
      load: (state) => state.paymentMethods[args.paymentMethodId],
      execute: (state, paymentMethod) => {
        state.paymentMethodDetachCount += 1;
        paymentMethod.customer = "";
        const response: StripePaymentMethod = {
          ...paymentMethod,
          customer: null,
        };
        return response;
      },
    });
  }

  async cancelRefund(args: StripeCancelRefundArgs): Promise<StripeRefund> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.refunds.cancel",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        refundId: args.refundId,
      },
      customerId: args.customerId,
      notFound: "refund_not_found",
      load: (state) => state.refunds[args.refundId],
      execute: (state, refund) => {
        state.refundCancelCount += 1;
        refund.status = "canceled";
        return this.toRefund(refund);
      },
    });
  }

  async updateRefund(args: StripeUpdateRefundArgs): Promise<StripeRefund> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.refunds.update",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        refundId: args.refundId,
        metadata: args.metadata,
      },
      customerId: args.customerId,
      notFound: "refund_not_found",
      load: (state) => state.refunds[args.refundId],
      execute: (_state, refund) => {
        refund.metadata = { ...args.metadata };
        return this.toRefund(refund);
      },
    });
  }

  async getCoupon(args: StripeGetCouponArgs): Promise<StripeCoupon> {
    return this.getStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.coupons.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        couponId: args.couponId,
      },
      notFound: "coupon_not_found",
      load: (state) => state.coupons[args.couponId],
      map: (coupon) => ({ ...coupon }),
    });
  }

  async listCoupons(args: StripeListCouponsArgs): Promise<StripeCoupon[]> {
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.coupons.list",
      normalizedArgs: {
        namespace: args.namespace,
        limit: args.limit,
      },
      load: (state) => Object.values(state.coupons),
      limit: args.limit,
      map: (coupon) => ({ ...coupon }),
    });
  }

  async getPromotionCode(args: StripeGetPromotionCodeArgs): Promise<StripePromotionCode> {
    return this.getStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.promotionCodes.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        promotionCodeId: args.promotionCodeId,
      },
      notFound: "promotion_code_not_found",
      load: (state) => state.promotionCodes[args.promotionCodeId],
      map: (promotionCode) => ({ ...promotionCode }),
    });
  }

  async listPromotionCodes(args: StripeListPromotionCodesArgs): Promise<StripePromotionCode[]> {
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.promotionCodes.list",
      normalizedArgs: {
        namespace: args.namespace,
        code: args.code,
        limit: args.limit,
      },
      load: (state) =>
        Object.values(state.promotionCodes).filter((promotionCode) =>
          typeof args.code === "string"
            ? promotionCode.code.toLowerCase().includes(args.code.toLowerCase())
            : true,
        ),
      limit: args.limit,
      map: (promotionCode) => ({ ...promotionCode }),
    });
  }

  async createInvoiceItem(args: StripeCreateInvoiceItemArgs): Promise<StripeInvoiceItem> {
    return this.createStoredStripeResource({
      args,
      method: "stripe.invoiceItems.create",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        amount: args.amount,
        currency: args.currency,
        description: args.description,
        invoiceId: args.invoiceId,
      },
      customerId: args.customerId,
      counter: "invoiceItemCount",
      store: (state) => state.invoiceItems,
      create: (_state, count) => ({
        id: `ii_${count}`,
        customer: args.customerId,
        amount: args.amount,
        currency: args.currency.toLowerCase(),
        ...(typeof args.invoiceId === "string" ? { invoice: args.invoiceId } : {}),
        description: args.description ?? null,
      }),
      map: (item) => ({ ...item }),
    });
  }

  async deleteInvoiceItem(args: StripeDeleteInvoiceItemArgs): Promise<StripeDeletedInvoiceItem> {
    const method = "stripe.invoiceItems.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      invoiceItemId: args.invoiceItemId,
    };

    return this.runStripeIdempotentOperation(args, method, normalizedArgs, (state) => {
      this.assertCustomerExists(state, args.customerId);
      const invoiceItem = state.invoiceItems[args.invoiceItemId];
      if (!invoiceItem || invoiceItem.customer !== args.customerId) {
        throw new Error("invoice_item_not_found");
      }
      delete state.invoiceItems[args.invoiceItemId];
      return {
        id: args.invoiceItemId,
        deleted: true,
      };
    });
  }

  async getProduct(args: StripeGetProductArgs): Promise<StripeProduct> {
    return this.getStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.products.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        productId: args.productId,
      },
      notFound: "product_not_found",
      load: (state) => state.products[args.productId],
      map: (product) => ({ ...product }),
    });
  }

  async listProducts(args: StripeListProductsArgs): Promise<StripeProduct[]> {
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.products.list",
      normalizedArgs: {
        namespace: args.namespace,
        active: args.active,
        limit: args.limit,
      },
      load: (state) =>
        Object.values(state.products).filter((product) =>
          typeof args.active === "boolean" ? product.active === args.active : true,
        ),
      limit: args.limit,
      map: (product) => ({ ...product }),
    });
  }

  async getPrice(args: StripeGetPriceArgs): Promise<StripePrice> {
    return this.getStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.prices.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        priceId: args.priceId,
      },
      notFound: "price_not_found",
      load: (state) => state.prices[args.priceId],
      map: (price) => ({ ...price }),
    });
  }

  async listPrices(args: StripeListPricesArgs): Promise<StripePrice[]> {
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.prices.list",
      normalizedArgs: {
        namespace: args.namespace,
        productId: args.productId,
        active: args.active,
        limit: args.limit,
      },
      load: (state) =>
        Object.values(state.prices).filter((price) => {
          if (typeof args.productId === "string" && price.product !== args.productId) {
            return false;
          }
          if (typeof args.active === "boolean" && price.active !== args.active) {
            return false;
          }
          return true;
        }),
      limit: args.limit,
      map: (price) => ({ ...price }),
    });
  }

  async listSubscriptionItems(
    args: StripeListSubscriptionItemsArgs,
  ): Promise<StripeSubscriptionItem[]> {
    return this.listCustomerStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.subscriptionItems.list",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        subscriptionId: args.subscriptionId,
        limit: args.limit,
      },
      customerId: args.customerId,
      load: (state) => {
        this.findSubscription(state, args.customerId, args.subscriptionId);
        return Object.values(state.subscriptionItems);
      },
      matches: (item) =>
        item.customer === args.customerId && item.subscription === args.subscriptionId,
      limit: args.limit,
      map: (item) => this.toSubscriptionItem(item),
    });
  }

  async createSubscriptionItem(
    args: StripeCreateSubscriptionItemArgs,
  ): Promise<StripeSubscriptionItem> {
    return this.createStoredStripeResource({
      args,
      method: "stripe.subscriptionItems.create",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        subscriptionId: args.subscriptionId,
        priceId: args.priceId,
        quantity: args.quantity,
      },
      customerId: args.customerId,
      counter: "subscriptionItemCount",
      store: (state) => state.subscriptionItems,
      prepare: (state) => {
        this.findSubscription(state, args.customerId, args.subscriptionId);
      },
      create: (_state, count) => ({
        id: `si_${count}`,
        customer: args.customerId,
        subscription: args.subscriptionId,
        price: args.priceId,
        quantity: Math.max(1, Number(args.quantity ?? 1)),
      }),
      map: (item) => this.toSubscriptionItem(item),
    });
  }

  async updateSubscriptionItem(
    args: StripeUpdateSubscriptionItemArgs,
  ): Promise<StripeSubscriptionItem> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.subscriptionItems.update",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        subscriptionItemId: args.subscriptionItemId,
        quantity: args.quantity,
        priceId: args.priceId,
      },
      customerId: args.customerId,
      notFound: "subscription_item_not_found",
      load: (state) => state.subscriptionItems[args.subscriptionItemId],
      prepare: (state, item) => {
        this.findSubscription(state, args.customerId, item.subscription);
      },
      execute: (_state, item) => {
        if (typeof args.quantity === "number" && Number.isFinite(args.quantity)) {
          item.quantity = Math.max(1, Math.trunc(args.quantity));
        }
        if (typeof args.priceId === "string" && args.priceId.trim().length > 0) {
          item.price = args.priceId;
        }
        return this.toSubscriptionItem(item);
      },
    });
  }

  async deleteSubscriptionItem(
    args: StripeDeleteSubscriptionItemArgs,
  ): Promise<StripeDeletedSubscriptionItem> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.subscriptionItems.delete",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        subscriptionItemId: args.subscriptionItemId,
      },
      customerId: args.customerId,
      notFound: "subscription_item_not_found",
      load: (state) => state.subscriptionItems[args.subscriptionItemId],
      execute: (state) => {
        delete state.subscriptionItems[args.subscriptionItemId];
        return {
          id: args.subscriptionItemId,
          deleted: true,
        };
      },
    });
  }

  async getSubscriptionSchedule(
    args: StripeGetSubscriptionScheduleArgs,
  ): Promise<StripeSubscriptionSchedule> {
    return this.getStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.subscriptionSchedules.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        subscriptionScheduleId: args.subscriptionScheduleId,
      },
      notFound: "subscription_schedule_not_found",
      load: (state) => state.subscriptionSchedules[args.subscriptionScheduleId],
      map: (schedule) => this.toSubscriptionSchedule(schedule),
    });
  }

  async listSubscriptionSchedules(
    args: StripeListSubscriptionSchedulesArgs,
  ): Promise<StripeSubscriptionSchedule[]> {
    const method = "stripe.subscriptionSchedules.list";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      limit: args.limit,
    };

    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      load: (state) => {
        if (typeof args.customerId === "string") {
          this.assertCustomerExists(state, args.customerId);
        }

        return Object.values(state.subscriptionSchedules).filter((schedule) =>
          typeof args.customerId === "string" ? schedule.customer === args.customerId : true,
        );
      },
      limit: args.limit,
      map: (schedule) => this.toSubscriptionSchedule(schedule),
    });
  }

  async updateSubscriptionSchedule(
    args: StripeUpdateSubscriptionScheduleArgs,
  ): Promise<StripeSubscriptionSchedule> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.subscriptionSchedules.update",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        subscriptionScheduleId: args.subscriptionScheduleId,
        endBehavior: args.endBehavior,
      },
      customerId: args.customerId,
      notFound: "subscription_schedule_not_found",
      load: (state) => state.subscriptionSchedules[args.subscriptionScheduleId],
      execute: (state, schedule) => {
        state.subscriptionScheduleUpdateCount += 1;
        if (typeof args.endBehavior === "string" && args.endBehavior.trim().length > 0) {
          schedule.end_behavior = args.endBehavior;
        }
        return this.toSubscriptionSchedule(schedule);
      },
    });
  }

  async cancelSubscriptionSchedule(
    args: StripeCancelSubscriptionScheduleArgs,
  ): Promise<StripeSubscriptionSchedule> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.subscriptionSchedules.cancel",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        subscriptionScheduleId: args.subscriptionScheduleId,
      },
      customerId: args.customerId,
      notFound: "subscription_schedule_not_found",
      load: (state) => state.subscriptionSchedules[args.subscriptionScheduleId],
      execute: (_state, schedule) => {
        schedule.status = "canceled";
        return this.toSubscriptionSchedule(schedule);
      },
    });
  }

  async listCustomerTaxIds(args: StripeListCustomerTaxIdsArgs): Promise<StripeTaxId[]> {
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.customers.listTaxIds",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        limit: args.limit,
      },
      load: (state) => {
        this.assertCustomerExists(state, args.customerId);
        return Object.values(state.taxIds).filter((taxId) => taxId.customer === args.customerId);
      },
      limit: args.limit,
      map: (taxId) => this.toTaxId(taxId),
    });
  }

  async createCustomerTaxId(args: StripeCreateCustomerTaxIdArgs): Promise<StripeTaxId> {
    return this.createStoredStripeResource({
      args,
      method: "stripe.customers.createTaxId",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        type: args.type,
        value: args.value,
      },
      customerId: args.customerId,
      counter: "taxIdCount",
      store: (state) => state.taxIds,
      create: (_state, count) => ({
        id: `txi_${count}`,
        customer: args.customerId,
        type: args.type,
        value: args.value,
      }),
      map: (taxId) => this.toTaxId(taxId),
    });
  }

  async deleteCustomerTaxId(args: StripeDeleteCustomerTaxIdArgs): Promise<StripeDeletedTaxId> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.customers.deleteTaxId",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        taxId: args.taxId,
      },
      customerId: args.customerId,
      notFound: "tax_id_not_found",
      load: (state) => state.taxIds[args.taxId],
      execute: (state) => {
        delete state.taxIds[args.taxId];
        return {
          id: args.taxId,
          deleted: true,
        };
      },
    });
  }

  async createCoupon(args: StripeCreateCouponArgs): Promise<StripeCoupon> {
    const method = "stripe.coupons.create";
    const normalizedArgs = {
      namespace: args.namespace,
      id: args.id,
      name: args.name,
      percentOff: args.percentOff,
      amountOff: args.amountOff,
      currency: args.currency,
      duration: args.duration,
      durationInMonths: args.durationInMonths,
      maxRedemptions: args.maxRedemptions,
    };

    return this.runStripeIdempotentOperation(args, method, normalizedArgs, (state) => {
      state.couponCount += 1;
      const couponId =
        typeof args.id === "string" && args.id.trim().length > 0
          ? args.id
          : `cpn_${state.couponCount}`;
      const created: StripeFixtureCoupon = {
        id: couponId,
        name:
          typeof args.name === "string" && args.name.trim().length > 0
            ? args.name
            : `Coupon ${state.couponCount}`,
        valid: true,
        percent_off:
          typeof args.percentOff === "number"
            ? args.percentOff
            : typeof args.amountOff === "number"
              ? null
              : 10,
        amount_off: typeof args.amountOff === "number" ? args.amountOff : null,
        currency:
          typeof args.amountOff === "number" ? String(args.currency ?? "usd").toLowerCase() : null,
        duration: args.duration ?? "once",
        ...(typeof args.durationInMonths === "number" &&
        Number.isFinite(args.durationInMonths) &&
        args.durationInMonths > 0
          ? { duration_in_months: Math.trunc(args.durationInMonths) }
          : {}),
        ...(typeof args.maxRedemptions === "number" &&
        Number.isFinite(args.maxRedemptions) &&
        args.maxRedemptions > 0
          ? { max_redemptions: Math.trunc(args.maxRedemptions) }
          : {}),
      };
      state.coupons[couponId] = created;
      return { ...created };
    });
  }

  async createPromotionCode(args: StripeCreatePromotionCodeArgs): Promise<StripePromotionCode> {
    return this.createStoredStripeResource({
      args,
      method: "stripe.promotionCodes.create",
      normalizedArgs: {
        namespace: args.namespace,
        couponId: args.couponId,
        code: args.code,
        maxRedemptions: args.maxRedemptions,
      },
      counter: "promotionCodeCount",
      store: (state) => state.promotionCodes,
      prepare: (state) => {
        if (!state.coupons[args.couponId]) {
          throw new Error("coupon_not_found");
        }
      },
      create: (_state, count) => ({
        id: `promo_${count}`,
        coupon: args.couponId,
        code:
          typeof args.code === "string" && args.code.trim().length > 0
            ? args.code
            : `PROMO${count}`,
        active: true,
        ...(typeof args.maxRedemptions === "number" &&
        Number.isFinite(args.maxRedemptions) &&
        args.maxRedemptions > 0
          ? { max_redemptions: Math.trunc(args.maxRedemptions) }
          : {}),
      }),
      map: (promotionCode) => ({ ...promotionCode }),
    });
  }

  async getCheckoutSession(args: StripeGetCheckoutSessionArgs): Promise<StripeCheckoutSession> {
    return this.getStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.checkout.sessions.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        checkoutSessionId: args.checkoutSessionId,
      },
      notFound: "checkout_session_not_found",
      load: (state) => state.checkoutSessions[args.checkoutSessionId],
      map: (session) => ({ ...session }),
    });
  }

  async createCheckoutSession(
    args: StripeCreateCheckoutSessionArgs,
  ): Promise<StripeCheckoutSession> {
    return this.createStoredStripeResource({
      args,
      method: "stripe.checkout.sessions.create",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        successUrl: args.successUrl,
        cancelUrl: args.cancelUrl,
        mode: args.mode,
        priceId: args.priceId,
        quantity: args.quantity,
      },
      customerId: args.customerId,
      counter: "checkoutSessionCount",
      store: (state) => state.checkoutSessions,
      create: (_state, count) => ({
        id: `cs_${count}`,
        customer: args.customerId,
        status: "open",
        payment_status: "unpaid",
        mode: args.mode,
        url: `https://checkout.stripe.test/cs_${count}`,
      }),
      map: (session) => ({ ...session }),
    });
  }

  async createSetupIntent(args: StripeCreateSetupIntentArgs): Promise<StripeSetupIntent> {
    return this.createStoredStripeResource({
      args,
      method: "stripe.setupIntents.create",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        paymentMethodType: args.paymentMethodType,
        usage: args.usage,
      },
      customerId: args.customerId,
      counter: "setupIntentCount",
      store: (state) => state.setupIntents,
      create: (_state, count) => ({
        id: `seti_${count}`,
        customer: args.customerId,
        status: "requires_payment_method",
        usage: args.usage ?? "off_session",
        client_secret: `seti_${count}_secret`,
      }),
      map: (setupIntent) => ({ ...setupIntent }),
    });
  }

  async listEvents(args: StripeListEventsArgs): Promise<StripeEvent[]> {
    return this.listStripeResources({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.events.list",
      normalizedArgs: {
        namespace: args.namespace,
        type: args.type,
        limit: args.limit,
      },
      load: (state) =>
        Object.values(state.events).filter((event) =>
          typeof args.type === "string"
            ? event.type.toLowerCase().includes(args.type.toLowerCase())
            : true,
        ),
      limit: args.limit,
      map: (event) => ({ ...event }),
    });
  }

  async getEvent(args: StripeGetEventArgs): Promise<StripeEvent> {
    return this.getStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.events.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        eventId: args.eventId,
      },
      notFound: "event_not_found",
      load: (state) => state.events[args.eventId],
      map: (event) => ({ ...event }),
    });
  }

  async updateCharge(args: StripeUpdateChargeArgs): Promise<StripeCharge> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.charges.update",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        chargeId: args.chargeId,
        description: args.description,
        metadata: args.metadata,
      },
      customerId: args.customerId,
      notFound: "charge_not_found",
      load: (state) => state.charges[args.chargeId],
      execute: (_state, charge) => {
        if (typeof args.description === "string") {
          charge.description = args.description;
        }
        if (args.metadata) {
          const existingMetadata =
            charge.metadata &&
            typeof charge.metadata === "object" &&
            !Array.isArray(charge.metadata)
              ? (charge.metadata as Record<string, string>)
              : {};
          charge.metadata = {
            ...existingMetadata,
            ...args.metadata,
          };
        }
        return { ...charge };
      },
    });
  }

  async createInvoice(args: StripeCreateInvoiceArgs): Promise<StripeInvoice> {
    const method = "stripe.invoices.create";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      autoAdvance: args.autoAdvance,
      collectionMethod: args.collectionMethod,
      daysUntilDue: args.daysUntilDue,
      description: args.description,
    };

    return this.runStripeIdempotentOperation(args, method, normalizedArgs, (state) => {
      this.assertCustomerExists(state, args.customerId);
      state.invoiceCreateCount += 1;
      const invoiceId = `in_create_${state.invoiceCreateCount}`;
      const created: StripeFixtureInvoice = {
        id: invoiceId,
        customer: args.customerId,
        amount_due: 0,
        status: "draft",
        paid: false,
        ...(typeof args.description === "string" ? { description: args.description } : {}),
        ...(typeof args.autoAdvance === "boolean" ? { auto_advance: args.autoAdvance } : {}),
        ...(typeof args.collectionMethod === "string"
          ? { collection_method: args.collectionMethod }
          : {}),
        ...(typeof args.daysUntilDue === "number" && Number.isFinite(args.daysUntilDue)
          ? { days_until_due: Math.trunc(args.daysUntilDue) }
          : {}),
      };
      state.invoices[invoiceId] = created;
      return { ...created };
    });
  }

  async createSubscription(args: StripeCreateSubscriptionArgs): Promise<StripeSubscriptionResult> {
    const method = "stripe.subscriptions.create";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      priceId: args.priceId,
      quantity: args.quantity,
      trialPeriodDays: args.trialPeriodDays,
    };

    return this.runStripeIdempotentOperation(args, method, normalizedArgs, (state) => {
      this.assertCustomerExists(state, args.customerId);
      state.subscriptionCreateCount += 1;
      const customer = state.customers[args.customerId];
      if (!customer) {
        throw new Error("customer_not_found");
      }
      const subscriptionId = `sub_create_${state.subscriptionCreateCount}`;
      const currentPeriodStart = 1_700_000_000 + state.subscriptionCreateCount * 2_592_000;
      const currentPeriodEnd =
        currentPeriodStart +
        (typeof args.trialPeriodDays === "number" && Number.isFinite(args.trialPeriodDays)
          ? Math.trunc(args.trialPeriodDays) * 86_400
          : 2_592_000);
      const createdSubscription = {
        id: subscriptionId,
        status: "active",
        plan: "custom",
        cancel_at_period_end: false,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        priceId: args.priceId,
        quantity: Math.max(1, Number(args.quantity ?? 1)),
        ...(typeof args.trialPeriodDays === "number" && Number.isFinite(args.trialPeriodDays)
          ? { trial_period_days: Math.trunc(args.trialPeriodDays) }
          : {}),
      };
      customer.subscriptions.push(createdSubscription);
      return toStripeSubscriptionResult(args.customerId, createdSubscription);
    });
  }

  async deleteCustomerDiscount(
    args: StripeDeleteCustomerDiscountArgs,
  ): Promise<StripeDeletedDiscount> {
    const method = "stripe.customers.deleteDiscount";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
    };

    return this.runStripeIdempotentOperation(args, method, normalizedArgs, (state) => {
      this.assertCustomerExists(state, args.customerId);
      state.discountDeleteCount += 1;
      return {
        object: "discount",
        deleted: true,
      };
    });
  }

  async deleteSubscriptionDiscount(
    args: StripeDeleteSubscriptionDiscountArgs,
  ): Promise<StripeDeletedDiscount> {
    const method = "stripe.subscriptions.deleteDiscount";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
    };

    return this.runStripeIdempotentOperation(args, method, normalizedArgs, (state) => {
      this.assertCustomerExists(state, args.customerId);
      this.findSubscription(state, args.customerId, args.subscriptionId);
      state.discountDeleteCount += 1;
      return {
        object: "discount",
        deleted: true,
      };
    });
  }

  async getBalanceTransaction(
    args: StripeGetBalanceTransactionArgs,
  ): Promise<StripeBalanceTransactionResult> {
    return this.getStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.balanceTransactions.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        balanceTransactionId: args.balanceTransactionId,
      },
      notFound: "balance_transaction_not_found",
      load: (state) => state.balanceTransactions[args.balanceTransactionId],
      map: (transaction) => ({ ...transaction }),
    });
  }

  async listGlobalBalanceTransactions(
    args: StripeListGlobalBalanceTransactionsArgs,
  ): Promise<StripeBalanceTransactionResult[]> {
    return this.runStripeOperation(
      args.namespace,
      args.accessToken,
      "stripe.balanceTransactions.list",
      {
        namespace: args.namespace,
        limit: args.limit,
      },
      (state) =>
        Object.values(state.balanceTransactions)
          .slice(0, Math.max(1, args.limit))
          .map((transaction) => ({ ...transaction })),
    );
  }

  async getCreditNote(args: StripeGetCreditNoteArgs): Promise<StripeCreditNote> {
    return this.getStripeResource({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "stripe.creditNotes.retrieve",
      normalizedArgs: {
        namespace: args.namespace,
        creditNoteId: args.creditNoteId,
      },
      notFound: "credit_note_not_found",
      load: (state) => state.creditNotes[args.creditNoteId],
      map: (note) => this.toCreditNote(note),
    });
  }

  async previewCreditNote(args: StripePreviewCreditNoteArgs): Promise<StripeCreditNote> {
    const method = "stripe.creditNotes.preview";
    const normalizedArgs = {
      namespace: args.namespace,
      invoiceId: args.invoiceId,
      amount: args.amount,
      reason: args.reason,
    };

    return this.runStripeOperation(
      args.namespace,
      args.accessToken,
      method,
      normalizedArgs,
      (state) => {
        const invoice = state.invoices[args.invoiceId];
        if (!invoice) {
          throw new Error("invoice_not_found");
        }
        return {
          id: `cn_preview_${args.invoiceId}`,
          invoice: args.invoiceId,
          amount: args.amount,
          reason: args.reason ?? null,
          customer: invoice.customer,
          status: "preview",
        };
      },
    );
  }

  async voidCreditNote(args: StripeVoidCreditNoteArgs): Promise<StripeCreditNote> {
    return this.mutateCustomerStripeResource({
      args,
      method: "stripe.creditNotes.voidCreditNote",
      normalizedArgs: {
        namespace: args.namespace,
        customerId: args.customerId,
        creditNoteId: args.creditNoteId,
      },
      customerId: args.customerId,
      notFound: "credit_note_not_found",
      load: (state) => state.creditNotes[args.creditNoteId],
      execute: (_state, note) => {
        note.status = "void";
        return this.toCreditNote(note);
      },
    });
  }

  async finalizeInvoice(args: StripeInvoiceMutateArgs): Promise<StripeInvoice> {
    return this.mutateInvoice("stripe.invoices.finalizeInvoice", args, (invoice) => {
      this.getState(args.namespace).invoiceFinalizeCount += 1;
      invoice.status = "open";
    });
  }

  async markUncollectible(args: StripeInvoiceMutateArgs): Promise<StripeInvoice> {
    return this.mutateInvoice("stripe.invoices.markUncollectible", args, (invoice) => {
      this.getState(args.namespace).invoiceMarkUncollectibleCount += 1;
      invoice.status = "uncollectible";
      invoice.paid = false;
    });
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    const state = this.getState(namespace);

    if (seed.customers && typeof seed.customers === "object" && !Array.isArray(seed.customers)) {
      const customers: Record<string, StripeFixtureCustomer> = {};
      for (const [id, value] of Object.entries(seed.customers as Record<string, unknown>)) {
        const customer = value as Partial<StripeFixtureCustomer>;
        customers[id] = {
          id,
          email: String(customer.email ?? "customer@example.com"),
          name: String(customer.name ?? "Keppo Customer"),
          phone: String(customer.phone ?? "+15555550100"),
          active_subscription: Boolean(customer.active_subscription ?? true),
          balance: Number(customer.balance ?? 0),
          metadata:
            customer.metadata &&
            typeof customer.metadata === "object" &&
            !Array.isArray(customer.metadata)
              ? (customer.metadata as Record<string, string>)
              : { segment: "pro" },
          subscriptions: Array.isArray(customer.subscriptions)
            ? customer.subscriptions.map((subscription) => {
                const value = subscription as {
                  id?: unknown;
                  status?: unknown;
                  plan?: unknown;
                  cancel_at_period_end?: unknown;
                  priceId?: unknown;
                  quantity?: unknown;
                };
                return {
                  id: String(value.id ?? "sub_100"),
                  status: String(value.status ?? "active"),
                  plan: String(value.plan ?? "pro"),
                  cancel_at_period_end: Boolean(value.cancel_at_period_end ?? false),
                  ...(typeof value.priceId === "string" ? { priceId: value.priceId } : {}),
                  ...(typeof value.quantity === "number" && Number.isFinite(value.quantity)
                    ? { quantity: value.quantity }
                    : {}),
                };
              })
            : [{ id: "sub_100", status: "active", plan: "pro" }],
        };
      }
      state.customers = customers;
    }

    if (typeof seed.forceRateLimit === "boolean") {
      state.forceRateLimit = seed.forceRateLimit;
    }
  }

  private mutateInvoice(
    method: string,
    args: StripeInvoiceWriteArgs,
    mutate: (invoice: StripeFixtureInvoice) => void,
  ): Promise<StripeInvoice> {
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      invoiceId: args.invoiceId,
    };

    return this.runStripeIdempotentOperation(args, method, normalizedArgs, (state) => {
      const invoice = state.invoices[args.invoiceId];
      if (!invoice || invoice.customer !== args.customerId) {
        throw new Error("invoice_not_found");
      }

      mutate(invoice);
      return {
        ...invoice,
      };
    });
  }

  protected createDefaultState(): StripeNamespaceState {
    return {
      customers: seedStripeCustomers(),
      invoices: seedStripeInvoices(),
      charges: seedStripeCharges(),
      refunds: seedStripeRefunds(),
      paymentMethods: seedStripePaymentMethods(),
      paymentIntents: seedStripePaymentIntents(),
      creditNotes: seedStripeCreditNotes(),
      disputes: seedStripeDisputes(),
      balanceTransactions: seedStripeBalanceTransactions(),
      coupons: seedStripeCoupons(),
      promotionCodes: seedStripePromotionCodes(),
      products: seedStripeProducts(),
      prices: seedStripePrices(),
      invoiceItems: seedStripeInvoiceItems(),
      subscriptionItems: seedStripeSubscriptionItems(),
      subscriptionSchedules: seedStripeSubscriptionSchedules(),
      taxIds: seedStripeTaxIds(),
      checkoutSessions: seedStripeCheckoutSessions(),
      setupIntents: seedStripeSetupIntents(),
      events: seedStripeEvents(),
      refundCount: 0,
      refundCancelCount: 0,
      cancelCount: 0,
      adjustmentCount: 0,
      customerUpdateCount: 0,
      subscriptionUpdateCount: 0,
      creditNoteCount: 0,
      disputeUpdateCount: 0,
      portalSessionCount: 0,
      paymentMethodDetachCount: 0,
      invoiceItemCount: 0,
      invoiceFinalizeCount: 0,
      invoiceMarkUncollectibleCount: 0,
      subscriptionItemCount: 0,
      subscriptionScheduleUpdateCount: 0,
      taxIdCount: 0,
      couponCount: 0,
      promotionCodeCount: 0,
      checkoutSessionCount: 0,
      setupIntentCount: 0,
      eventCount: 0,
      invoiceCreateCount: 0,
      subscriptionCreateCount: 0,
      discountDeleteCount: 0,
      forceRateLimit: false,
      idempotentResponses: new Map(),
    };
  }

  private async runStripeOperation<TResult>(
    namespace: string | undefined,
    accessToken: string | null | undefined,
    method: string,
    normalizedArgs: unknown,
    execute: (state: StripeNamespaceState) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    return this.runProviderOperation({
      namespace,
      method,
      args: normalizedArgs,
      accessToken,
      assertToken: (token) => this.assertToken(token),
      mapError: toProviderSdkError,
      before: (state) => this.applyFailureFlags(state),
      execute,
    });
  }

  private async runStripeCachedOperation<TResult>(
    namespace: string | undefined,
    accessToken: string | null | undefined,
    idempotencyKey: string | undefined,
    method: string,
    normalizedArgs: unknown,
    execute: (state: StripeNamespaceState) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    return this.runProviderCachedOperation({
      namespace,
      method,
      args: normalizedArgs,
      accessToken,
      assertToken: (token) => this.assertToken(token),
      idempotencyKey,
      mapError: toProviderSdkError,
      before: (state) => this.applyFailureFlags(state),
      getCachedValue: (state) => this.getIdempotentResponse<TResult>(state, method, idempotencyKey),
      setCachedValue: (state, response) =>
        this.setIdempotentResponse(state, method, idempotencyKey, response),
      execute,
    });
  }

  private runStripeIdempotentOperation<TResult>(
    args: {
      namespace?: string | undefined;
      accessToken?: string | null | undefined;
      idempotencyKey?: string | undefined;
    },
    method: string,
    normalizedArgs: unknown,
    execute: (state: StripeNamespaceState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.runProviderIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      accessToken: args.accessToken,
      assertToken: (accessToken) => this.assertToken(accessToken),
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      execute,
    });
  }

  private getStripeResource<TRecord, TResult>(options: {
    namespace: string | undefined;
    accessToken: string | null | undefined;
    method: string;
    normalizedArgs: unknown;
    notFound: string;
    load: (state: StripeNamespaceState) => TRecord | undefined;
    map: (record: TRecord) => TResult;
  }): Promise<TResult> {
    return this.runStripeOperation(
      options.namespace,
      options.accessToken,
      options.method,
      options.normalizedArgs,
      (state) => {
        const record = options.load(state);
        if (!record) {
          throw new Error(options.notFound);
        }
        return options.map(record);
      },
    );
  }

  private getCustomerStripeResource<TRecord extends { customer?: string }, TResult>(options: {
    namespace: string | undefined;
    accessToken: string | null | undefined;
    method: string;
    normalizedArgs: unknown;
    customerId: string;
    notFound: string;
    load: (state: StripeNamespaceState) => TRecord | undefined;
    matches?: (record: TRecord) => boolean;
    map: (record: TRecord) => TResult;
  }): Promise<TResult> {
    return this.getStripeResource({
      namespace: options.namespace,
      accessToken: options.accessToken,
      method: options.method,
      normalizedArgs: options.normalizedArgs,
      notFound: options.notFound,
      load: (state) => {
        this.assertCustomerExists(state, options.customerId);
        const record = options.load(state);
        if (record && (!options.matches || options.matches(record))) {
          return record;
        }
        return undefined;
      },
      map: options.map,
    });
  }

  private listStripeResources<TRecord, TResult>(options: {
    namespace: string | undefined;
    accessToken: string | null | undefined;
    method: string;
    normalizedArgs: unknown;
    load: (state: StripeNamespaceState) => Iterable<TRecord>;
    map: (record: TRecord) => TResult;
    limit?: number;
  }): Promise<TResult[]> {
    return this.runStripeOperation(
      options.namespace,
      options.accessToken,
      options.method,
      options.normalizedArgs,
      (state) =>
        Array.from(options.load(state))
          .slice(0, Math.max(1, options.limit ?? Number.MAX_SAFE_INTEGER))
          .map((record) => options.map(record)),
    );
  }

  private listCustomerStripeResources<TRecord extends { customer?: string }, TResult>(options: {
    namespace: string | undefined;
    accessToken: string | null | undefined;
    method: string;
    normalizedArgs: unknown;
    customerId: string;
    load: (state: StripeNamespaceState) => Iterable<TRecord>;
    matches?: (record: TRecord) => boolean;
    map: (record: TRecord) => TResult;
    limit?: number;
  }): Promise<TResult[]> {
    return this.listStripeResources({
      namespace: options.namespace,
      accessToken: options.accessToken,
      method: options.method,
      normalizedArgs: options.normalizedArgs,
      load: (state) => {
        this.assertCustomerExists(state, options.customerId);
        return Array.from(options.load(state)).filter((record) =>
          options.matches ? options.matches(record) : record.customer === options.customerId,
        );
      },
      map: options.map,
      ...(typeof options.limit === "number" ? { limit: options.limit } : {}),
    });
  }

  private mutateCustomerStripeResource<
    TArgs extends {
      namespace?: string | undefined;
      accessToken?: string | null | undefined;
      idempotencyKey?: string | undefined;
    },
    TRecord extends { customer?: string },
    TResult,
  >(options: {
    args: TArgs;
    method: string;
    normalizedArgs: unknown;
    customerId: string;
    notFound: string;
    load: (state: StripeNamespaceState) => TRecord | undefined;
    matches?: (record: TRecord) => boolean;
    prepare?: (state: StripeNamespaceState, record: TRecord) => void;
    execute: (state: StripeNamespaceState, record: TRecord) => TResult | Promise<TResult>;
    cacheMode?: "cached";
  }): Promise<TResult> {
    const run =
      options.cacheMode === "cached"
        ? (
            execute: (state: StripeNamespaceState) => TResult | Promise<TResult>,
          ): Promise<TResult> =>
            this.runStripeCachedOperation(
              options.args.namespace,
              options.args.accessToken,
              options.args.idempotencyKey,
              options.method,
              options.normalizedArgs,
              execute,
            )
        : (
            execute: (state: StripeNamespaceState) => TResult | Promise<TResult>,
          ): Promise<TResult> =>
            this.runStripeIdempotentOperation(
              options.args,
              options.method,
              options.normalizedArgs,
              execute,
            );

    return run(async (state) => {
      this.assertCustomerExists(state, options.customerId);
      const record = options.load(state);
      if (
        !record ||
        (options.matches && !options.matches(record)) ||
        record.customer !== options.customerId
      ) {
        throw new Error(options.notFound);
      }
      options.prepare?.(state, record);
      return options.execute(state, record);
    });
  }

  private createStoredStripeResource<
    TArgs extends {
      namespace?: string | undefined;
      accessToken?: string | null | undefined;
      idempotencyKey?: string | undefined;
    },
    TRecord extends { id: string },
    TResult,
  >(options: {
    args: TArgs;
    method: string;
    normalizedArgs: unknown;
    counter: StripeCounterKey;
    store: (state: StripeNamespaceState) => Record<string, TRecord>;
    customerId?: string;
    prepare?: (state: StripeNamespaceState) => void;
    create: (state: StripeNamespaceState, count: number) => TRecord;
    map: (record: TRecord) => TResult;
    cacheMode?: "cached";
  }): Promise<TResult> {
    const run =
      options.cacheMode === "cached"
        ? (
            execute: (state: StripeNamespaceState) => TResult | Promise<TResult>,
          ): Promise<TResult> =>
            this.runStripeCachedOperation(
              options.args.namespace,
              options.args.accessToken,
              options.args.idempotencyKey,
              options.method,
              options.normalizedArgs,
              execute,
            )
        : (
            execute: (state: StripeNamespaceState) => TResult | Promise<TResult>,
          ): Promise<TResult> =>
            this.runStripeIdempotentOperation(
              options.args,
              options.method,
              options.normalizedArgs,
              execute,
            );

    return run((state) => {
      if (typeof options.customerId === "string") {
        this.assertCustomerExists(state, options.customerId);
      }
      options.prepare?.(state);
      const count = this.bumpCounter(state, options.counter);
      const record = options.create(state, count);
      options.store(state)[record.id] = record;
      return options.map(record);
    });
  }

  private bumpCounter(state: StripeNamespaceState, counter: StripeCounterKey): number {
    const next = state[counter] + 1;
    state[counter] = next;
    return next;
  }

  private assertToken(accessToken: string | null | undefined): void {
    if (!accessToken || !accessToken.trim()) {
      throw new Error("missing_access_token");
    }
    const normalized = accessToken.trim();
    if (normalized.includes("invalid") || normalized.includes("expired")) {
      throw new Error("invalid_access_token");
    }
  }

  private applyFailureFlags(state: StripeNamespaceState): void {
    if (state.forceRateLimit) {
      throw new Error("rate_limited");
    }
  }

  private assertCustomerExists(state: StripeNamespaceState, customerId: string): void {
    if (!state.customers[customerId]) {
      throw new Error("customer_not_found");
    }
  }

  private findSubscription(
    state: StripeNamespaceState,
    customerId: string,
    subscriptionId: string,
  ): Record<string, unknown> {
    this.assertCustomerExists(state, customerId);
    const customer = state.customers[customerId];
    if (!customer) {
      throw new Error("customer_not_found");
    }
    const subscription = customer.subscriptions.find(
      (entry) => String(entry.id ?? "") === subscriptionId,
    );
    if (!subscription) {
      throw new Error("subscription_not_found");
    }
    return subscription as Record<string, unknown>;
  }

  private toSubscriptionItem(item: StripeFixtureSubscriptionItem): StripeSubscriptionItem {
    return {
      id: item.id,
      subscription: item.subscription,
      quantity: item.quantity,
      price: item.price,
    };
  }

  private toSubscriptionSchedule(
    schedule: StripeFixtureSubscriptionSchedule,
  ): StripeSubscriptionSchedule {
    return {
      id: schedule.id,
      customer: schedule.customer,
      status: schedule.status,
      subscription: schedule.subscription,
      end_behavior: schedule.end_behavior,
    };
  }

  private toTaxId(taxId: StripeFixtureTaxId): StripeTaxId {
    return {
      id: taxId.id,
      customer: taxId.customer,
      type: taxId.type,
      value: taxId.value,
    };
  }

  private toRefund(refund: StripeFixtureRefund): StripeRefund {
    return {
      id: refund.id,
      object: "refund",
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
      charge: refund.charge,
      ...(refund.metadata ? { metadata: { ...refund.metadata } } : {}),
    };
  }

  private toCreditNote(note: StripeFixtureCreditNote): StripeCreditNote {
    return {
      id: note.id,
      invoice: note.invoice,
      amount: note.amount,
      reason: note.reason,
      ...(typeof note.customer === "string" ? { customer: note.customer } : {}),
      ...(typeof note.status === "string" ? { status: note.status } : {}),
    };
  }

  private toDispute(dispute: StripeFixtureDispute): StripeDispute {
    return {
      id: dispute.id,
      charge: dispute.charge,
      reason: dispute.reason,
      status: dispute.status,
      evidence_details: dispute.evidence_summary
        ? {
            summary: dispute.evidence_summary,
          }
        : {},
    };
  }
}

export const createInMemoryStripeSdk = (options?: {
  callLog?: ProviderSdkCallLog;
}): InMemoryStripeSdk => {
  return new InMemoryStripeSdk(options);
};

export class FakeStripeClientStore {
  private readonly engine = new InMemoryStripeSdk({ callLog: createNoopProviderSdkCallLog() });

  readonly createClient: CreateStripeClient = (accessToken, namespace) => {
    return createBoundFakeStripeClient(this.engine, accessToken, namespace);
  };

  reset(namespace?: string): void {
    this.engine.reset(namespace);
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    this.engine.seed(namespace, seed);
  }
}

const defaultFakeStripeClientStore = new FakeStripeClientStore();

export const createFakeStripeClientStore = (): FakeStripeClientStore => {
  return new FakeStripeClientStore();
};

export const createFakeStripeClient: CreateStripeClient = (accessToken, namespace) => {
  return defaultFakeStripeClientStore.createClient(accessToken, namespace);
};
