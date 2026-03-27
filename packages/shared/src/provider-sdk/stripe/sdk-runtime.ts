import type Stripe from "stripe";
import type { ProviderSdkCallLog, ProviderSdkRuntime } from "../port.js";
import { BaseSdkPort } from "../base-sdk.js";
import { toProviderSdkError } from "./errors.js";
import type { CreateStripeClient } from "./client-interface.js";
import type {
  StripeAdjustBalanceArgs,
  StripeBalanceTransactionResult,
  StripeCancelRefundArgs,
  StripeCancelSubscriptionScheduleArgs,
  StripeCancelSubscriptionArgs,
  StripeCharge,
  StripeCheckoutSession,
  StripeCoupon,
  StripeCloseDisputeArgs,
  StripeCreateCheckoutSessionArgs,
  StripeCreateCouponArgs,
  StripeCreateCustomerTaxIdArgs,
  StripeCreateInvoiceArgs,
  StripeCreateInvoiceItemArgs,
  StripeCreateCreditNoteArgs,
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
  StripeCustomer,
  StripeDispute,
  StripeEvent,
  StripeGetCheckoutSessionArgs,
  StripeGetCouponArgs,
  StripeGetChargeArgs,
  StripeGetDisputeArgs,
  StripeGetEventArgs,
  StripeGetInvoiceArgs,
  StripeGetPaymentIntentArgs,
  StripeGetBalanceTransactionArgs,
  StripeGetCreditNoteArgs,
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
  StripeListCustomerTaxIdsArgs,
  StripeListChargesArgs,
  StripeListCreditNotesArgs,
  StripeListDisputesArgs,
  StripeListEventsArgs,
  StripeListInvoicesArgs,
  StripeListPaymentIntentsArgs,
  StripeListPaymentMethodsArgs,
  StripeListPricesArgs,
  StripeListProductsArgs,
  StripeListPromotionCodesArgs,
  StripeListRefundsArgs,
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
  StripeSetupIntent,
  StripeSubscriptionItem,
  StripeSubscriptionSchedule,
  StripeSearchChargesArgs,
  StripeSearchInvoicesArgs,
  StripeSearchPaymentIntentsArgs,
  StripeSearchSubscriptionsArgs,
  StripeTaxId,
  StripeRetrieveCustomerArgs,
  StripeSdkPort,
  StripeSearchCustomersArgs,
  StripePreviewCreditNoteArgs,
  StripeSubscriptionResult,
  StripeUpdateChargeArgs,
  StripeUpdateRefundArgs,
  StripeUpdateSubscriptionItemArgs,
  StripeUpdateSubscriptionScheduleArgs,
  StripeVoidCreditNoteArgs,
  StripeUpdateCustomerArgs,
  StripeUpdateDisputeArgs,
  StripeUpdateSubscriptionArgs,
  StripeResumeSubscriptionArgs,
} from "./types.js";

export class StripeSdk extends BaseSdkPort<CreateStripeClient> implements StripeSdkPort {
  constructor(options: {
    createClient: CreateStripeClient;
    runtime?: ProviderSdkRuntime;
    callLog?: ProviderSdkCallLog;
  }) {
    super({
      providerId: "stripe",
      createClient: options.createClient,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async retrieveCustomer(args: StripeRetrieveCustomerArgs): Promise<StripeCustomer> {
    const method = "stripe.customers.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const customer = await stripe.customers.retrieve(args.customerId);
      if ("deleted" in customer && customer.deleted) {
        throw new Error("customer_not_found");
      }

      const response: StripeCustomer = {
        ...customer,
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async searchCustomers(args: StripeSearchCustomersArgs): Promise<StripeCustomer[]> {
    const method = "stripe.customers.search";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.customers.search({
        query: args.query,
        limit: args.limit,
      });
      const customers = response.data as unknown as StripeCustomer[];
      this.captureOk(args.namespace, method, normalizedArgs, customers);
      return customers;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
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

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.customers.update(
        args.customerId,
        {
          ...(typeof args.email === "string" ? { email: args.email } : {}),
          ...(typeof args.name === "string" ? { name: args.name } : {}),
          ...(typeof args.phone === "string" ? { phone: args.phone } : {}),
          ...(args.metadata ? { metadata: args.metadata } : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      if ("deleted" in response && response.deleted) {
        throw new Error("customer_not_found");
      }

      const normalizedResponse: StripeCustomer = {
        ...response,
      };
      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listCharges(args: StripeListChargesArgs): Promise<StripeCharge[]> {
    const method = "stripe.charges.list";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.charges
        .list({
          customer: args.customerId,
          limit: 100,
        })
        .autoPagingToArray({ limit: 100 });

      const charges = response as unknown as StripeCharge[];
      this.captureOk(args.namespace, method, normalizedArgs, charges);
      return charges;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getCharge(args: StripeGetChargeArgs): Promise<StripeCharge> {
    const method = "stripe.charges.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      chargeId: args.chargeId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.charges.retrieve(args.chargeId);
      if ("deleted" in response && response.deleted) {
        throw new Error("charge_not_found");
      }
      const normalizedResponse: StripeCharge = {
        ...response,
      };
      this.captureOk(args.namespace, method, normalizedArgs, normalizedResponse);
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listInvoices(args: StripeListInvoicesArgs): Promise<StripeInvoice[]> {
    const method = "stripe.invoices.list";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.invoices
        .list({
          customer: args.customerId,
          limit: 100,
        })
        .autoPagingToArray({ limit: 100 });

      const invoices = response as unknown as StripeInvoice[];
      this.captureOk(args.namespace, method, normalizedArgs, invoices);
      return invoices;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getInvoice(args: StripeGetInvoiceArgs): Promise<StripeInvoice> {
    const method = "stripe.invoices.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      invoiceId: args.invoiceId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.invoices.retrieve(args.invoiceId);
      const normalizedResponse: StripeInvoice = {
        ...response,
      };
      this.captureOk(args.namespace, method, normalizedArgs, normalizedResponse);
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
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

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const invoicesApi = stripe.invoices as unknown as {
        createPreview?: (payload: Record<string, unknown>) => Promise<Stripe.Invoice>;
      };
      const payload: Record<string, unknown> = {
        customer: args.customerId,
      };

      if (typeof args.subscriptionId === "string") {
        payload.subscription = args.subscriptionId;
      }

      if (typeof args.priceId === "string") {
        payload.subscription_details = {
          items: [
            {
              price: args.priceId,
              quantity: typeof args.quantity === "number" ? args.quantity : 1,
            },
          ],
        };
      }

      if (typeof args.quantity === "number" && typeof args.priceId !== "string") {
        payload.subscription_details = {
          items: [
            {
              quantity: args.quantity,
            },
          ],
        };
      }

      if (typeof invoicesApi.createPreview !== "function") {
        throw new Error("preview_invoice_not_supported");
      }
      const response = await invoicesApi.createPreview(payload);
      const normalizedResponse: StripeInvoice = {
        ...response,
      };
      this.captureOk(args.namespace, method, normalizedArgs, normalizedResponse);
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
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

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.refunds.create(
        {
          charge: args.chargeId,
          amount: args.amount,
          currency: args.currency.toLowerCase(),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );

      const normalizedResponse: StripeRefund = {
        ...response,
      };

      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getRefund(args: StripeGetRefundArgs): Promise<StripeRefund> {
    const method = "stripe.refunds.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      refundId: args.refundId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.refunds.retrieve(args.refundId);
      const normalizedResponse: StripeRefund = {
        ...response,
      };
      this.captureOk(args.namespace, method, normalizedArgs, normalizedResponse);
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listRefunds(args: StripeListRefundsArgs): Promise<StripeRefund[]> {
    const method = "stripe.refunds.list";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.refunds
        .list({
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const refunds = response as unknown as StripeRefund[];
      this.captureOk(args.namespace, method, normalizedArgs, refunds);
      return refunds;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async cancelSubscription(args: StripeCancelSubscriptionArgs): Promise<StripeSubscriptionResult> {
    const method = "stripe.subscriptions.cancel";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
      atPeriodEnd: args.atPeriodEnd,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = args.atPeriodEnd
        ? await stripe.subscriptions.update(
            args.subscriptionId,
            {
              cancel_at_period_end: true,
            },
            args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
          )
        : await stripe.subscriptions.cancel(
            args.subscriptionId,
            {},
            args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
          );

      const normalizedResponse: StripeSubscriptionResult = {
        ...response,
      };

      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getSubscription(args: StripeGetSubscriptionArgs): Promise<StripeSubscriptionResult> {
    const method = "stripe.subscriptions.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.subscriptions.retrieve(args.subscriptionId);
      const normalizedResponse: StripeSubscriptionResult = {
        ...response,
      };
      this.captureOk(args.namespace, method, normalizedArgs, normalizedResponse);
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
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

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const updatePayload: Stripe.SubscriptionUpdateParams = {
        ...(typeof args.cancelAtPeriodEnd === "boolean"
          ? { cancel_at_period_end: args.cancelAtPeriodEnd }
          : {}),
        ...(typeof args.priceId === "string"
          ? {
              items: [
                {
                  price: args.priceId,
                  ...(typeof args.quantity === "number" ? { quantity: args.quantity } : {}),
                },
              ],
            }
          : {}),
        ...(typeof args.quantity === "number" && typeof args.priceId !== "string"
          ? {
              metadata: {
                quantity_override: String(args.quantity),
              },
            }
          : {}),
      };

      const response = await stripe.subscriptions.update(
        args.subscriptionId,
        updatePayload,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );

      const normalizedResponse: StripeSubscriptionResult = {
        ...response,
      };
      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async resumeSubscription(args: StripeResumeSubscriptionArgs): Promise<StripeSubscriptionResult> {
    const method = "stripe.subscriptions.resume";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.subscriptions.resume(
        args.subscriptionId,
        {},
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const normalizedResponse: StripeSubscriptionResult = {
        ...response,
      };
      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
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

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.customers.createBalanceTransaction(
        args.customerId,
        {
          amount: args.amount,
          currency: args.currency.toLowerCase(),
          description: args.reason,
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );

      const normalizedResponse: StripeBalanceTransactionResult = {
        ...response,
      };

      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async sendInvoice(args: StripeInvoiceWriteArgs): Promise<StripeInvoice> {
    const method = "stripe.invoices.sendInvoice";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      invoiceId: args.invoiceId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.invoices.sendInvoice(
        args.invoiceId,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const normalizedResponse: StripeInvoice = {
        ...response,
      };
      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async voidInvoice(args: StripeInvoiceWriteArgs): Promise<StripeInvoice> {
    const method = "stripe.invoices.voidInvoice";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      invoiceId: args.invoiceId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.invoices.voidInvoice(
        args.invoiceId,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const normalizedResponse: StripeInvoice = {
        ...response,
      };
      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async payInvoice(args: StripeInvoiceWriteArgs): Promise<StripeInvoice> {
    const method = "stripe.invoices.pay";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      invoiceId: args.invoiceId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.invoices.pay(
        args.invoiceId,
        {},
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
      );
      const normalizedResponse: StripeInvoice = {
        ...response,
      };
      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listPaymentMethods(args: StripeListPaymentMethodsArgs): Promise<StripePaymentMethod[]> {
    const method = "stripe.paymentMethods.list";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      type: args.type,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.paymentMethods
        .list({
          customer: args.customerId,
          type: args.type,
          limit: 100,
        })
        .autoPagingToArray({ limit: 100 });
      const paymentMethods = response as unknown as StripePaymentMethod[];
      this.captureOk(args.namespace, method, normalizedArgs, paymentMethods);
      return paymentMethods;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createCreditNote(args: StripeCreateCreditNoteArgs): Promise<StripeCreditNote> {
    const method = "stripe.creditNotes.create";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      invoiceId: args.invoiceId,
      amount: args.amount,
      reason: args.reason,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.creditNotes.create(
        {
          invoice: args.invoiceId,
          amount: args.amount,
          ...(typeof args.reason === "string"
            ? {
                reason: args.reason as unknown as Stripe.CreditNoteCreateParams.Reason,
              }
            : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const normalizedResponse: StripeCreditNote = {
        ...response,
      };
      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listCreditNotes(args: StripeListCreditNotesArgs): Promise<StripeCreditNote[]> {
    const method = "stripe.creditNotes.list";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.creditNotes
        .list({
          customer: args.customerId,
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const creditNotes = response as unknown as StripeCreditNote[];
      this.captureOk(args.namespace, method, normalizedArgs, creditNotes);
      return creditNotes;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getDispute(args: StripeGetDisputeArgs): Promise<StripeDispute> {
    const method = "stripe.disputes.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      disputeId: args.disputeId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.disputes.retrieve(args.disputeId);
      const normalizedResponse: StripeDispute = {
        ...response,
      };
      this.captureOk(args.namespace, method, normalizedArgs, normalizedResponse);
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listDisputes(args: StripeListDisputesArgs): Promise<StripeDispute[]> {
    const method = "stripe.disputes.list";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.disputes
        .list({
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const disputes = response as unknown as StripeDispute[];
      this.captureOk(args.namespace, method, normalizedArgs, disputes);
      return disputes;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async updateDispute(args: StripeUpdateDisputeArgs): Promise<StripeDispute> {
    const method = "stripe.disputes.update";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      disputeId: args.disputeId,
      evidenceSummary: args.evidenceSummary,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.disputes.update(
        args.disputeId,
        {
          evidence: {
            uncategorized_text: args.evidenceSummary,
          },
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const normalizedResponse: StripeDispute = {
        ...response,
      };
      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async closeDispute(args: StripeCloseDisputeArgs): Promise<StripeDispute> {
    const method = "stripe.disputes.close";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      disputeId: args.disputeId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.disputes.close(
        args.disputeId,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
      );
      const normalizedResponse: StripeDispute = {
        ...response,
      };
      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createPortalSession(args: StripeCreatePortalSessionArgs): Promise<StripePortalSession> {
    const method = "stripe.billingPortal.sessions.create";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      returnUrl: args.returnUrl,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.billingPortal.sessions.create(
        {
          customer: args.customerId,
          return_url: args.returnUrl,
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const normalizedResponse: StripePortalSession = {
        ...response,
      };
      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listBalanceTransactions(
    args: StripeListBalanceTransactionsArgs,
  ): Promise<StripeBalanceTransactionResult[]> {
    const method = "stripe.customers.listBalanceTransactions";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.customers
        .listBalanceTransactions(args.customerId, {
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const transactions = response as unknown as StripeBalanceTransactionResult[];
      this.captureOk(args.namespace, method, normalizedArgs, transactions);
      return transactions;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async searchCharges(args: StripeSearchChargesArgs): Promise<StripeCharge[]> {
    const method = "stripe.charges.search";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const chargesApi = stripe.charges as unknown as {
        search?: (
          params: Stripe.ChargeSearchParams,
        ) => Promise<Stripe.ApiSearchResult<Stripe.Charge>>;
      };
      if (typeof chargesApi.search !== "function") {
        throw new Error("search_charges_not_supported");
      }
      const response = await chargesApi.search({
        query: args.query,
        limit: Math.max(1, args.limit),
      });
      const charges = response.data as unknown as StripeCharge[];
      this.captureOk(args.namespace, method, normalizedArgs, charges);
      return charges;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async searchSubscriptions(
    args: StripeSearchSubscriptionsArgs,
  ): Promise<StripeSubscriptionResult[]> {
    const method = "stripe.subscriptions.search";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const subscriptionsApi = stripe.subscriptions as unknown as {
        search?: (
          params: Stripe.SubscriptionSearchParams,
        ) => Promise<Stripe.ApiSearchResult<Stripe.Subscription>>;
      };
      if (typeof subscriptionsApi.search !== "function") {
        throw new Error("search_subscriptions_not_supported");
      }
      const response = await subscriptionsApi.search({
        query: args.query,
        limit: Math.max(1, args.limit),
      });
      const subscriptions = response.data as unknown as StripeSubscriptionResult[];
      this.captureOk(args.namespace, method, normalizedArgs, subscriptions);
      return subscriptions;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async searchInvoices(args: StripeSearchInvoicesArgs): Promise<StripeInvoice[]> {
    const method = "stripe.invoices.search";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const invoicesApi = stripe.invoices as unknown as {
        search?: (
          params: Stripe.InvoiceSearchParams,
        ) => Promise<Stripe.ApiSearchResult<Stripe.Invoice>>;
      };
      if (typeof invoicesApi.search !== "function") {
        throw new Error("search_invoices_not_supported");
      }
      const response = await invoicesApi.search({
        query: args.query,
        limit: Math.max(1, args.limit),
      });
      const invoices = response.data as unknown as StripeInvoice[];
      this.captureOk(args.namespace, method, normalizedArgs, invoices);
      return invoices;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getPaymentIntent(args: StripeGetPaymentIntentArgs): Promise<StripePaymentIntent> {
    const method = "stripe.paymentIntents.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      paymentIntentId: args.paymentIntentId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.paymentIntents.retrieve(args.paymentIntentId);
      const paymentIntent = response as unknown as StripePaymentIntent;
      this.captureOk(args.namespace, method, normalizedArgs, paymentIntent);
      return paymentIntent;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listPaymentIntents(args: StripeListPaymentIntentsArgs): Promise<StripePaymentIntent[]> {
    const method = "stripe.paymentIntents.list";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.paymentIntents
        .list({
          customer: args.customerId,
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const intents = response as unknown as StripePaymentIntent[];
      this.captureOk(args.namespace, method, normalizedArgs, intents);
      return intents;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async searchPaymentIntents(args: StripeSearchPaymentIntentsArgs): Promise<StripePaymentIntent[]> {
    const method = "stripe.paymentIntents.search";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const intentsApi = stripe.paymentIntents as unknown as {
        search?: (
          params: Stripe.PaymentIntentSearchParams,
        ) => Promise<Stripe.ApiSearchResult<Stripe.PaymentIntent>>;
      };
      if (typeof intentsApi.search !== "function") {
        throw new Error("search_payment_intents_not_supported");
      }
      const response = await intentsApi.search({
        query: args.query,
        limit: Math.max(1, args.limit),
      });
      const intents = response.data as unknown as StripePaymentIntent[];
      this.captureOk(args.namespace, method, normalizedArgs, intents);
      return intents;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async detachPaymentMethod(args: StripeDetachPaymentMethodArgs): Promise<StripePaymentMethod> {
    const method = "stripe.paymentMethods.detach";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      paymentMethodId: args.paymentMethodId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const paymentMethodsApi = stripe.paymentMethods as unknown as {
        detach?: (
          id: string,
          params?: Stripe.PaymentMethodDetachParams,
          opts?: Stripe.RequestOptions,
        ) => Promise<Stripe.PaymentMethod>;
      };
      if (typeof paymentMethodsApi.detach !== "function") {
        throw new Error("detach_payment_method_not_supported");
      }
      const response = await paymentMethodsApi.detach(
        args.paymentMethodId,
        {},
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const paymentMethod = response as unknown as StripePaymentMethod;
      this.captureOk(args.namespace, method, normalizedArgs, paymentMethod, args.idempotencyKey);
      return paymentMethod;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async cancelRefund(args: StripeCancelRefundArgs): Promise<StripeRefund> {
    const method = "stripe.refunds.cancel";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      refundId: args.refundId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const refundsApi = stripe.refunds as unknown as {
        cancel?: (id: string, opts?: Stripe.RequestOptions) => Promise<Stripe.Refund>;
      };
      if (typeof refundsApi.cancel !== "function") {
        throw new Error("cancel_refund_not_supported");
      }
      const response = await refundsApi.cancel(
        args.refundId,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const refund = response as unknown as StripeRefund;
      this.captureOk(args.namespace, method, normalizedArgs, refund, args.idempotencyKey);
      return refund;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updateRefund(args: StripeUpdateRefundArgs): Promise<StripeRefund> {
    const method = "stripe.refunds.update";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      refundId: args.refundId,
      metadata: args.metadata,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const refundsApi = stripe.refunds as unknown as {
        update?: (
          id: string,
          params: Stripe.RefundUpdateParams,
          opts?: Stripe.RequestOptions,
        ) => Promise<Stripe.Refund>;
      };
      if (typeof refundsApi.update !== "function") {
        throw new Error("update_refund_not_supported");
      }
      const response = await refundsApi.update(
        args.refundId,
        {
          metadata: args.metadata,
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const refund = response as unknown as StripeRefund;
      this.captureOk(args.namespace, method, normalizedArgs, refund, args.idempotencyKey);
      return refund;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getCoupon(args: StripeGetCouponArgs): Promise<StripeCoupon> {
    const method = "stripe.coupons.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      couponId: args.couponId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.coupons.retrieve(args.couponId);
      const coupon = response as unknown as StripeCoupon;
      this.captureOk(args.namespace, method, normalizedArgs, coupon);
      return coupon;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listCoupons(args: StripeListCouponsArgs): Promise<StripeCoupon[]> {
    const method = "stripe.coupons.list";
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.coupons
        .list({
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const coupons = response as unknown as StripeCoupon[];
      this.captureOk(args.namespace, method, normalizedArgs, coupons);
      return coupons;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getPromotionCode(args: StripeGetPromotionCodeArgs): Promise<StripePromotionCode> {
    const method = "stripe.promotionCodes.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      promotionCodeId: args.promotionCodeId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.promotionCodes.retrieve(args.promotionCodeId);
      const promotionCode = response as unknown as StripePromotionCode;
      this.captureOk(args.namespace, method, normalizedArgs, promotionCode);
      return promotionCode;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listPromotionCodes(args: StripeListPromotionCodesArgs): Promise<StripePromotionCode[]> {
    const method = "stripe.promotionCodes.list";
    const normalizedArgs = {
      namespace: args.namespace,
      code: args.code,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.promotionCodes
        .list({
          ...(typeof args.code === "string" ? { code: args.code } : {}),
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const promotionCodes = response as unknown as StripePromotionCode[];
      this.captureOk(args.namespace, method, normalizedArgs, promotionCodes);
      return promotionCodes;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createInvoiceItem(args: StripeCreateInvoiceItemArgs): Promise<StripeInvoiceItem> {
    const method = "stripe.invoiceItems.create";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      amount: args.amount,
      currency: args.currency,
      description: args.description,
      invoiceId: args.invoiceId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.invoiceItems.create(
        {
          customer: args.customerId,
          amount: args.amount,
          currency: args.currency.toLowerCase(),
          ...(typeof args.description === "string" ? { description: args.description } : {}),
          ...(typeof args.invoiceId === "string" ? { invoice: args.invoiceId } : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const invoiceItem = response as unknown as StripeInvoiceItem;
      this.captureOk(args.namespace, method, normalizedArgs, invoiceItem, args.idempotencyKey);
      return invoiceItem;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deleteInvoiceItem(args: StripeDeleteInvoiceItemArgs): Promise<StripeDeletedInvoiceItem> {
    const method = "stripe.invoiceItems.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      invoiceItemId: args.invoiceItemId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.invoiceItems.del(
        args.invoiceItemId,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const deletedItem = response as unknown as StripeDeletedInvoiceItem;
      this.captureOk(args.namespace, method, normalizedArgs, deletedItem, args.idempotencyKey);
      return deletedItem;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getProduct(args: StripeGetProductArgs): Promise<StripeProduct> {
    const method = "stripe.products.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      productId: args.productId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.products.retrieve(args.productId);
      const product = response as unknown as StripeProduct;
      this.captureOk(args.namespace, method, normalizedArgs, product);
      return product;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listProducts(args: StripeListProductsArgs): Promise<StripeProduct[]> {
    const method = "stripe.products.list";
    const normalizedArgs = {
      namespace: args.namespace,
      active: args.active,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.products
        .list({
          ...(typeof args.active === "boolean" ? { active: args.active } : {}),
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const products = response as unknown as StripeProduct[];
      this.captureOk(args.namespace, method, normalizedArgs, products);
      return products;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getPrice(args: StripeGetPriceArgs): Promise<StripePrice> {
    const method = "stripe.prices.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      priceId: args.priceId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.prices.retrieve(args.priceId);
      const price = response as unknown as StripePrice;
      this.captureOk(args.namespace, method, normalizedArgs, price);
      return price;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listPrices(args: StripeListPricesArgs): Promise<StripePrice[]> {
    const method = "stripe.prices.list";
    const normalizedArgs = {
      namespace: args.namespace,
      productId: args.productId,
      active: args.active,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const response = await stripe.prices
        .list({
          ...(typeof args.productId === "string" ? { product: args.productId } : {}),
          ...(typeof args.active === "boolean" ? { active: args.active } : {}),
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const prices = response as unknown as StripePrice[];
      this.captureOk(args.namespace, method, normalizedArgs, prices);
      return prices;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listSubscriptionItems(
    args: StripeListSubscriptionItemsArgs,
  ): Promise<StripeSubscriptionItem[]> {
    const method = "stripe.subscriptionItems.list";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (!stripe.subscriptionItems?.list) {
        throw new Error("subscription_items_not_supported");
      }
      const response = await stripe.subscriptionItems
        .list({
          subscription: args.subscriptionId,
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const items = response as unknown as StripeSubscriptionItem[];
      this.captureOk(args.namespace, method, normalizedArgs, items);
      return items;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createSubscriptionItem(
    args: StripeCreateSubscriptionItemArgs,
  ): Promise<StripeSubscriptionItem> {
    const method = "stripe.subscriptionItems.create";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
      priceId: args.priceId,
      quantity: args.quantity,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (!stripe.subscriptionItems?.create) {
        throw new Error("create_subscription_item_not_supported");
      }
      const response = await stripe.subscriptionItems.create(
        {
          subscription: args.subscriptionId,
          price: args.priceId,
          ...(typeof args.quantity === "number" ? { quantity: args.quantity } : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const item = response as unknown as StripeSubscriptionItem;
      this.captureOk(args.namespace, method, normalizedArgs, item, args.idempotencyKey);
      return item;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updateSubscriptionItem(
    args: StripeUpdateSubscriptionItemArgs,
  ): Promise<StripeSubscriptionItem> {
    const method = "stripe.subscriptionItems.update";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionItemId: args.subscriptionItemId,
      quantity: args.quantity,
      priceId: args.priceId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (!stripe.subscriptionItems?.update) {
        throw new Error("update_subscription_item_not_supported");
      }
      const response = await stripe.subscriptionItems.update(
        args.subscriptionItemId,
        {
          ...(typeof args.quantity === "number" ? { quantity: args.quantity } : {}),
          ...(typeof args.priceId === "string" ? { price: args.priceId } : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const item = response as unknown as StripeSubscriptionItem;
      this.captureOk(args.namespace, method, normalizedArgs, item, args.idempotencyKey);
      return item;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deleteSubscriptionItem(
    args: StripeDeleteSubscriptionItemArgs,
  ): Promise<StripeDeletedSubscriptionItem> {
    const method = "stripe.subscriptionItems.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionItemId: args.subscriptionItemId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (!stripe.subscriptionItems?.del) {
        throw new Error("delete_subscription_item_not_supported");
      }
      const response = await stripe.subscriptionItems.del(
        args.subscriptionItemId,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const deleted = response as unknown as StripeDeletedSubscriptionItem;
      this.captureOk(args.namespace, method, normalizedArgs, deleted, args.idempotencyKey);
      return deleted;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getSubscriptionSchedule(
    args: StripeGetSubscriptionScheduleArgs,
  ): Promise<StripeSubscriptionSchedule> {
    const method = "stripe.subscriptionSchedules.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      subscriptionScheduleId: args.subscriptionScheduleId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (!stripe.subscriptionSchedules?.retrieve) {
        throw new Error("retrieve_subscription_schedule_not_supported");
      }
      const response = await stripe.subscriptionSchedules.retrieve(args.subscriptionScheduleId);
      const schedule = response as unknown as StripeSubscriptionSchedule;
      this.captureOk(args.namespace, method, normalizedArgs, schedule);
      return schedule;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
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

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (!stripe.subscriptionSchedules?.list) {
        throw new Error("list_subscription_schedules_not_supported");
      }
      const response = await stripe.subscriptionSchedules
        .list({
          ...(typeof args.customerId === "string" ? { customer: args.customerId } : {}),
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const schedules = response as unknown as StripeSubscriptionSchedule[];
      this.captureOk(args.namespace, method, normalizedArgs, schedules);
      return schedules;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async updateSubscriptionSchedule(
    args: StripeUpdateSubscriptionScheduleArgs,
  ): Promise<StripeSubscriptionSchedule> {
    const method = "stripe.subscriptionSchedules.update";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionScheduleId: args.subscriptionScheduleId,
      endBehavior: args.endBehavior,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (!stripe.subscriptionSchedules?.update) {
        throw new Error("update_subscription_schedule_not_supported");
      }
      const response = await stripe.subscriptionSchedules.update(
        args.subscriptionScheduleId,
        typeof args.endBehavior === "string"
          ? {
              end_behavior: args.endBehavior as Stripe.SubscriptionScheduleUpdateParams.EndBehavior,
            }
          : {},
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const schedule = response as unknown as StripeSubscriptionSchedule;
      this.captureOk(args.namespace, method, normalizedArgs, schedule, args.idempotencyKey);
      return schedule;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async cancelSubscriptionSchedule(
    args: StripeCancelSubscriptionScheduleArgs,
  ): Promise<StripeSubscriptionSchedule> {
    const method = "stripe.subscriptionSchedules.cancel";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      subscriptionScheduleId: args.subscriptionScheduleId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (!stripe.subscriptionSchedules?.cancel) {
        throw new Error("cancel_subscription_schedule_not_supported");
      }
      const response = await stripe.subscriptionSchedules.cancel(
        args.subscriptionScheduleId,
        {},
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const schedule = response as unknown as StripeSubscriptionSchedule;
      this.captureOk(args.namespace, method, normalizedArgs, schedule, args.idempotencyKey);
      return schedule;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listCustomerTaxIds(args: StripeListCustomerTaxIdsArgs): Promise<StripeTaxId[]> {
    const method = "stripe.customers.listTaxIds";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.customers.listTaxIds !== "function") {
        throw new Error("list_tax_ids_not_supported");
      }
      const response = await stripe.customers
        .listTaxIds(args.customerId, {
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const taxIds = response as unknown as StripeTaxId[];
      this.captureOk(args.namespace, method, normalizedArgs, taxIds);
      return taxIds;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createCustomerTaxId(args: StripeCreateCustomerTaxIdArgs): Promise<StripeTaxId> {
    const method = "stripe.customers.createTaxId";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      type: args.type,
      value: args.value,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.customers.createTaxId !== "function") {
        throw new Error("create_tax_id_not_supported");
      }
      const response = await stripe.customers.createTaxId(
        args.customerId,
        {
          type: args.type as Stripe.CustomerCreateTaxIdParams.Type,
          value: args.value,
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const taxId = response as unknown as StripeTaxId;
      this.captureOk(args.namespace, method, normalizedArgs, taxId, args.idempotencyKey);
      return taxId;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deleteCustomerTaxId(args: StripeDeleteCustomerTaxIdArgs): Promise<StripeDeletedTaxId> {
    const method = "stripe.customers.deleteTaxId";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      taxId: args.taxId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.customers.deleteTaxId !== "function") {
        throw new Error("delete_tax_id_not_supported");
      }
      const response = await stripe.customers.deleteTaxId(
        args.customerId,
        args.taxId,
        {},
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const deletedTaxId = response as unknown as StripeDeletedTaxId;
      this.captureOk(args.namespace, method, normalizedArgs, deletedTaxId, args.idempotencyKey);
      return deletedTaxId;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
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

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.coupons.create !== "function") {
        throw new Error("create_coupon_not_supported");
      }
      const response = await stripe.coupons.create(
        {
          ...(typeof args.id === "string" ? { id: args.id } : {}),
          ...(typeof args.name === "string" ? { name: args.name } : {}),
          ...(typeof args.percentOff === "number" ? { percent_off: args.percentOff } : {}),
          ...(typeof args.amountOff === "number" ? { amount_off: args.amountOff } : {}),
          ...(typeof args.currency === "string" ? { currency: args.currency } : {}),
          ...(typeof args.duration === "string" ? { duration: args.duration } : {}),
          ...(typeof args.durationInMonths === "number"
            ? { duration_in_months: args.durationInMonths }
            : {}),
          ...(typeof args.maxRedemptions === "number"
            ? { max_redemptions: args.maxRedemptions }
            : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const coupon = response as unknown as StripeCoupon;
      this.captureOk(args.namespace, method, normalizedArgs, coupon, args.idempotencyKey);
      return coupon;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createPromotionCode(args: StripeCreatePromotionCodeArgs): Promise<StripePromotionCode> {
    const method = "stripe.promotionCodes.create";
    const normalizedArgs = {
      namespace: args.namespace,
      couponId: args.couponId,
      code: args.code,
      maxRedemptions: args.maxRedemptions,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.promotionCodes.create !== "function") {
        throw new Error("create_promotion_code_not_supported");
      }
      const response = await stripe.promotionCodes.create(
        {
          promotion: {
            type: "coupon",
            coupon: args.couponId,
          },
          ...(typeof args.code === "string" ? { code: args.code } : {}),
          ...(typeof args.maxRedemptions === "number"
            ? { max_redemptions: args.maxRedemptions }
            : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const promotionCode = response as unknown as StripePromotionCode;
      this.captureOk(args.namespace, method, normalizedArgs, promotionCode, args.idempotencyKey);
      return promotionCode;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getCheckoutSession(args: StripeGetCheckoutSessionArgs): Promise<StripeCheckoutSession> {
    const method = "stripe.checkout.sessions.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      checkoutSessionId: args.checkoutSessionId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.checkout?.sessions.retrieve !== "function") {
        throw new Error("retrieve_checkout_session_not_supported");
      }
      const response = await stripe.checkout.sessions.retrieve(args.checkoutSessionId);
      const session = response as unknown as StripeCheckoutSession;
      this.captureOk(args.namespace, method, normalizedArgs, session);
      return session;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createCheckoutSession(
    args: StripeCreateCheckoutSessionArgs,
  ): Promise<StripeCheckoutSession> {
    const method = "stripe.checkout.sessions.create";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      successUrl: args.successUrl,
      cancelUrl: args.cancelUrl,
      mode: args.mode,
      priceId: args.priceId,
      quantity: args.quantity,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.checkout?.sessions.create !== "function") {
        throw new Error("create_checkout_session_not_supported");
      }
      const lineItems: Array<Stripe.Checkout.SessionCreateParams.LineItem> =
        typeof args.priceId === "string"
          ? [
              {
                price: args.priceId,
                quantity: typeof args.quantity === "number" ? Math.max(1, args.quantity) : 1,
              },
            ]
          : [];
      const response = await stripe.checkout.sessions.create(
        {
          customer: args.customerId,
          success_url: args.successUrl,
          cancel_url: args.cancelUrl,
          mode: args.mode,
          ...(lineItems.length > 0 ? { line_items: lineItems } : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const session = response as unknown as StripeCheckoutSession;
      this.captureOk(args.namespace, method, normalizedArgs, session, args.idempotencyKey);
      return session;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createSetupIntent(args: StripeCreateSetupIntentArgs): Promise<StripeSetupIntent> {
    const method = "stripe.setupIntents.create";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      paymentMethodType: args.paymentMethodType,
      usage: args.usage,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.setupIntents?.create !== "function") {
        throw new Error("create_setup_intent_not_supported");
      }
      const response = await stripe.setupIntents.create(
        {
          customer: args.customerId,
          payment_method_types: [args.paymentMethodType ?? "card"],
          ...(typeof args.usage === "string" ? { usage: args.usage } : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const setupIntent = response as unknown as StripeSetupIntent;
      this.captureOk(args.namespace, method, normalizedArgs, setupIntent, args.idempotencyKey);
      return setupIntent;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listEvents(args: StripeListEventsArgs): Promise<StripeEvent[]> {
    const method = "stripe.events.list";
    const normalizedArgs = {
      namespace: args.namespace,
      type: args.type,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.events?.list !== "function") {
        throw new Error("list_events_not_supported");
      }
      const response = await stripe.events
        .list({
          ...(typeof args.type === "string" ? { type: args.type } : {}),
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const events = response as unknown as StripeEvent[];
      this.captureOk(args.namespace, method, normalizedArgs, events);
      return events;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getEvent(args: StripeGetEventArgs): Promise<StripeEvent> {
    const method = "stripe.events.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      eventId: args.eventId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.events?.retrieve !== "function") {
        throw new Error("retrieve_event_not_supported");
      }
      const response = await stripe.events.retrieve(args.eventId);
      const event = response as unknown as StripeEvent;
      this.captureOk(args.namespace, method, normalizedArgs, event);
      return event;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async updateCharge(args: StripeUpdateChargeArgs): Promise<StripeCharge> {
    const method = "stripe.charges.update";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      chargeId: args.chargeId,
      description: args.description,
      metadata: args.metadata,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.charges.update !== "function") {
        throw new Error("update_charge_not_supported");
      }
      const response = await stripe.charges.update(
        args.chargeId,
        {
          ...(typeof args.description === "string" ? { description: args.description } : {}),
          ...(args.metadata ? { metadata: args.metadata } : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const charge = response as unknown as StripeCharge;
      this.captureOk(args.namespace, method, normalizedArgs, charge, args.idempotencyKey);
      return charge;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
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

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.invoices.create !== "function") {
        throw new Error("create_invoice_not_supported");
      }
      const response = await stripe.invoices.create(
        {
          customer: args.customerId,
          ...(typeof args.autoAdvance === "boolean" ? { auto_advance: args.autoAdvance } : {}),
          ...(typeof args.collectionMethod === "string"
            ? { collection_method: args.collectionMethod }
            : {}),
          ...(typeof args.daysUntilDue === "number" ? { days_until_due: args.daysUntilDue } : {}),
          ...(typeof args.description === "string" ? { description: args.description } : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const invoice = response as unknown as StripeInvoice;
      this.captureOk(args.namespace, method, normalizedArgs, invoice, args.idempotencyKey);
      return invoice;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
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

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.subscriptions.create !== "function") {
        throw new Error("create_subscription_not_supported");
      }
      const response = await stripe.subscriptions.create(
        {
          customer: args.customerId,
          items: [
            {
              price: args.priceId,
              ...(typeof args.quantity === "number" ? { quantity: args.quantity } : {}),
            },
          ],
          ...(typeof args.trialPeriodDays === "number"
            ? { trial_period_days: args.trialPeriodDays }
            : {}),
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const subscription = response as unknown as StripeSubscriptionResult;
      this.captureOk(args.namespace, method, normalizedArgs, subscription, args.idempotencyKey);
      return subscription;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deleteCustomerDiscount(
    args: StripeDeleteCustomerDiscountArgs,
  ): Promise<StripeDeletedDiscount> {
    const method = "stripe.customers.deleteDiscount";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.customers.deleteDiscount !== "function") {
        throw new Error("delete_customer_discount_not_supported");
      }
      const response = await stripe.customers.deleteDiscount(
        args.customerId,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const deletedDiscount = response as unknown as StripeDeletedDiscount;
      this.captureOk(args.namespace, method, normalizedArgs, deletedDiscount, args.idempotencyKey);
      return deletedDiscount;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
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

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      if (typeof stripe.subscriptions.deleteDiscount !== "function") {
        throw new Error("delete_subscription_discount_not_supported");
      }
      const response = await stripe.subscriptions.deleteDiscount(
        args.subscriptionId,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const deletedDiscount = response as unknown as StripeDeletedDiscount;
      this.captureOk(args.namespace, method, normalizedArgs, deletedDiscount, args.idempotencyKey);
      return deletedDiscount;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getBalanceTransaction(
    args: StripeGetBalanceTransactionArgs,
  ): Promise<StripeBalanceTransactionResult> {
    const method = "stripe.balanceTransactions.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      balanceTransactionId: args.balanceTransactionId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const balanceTransactionsApi = stripe.balanceTransactions as
        | {
            retrieve?: (
              id: string,
              params?: Stripe.BalanceTransactionRetrieveParams,
              opts?: Stripe.RequestOptions,
            ) => Promise<Stripe.BalanceTransaction>;
          }
        | undefined;
      if (typeof balanceTransactionsApi?.retrieve !== "function") {
        throw new Error("retrieve_balance_transaction_not_supported");
      }
      const response = await balanceTransactionsApi.retrieve(args.balanceTransactionId);
      const transaction = response as unknown as StripeBalanceTransactionResult;
      this.captureOk(args.namespace, method, normalizedArgs, transaction);
      return transaction;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listGlobalBalanceTransactions(
    args: StripeListGlobalBalanceTransactionsArgs,
  ): Promise<StripeBalanceTransactionResult[]> {
    const method = "stripe.balanceTransactions.list";
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const balanceTransactionsApi = stripe.balanceTransactions as
        | {
            list?: (
              params?: Stripe.BalanceTransactionListParams,
              opts?: Stripe.RequestOptions,
            ) => Stripe.ApiListPromise<Stripe.BalanceTransaction>;
          }
        | undefined;
      if (typeof balanceTransactionsApi?.list !== "function") {
        throw new Error("list_balance_transactions_not_supported");
      }
      const response = await balanceTransactionsApi
        .list({
          limit: Math.max(1, args.limit),
        })
        .autoPagingToArray({ limit: Math.max(1, args.limit) });
      const transactions = response as unknown as StripeBalanceTransactionResult[];
      this.captureOk(args.namespace, method, normalizedArgs, transactions);
      return transactions;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getCreditNote(args: StripeGetCreditNoteArgs): Promise<StripeCreditNote> {
    const method = "stripe.creditNotes.retrieve";
    const normalizedArgs = {
      namespace: args.namespace,
      creditNoteId: args.creditNoteId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const creditNotesApi = stripe.creditNotes as {
        retrieve?: (id: string, opts?: Stripe.RequestOptions) => Promise<Stripe.CreditNote>;
      };
      if (typeof creditNotesApi.retrieve !== "function") {
        throw new Error("retrieve_credit_note_not_supported");
      }
      const response = await creditNotesApi.retrieve(args.creditNoteId);
      const creditNote = response as unknown as StripeCreditNote;
      this.captureOk(args.namespace, method, normalizedArgs, creditNote);
      return creditNote;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async previewCreditNote(args: StripePreviewCreditNoteArgs): Promise<StripeCreditNote> {
    const method = "stripe.creditNotes.preview";
    const normalizedArgs = {
      namespace: args.namespace,
      invoiceId: args.invoiceId,
      amount: args.amount,
      reason: args.reason,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const creditNotesApi = stripe.creditNotes as {
        preview?: (
          params: Stripe.CreditNotePreviewParams,
          opts?: Stripe.RequestOptions,
        ) => Promise<Stripe.CreditNote>;
      };
      if (typeof creditNotesApi.preview !== "function") {
        throw new Error("preview_credit_note_not_supported");
      }
      const response = await creditNotesApi.preview({
        invoice: args.invoiceId,
        amount: args.amount,
        ...(typeof args.reason === "string"
          ? { reason: args.reason as unknown as Stripe.CreditNotePreviewParams.Reason }
          : {}),
      });
      const creditNote = response as unknown as StripeCreditNote;
      this.captureOk(args.namespace, method, normalizedArgs, creditNote);
      return creditNote;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async voidCreditNote(args: StripeVoidCreditNoteArgs): Promise<StripeCreditNote> {
    const method = "stripe.creditNotes.voidCreditNote";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      creditNoteId: args.creditNoteId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const creditNotesApi = stripe.creditNotes as {
        voidCreditNote?: (
          id: string,
          params?: Stripe.CreditNoteVoidCreditNoteParams,
          opts?: Stripe.RequestOptions,
        ) => Promise<Stripe.CreditNote>;
      };
      if (typeof creditNotesApi.voidCreditNote !== "function") {
        throw new Error("void_credit_note_not_supported");
      }
      const response = await creditNotesApi.voidCreditNote(
        args.creditNoteId,
        {},
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const creditNote = response as unknown as StripeCreditNote;
      this.captureOk(args.namespace, method, normalizedArgs, creditNote, args.idempotencyKey);
      return creditNote;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async finalizeInvoice(args: StripeInvoiceMutateArgs): Promise<StripeInvoice> {
    const method = "stripe.invoices.finalizeInvoice";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      invoiceId: args.invoiceId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const invoicesApi = stripe.invoices as unknown as {
        finalizeInvoice?: (id: string, opts?: Stripe.RequestOptions) => Promise<Stripe.Invoice>;
      };
      if (typeof invoicesApi.finalizeInvoice !== "function") {
        throw new Error("finalize_invoice_not_supported");
      }
      const response = await invoicesApi.finalizeInvoice(
        args.invoiceId,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const invoice = response as unknown as StripeInvoice;
      this.captureOk(args.namespace, method, normalizedArgs, invoice, args.idempotencyKey);
      return invoice;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async markUncollectible(args: StripeInvoiceMutateArgs): Promise<StripeInvoice> {
    const method = "stripe.invoices.markUncollectible";
    const normalizedArgs = {
      namespace: args.namespace,
      customerId: args.customerId,
      invoiceId: args.invoiceId,
    };

    try {
      const stripe = this.createClient(args.accessToken, args.namespace);
      const invoicesApi = stripe.invoices as unknown as {
        markUncollectible?: (id: string, opts?: Stripe.RequestOptions) => Promise<Stripe.Invoice>;
      };
      if (typeof invoicesApi.markUncollectible !== "function") {
        throw new Error("mark_uncollectible_not_supported");
      }
      const response = await invoicesApi.markUncollectible(
        args.invoiceId,
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {},
      );
      const invoice = response as unknown as StripeInvoice;
      this.captureOk(args.namespace, method, normalizedArgs, invoice, args.idempotencyKey);
      return invoice;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }
}
