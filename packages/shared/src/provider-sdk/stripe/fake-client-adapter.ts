import type Stripe from "stripe";

import type { CreateStripeClient, StripeClient } from "./client-interface.js";
import type { InMemoryStripeSdk, StripeNamespaceState } from "./fake-client-runtime.js";

const toApiListPromise = <TItem>(
  itemsPromise: Promise<TItem[]>,
  defaultLimit?: number,
): Stripe.ApiListPromise<TItem> => {
  return {
    autoPagingToArray: async (options?: { limit?: number }) => {
      const items = await itemsPromise;
      const limit = Math.max(1, options?.limit ?? defaultLimit ?? items.length);
      return items.slice(0, limit);
    },
  } as unknown as Stripe.ApiListPromise<TItem>;
};

const toApiSearchResult = <TItem>(url: string, items: TItem[]): Stripe.ApiSearchResult<TItem> => {
  return {
    object: "search_result",
    has_more: false,
    next_page: null,
    total_count: items.length,
    url,
    data: items,
  } as Stripe.ApiSearchResult<TItem>;
};

const getStateForNamespace = (
  engine: InMemoryStripeSdk,
  namespace?: string,
): StripeNamespaceState => {
  return (
    engine as unknown as { getState: (currentNamespace?: string) => StripeNamespaceState }
  ).getState(namespace);
};

const getIdempotencyKey = (opts?: Stripe.RequestOptions): string | undefined => {
  const value = (opts as { idempotencyKey?: unknown } | undefined)?.idempotencyKey;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const readStringId = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.trim().length > 0 ? id : undefined;
  }
  return undefined;
};

const findSubscriptionCustomerId = (
  state: StripeNamespaceState,
  subscriptionId: string,
): string | undefined => {
  for (const customer of Object.values(state.customers)) {
    const match = customer.subscriptions.find(
      (subscription) => String(subscription.id ?? "") === subscriptionId,
    );
    if (match) {
      return customer.id;
    }
  }
  return undefined;
};

class BoundFakeStripeClient implements StripeClient {
  constructor(
    private readonly engine: InMemoryStripeSdk,
    private readonly accessToken: string,
    private readonly namespace?: string,
  ) {}

  private getState(): StripeNamespaceState {
    return getStateForNamespace(this.engine, this.namespace);
  }

  private resolveCustomerId<TRecord extends { customer?: string }>(
    read: (state: StripeNamespaceState) => Record<string, TRecord>,
    resourceId: string,
  ): string {
    return read(this.getState())[resourceId]?.customer ?? "cus_100";
  }

  private resolveCustomerIdForSubscription(subscriptionId: string): string {
    return findSubscriptionCustomerId(this.getState(), subscriptionId) ?? "cus_100";
  }

  private resolveDefaultCustomerId(): string {
    const [firstCustomerId] = Object.keys(this.getState().customers);
    return firstCustomerId ?? "cus_100";
  }

  private withContext<TArgs extends object>(
    args: TArgs,
  ): TArgs & { accessToken: string; namespace?: string } {
    return {
      ...args,
      accessToken: this.accessToken,
      ...(typeof this.namespace === "string" ? { namespace: this.namespace } : {}),
    };
  }

  private getLimit(limit?: number): number {
    return Math.max(1, limit ?? 20);
  }

  private toListPromise<TItem>(
    itemsPromise: Promise<TItem[]>,
    limit?: number,
  ): Stripe.ApiListPromise<TItem> {
    return toApiListPromise(itemsPromise, limit);
  }

  private async callEngine<TArgs extends object, TResult>(
    run: (args: TArgs & { accessToken: string; namespace?: string }) => Promise<TResult>,
    args: TArgs,
  ): Promise<TResult> {
    return run.call(this.engine, this.withContext(args));
  }

  private async getResource<TResult>(
    resourceId: string,
    key: string,
    run: (args: never) => Promise<TResult>,
  ): Promise<TResult> {
    type EngineRun = (
      args: Record<string, string> & { accessToken: string; namespace?: string },
    ) => Promise<TResult>;
    return this.callEngine(
      run as unknown as EngineRun,
      { [key]: resourceId } as Record<string, string>,
    );
  }

  private async getCustomerResource<TRecord extends { customer?: string }, TResult>(
    read: (state: StripeNamespaceState) => Record<string, TRecord>,
    resourceId: string,
    key: string,
    run: (args: never) => Promise<TResult>,
  ): Promise<TResult> {
    type EngineRun = (
      args: { customerId: string } & Record<string, string> & {
          accessToken: string;
          namespace?: string;
        },
    ) => Promise<TResult>;
    return this.callEngine(
      run as unknown as EngineRun,
      {
        customerId: this.resolveCustomerId(read, resourceId),
        [key]: resourceId,
      } as { customerId: string } & Record<string, string>,
    );
  }

  private async mutateCustomerResource<
    TRecord extends { customer?: string },
    TArgs extends object,
    TResult,
  >(
    read: (state: StripeNamespaceState) => Record<string, TRecord>,
    resourceId: string,
    key: string,
    opts: Stripe.RequestOptions | undefined,
    run: (args: never) => Promise<TResult>,
    args: TArgs,
  ): Promise<TResult> {
    type EngineRun = (
      args: TArgs & { customerId: string; idempotencyKey?: string } & Record<string, string> & {
          accessToken: string;
          namespace?: string;
        },
    ) => Promise<TResult>;
    const idempotencyKey = getIdempotencyKey(opts);
    return this.callEngine(
      run as unknown as EngineRun,
      {
        ...args,
        customerId: this.resolveCustomerId(read, resourceId),
        [key]: resourceId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      } as TArgs & { customerId: string; idempotencyKey?: string } & Record<string, string>,
    );
  }

  private listEngine<TItem, TArgs extends object>(
    run: (args: TArgs & { accessToken: string; namespace?: string }) => Promise<TItem[]>,
    args: TArgs,
    limit?: number,
  ): Stripe.ApiListPromise<TItem> {
    return this.toListPromise(run.call(this.engine, this.withContext(args)), limit);
  }

  readonly customers: StripeClient["customers"] = {
    retrieve: async (id) => {
      return (await this.callEngine(this.engine.retrieveCustomer, {
        customerId: id,
      })) as unknown as Stripe.Customer;
    },
    search: async (params) => {
      const customers = await this.callEngine(this.engine.searchCustomers, {
        query: params.query,
        limit: params.limit ?? 20,
      });
      return toApiSearchResult("/v1/customers/search", customers as unknown as Stripe.Customer[]);
    },
    update: async (id, params, opts) => {
      return (await this.callEngine(this.engine.updateCustomer, {
        customerId: id,
        email: typeof params.email === "string" ? params.email : undefined,
        name: typeof params.name === "string" ? params.name : undefined,
        phone: typeof params.phone === "string" ? params.phone : undefined,
        metadata: params.metadata as Record<string, string> | undefined,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.Customer;
    },
    createBalanceTransaction: async (id, params, opts) => {
      return (await this.callEngine(this.engine.adjustBalance, {
        customerId: id,
        amount: Number(params.amount ?? 0),
        currency: String(params.currency ?? "usd"),
        reason: String(params.description ?? ""),
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.CustomerBalanceTransaction;
    },
    listBalanceTransactions: (id, params) => {
      const limit = this.getLimit(params?.limit);
      return this.listEngine(
        this.engine.listBalanceTransactions,
        { customerId: id, limit },
        limit,
      ) as unknown as Stripe.ApiListPromise<Stripe.CustomerBalanceTransaction>;
    },
    listTaxIds: (id, params) => {
      const limit = this.getLimit(params?.limit);
      return this.listEngine(
        this.engine.listCustomerTaxIds,
        { customerId: id, limit },
        limit,
      ) as unknown as Stripe.ApiListPromise<Stripe.TaxId>;
    },
    createTaxId: async (id, params, opts) => {
      return (await this.callEngine(this.engine.createCustomerTaxId, {
        customerId: id,
        type: String(params.type ?? "eu_vat"),
        value: String(params.value ?? ""),
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.TaxId;
    },
    deleteTaxId: async (id, taxId, _params, opts) => {
      return (await this.callEngine(this.engine.deleteCustomerTaxId, {
        customerId: id,
        taxId,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.DeletedTaxId;
    },
    deleteDiscount: async (id, opts) => {
      return (await this.callEngine(this.engine.deleteCustomerDiscount, {
        customerId: id,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.DeletedDiscount;
    },
  };

  readonly charges: StripeClient["charges"] = {
    list: (params) => {
      const customerId = readStringId(params.customer) ?? this.resolveDefaultCustomerId();
      return this.toListPromise(
        this.engine.listCharges(
          this.withContext({
            customerId,
          }),
        ) as unknown as Promise<Stripe.Charge[]>,
      );
    },
    search: async (params) => {
      const charges = await this.engine.searchCharges(
        this.withContext({
          query: params.query,
          limit: params.limit ?? 20,
        }),
      );
      return toApiSearchResult("/v1/charges/search", charges as unknown as Stripe.Charge[]);
    },
    retrieve: async (id) => {
      return (await this.engine.getCharge(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.charges, id),
          chargeId: id,
        }),
      )) as unknown as Stripe.Charge;
    },
    update: async (id, params, opts) => {
      return (await this.engine.updateCharge(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.charges, id),
          chargeId: id,
          description: typeof params.description === "string" ? params.description : undefined,
          metadata:
            params.metadata &&
            typeof params.metadata === "object" &&
            !Array.isArray(params.metadata)
              ? (params.metadata as Record<string, string>)
              : undefined,
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Charge;
    },
  };

  readonly invoices: StripeClient["invoices"] = {
    list: (params) => {
      const customerId = readStringId(params.customer) ?? this.resolveDefaultCustomerId();
      return this.toListPromise(
        this.engine.listInvoices(
          this.withContext({
            customerId,
          }),
        ) as unknown as Promise<Stripe.Invoice[]>,
      );
    },
    search: async (params) => {
      const invoices = await this.engine.searchInvoices(
        this.withContext({
          query: params.query,
          limit: params.limit ?? 20,
        }),
      );
      return toApiSearchResult("/v1/invoices/search", invoices as unknown as Stripe.Invoice[]);
    },
    retrieve: async (id) => {
      return (await this.engine.getInvoice(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.invoices, id),
          invoiceId: id,
        }),
      )) as unknown as Stripe.Invoice;
    },
    createPreview: async (params) => {
      return (await this.engine.previewInvoice(
        this.withContext({
          customerId: readStringId(params.customer) ?? this.resolveDefaultCustomerId(),
          subscriptionId: readStringId(params.subscription),
          priceId:
            params.subscription_details?.items && params.subscription_details.items.length > 0
              ? readStringId(params.subscription_details.items[0]?.price)
              : undefined,
          quantity:
            params.subscription_details?.items && params.subscription_details.items.length > 0
              ? params.subscription_details.items[0]?.quantity
              : undefined,
        }),
      )) as unknown as Stripe.Invoice;
    },
    create: async (params, opts) => {
      return (await this.engine.createInvoice(
        this.withContext({
          customerId: readStringId(params?.customer) ?? this.resolveDefaultCustomerId(),
          autoAdvance: params?.auto_advance,
          collectionMethod:
            params?.collection_method === "send_invoice" ? "send_invoice" : "charge_automatically",
          daysUntilDue: params?.days_until_due,
          description: typeof params?.description === "string" ? params.description : undefined,
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Invoice;
    },
    finalizeInvoice: async (id, opts) => {
      return (await this.engine.finalizeInvoice(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.invoices, id),
          invoiceId: id,
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Invoice;
    },
    markUncollectible: async (id, opts) => {
      return (await this.engine.markUncollectible(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.invoices, id),
          invoiceId: id,
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Invoice;
    },
    sendInvoice: async (id, opts) => {
      return (await this.engine.sendInvoice(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.invoices, id),
          invoiceId: id,
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Invoice;
    },
    voidInvoice: async (id, opts) => {
      return (await this.engine.voidInvoice(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.invoices, id),
          invoiceId: id,
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Invoice;
    },
    pay: async (id, _params, opts) => {
      return (await this.engine.payInvoice(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.invoices, id),
          invoiceId: id,
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Invoice;
    },
  };

  readonly refunds: StripeClient["refunds"] = {
    create: async (params, opts) => {
      const chargeId = readStringId(params.charge) ?? "";
      return (await this.engine.createRefund(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.charges, chargeId),
          chargeId,
          amount: Number(params.amount ?? 0),
          currency: String(params.currency ?? "usd"),
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Refund;
    },
    retrieve: async (id) => {
      return (await this.engine.getRefund(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.refunds, id),
          refundId: id,
        }),
      )) as unknown as Stripe.Refund;
    },
    cancel: async (id, opts) => {
      return (await this.engine.cancelRefund(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.refunds, id),
          refundId: id,
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Refund;
    },
    update: async (id, params, opts) => {
      return (await this.engine.updateRefund(
        this.withContext({
          customerId: this.resolveCustomerId((state) => state.refunds, id),
          refundId: id,
          metadata:
            params.metadata &&
            typeof params.metadata === "object" &&
            !Array.isArray(params.metadata)
              ? (params.metadata as Record<string, string>)
              : {},
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Refund;
    },
    list: (params) => {
      const limit = this.getLimit(params?.limit);
      return this.toListPromise(
        this.engine.listRefunds(
          this.withContext({
            customerId: this.resolveDefaultCustomerId(),
            limit,
          }),
        ) as unknown as Promise<Stripe.Refund[]>,
        limit,
      );
    },
  };

  readonly subscriptions: StripeClient["subscriptions"] = {
    update: async (id, params, opts) => {
      return (await this.engine.updateSubscription({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: this.resolveCustomerIdForSubscription(id),
        subscriptionId: id,
        priceId:
          params?.items && params.items.length > 0
            ? readStringId(params.items[0]?.price)
            : undefined,
        quantity: params?.items && params.items.length > 0 ? params.items[0]?.quantity : undefined,
        cancelAtPeriodEnd: params?.cancel_at_period_end,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.Subscription;
    },
    cancel: async (id, _params, opts) => {
      return (await this.engine.cancelSubscription({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: this.resolveCustomerIdForSubscription(id),
        subscriptionId: id,
        atPeriodEnd: false,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.Subscription;
    },
    retrieve: async (id) => {
      return (await this.engine.getSubscription({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: this.resolveCustomerIdForSubscription(id),
        subscriptionId: id,
      })) as unknown as Stripe.Subscription;
    },
    search: async (params) => {
      const subscriptions = await this.engine.searchSubscriptions({
        accessToken: this.accessToken,
        namespace: this.namespace,
        query: params.query,
        limit: params.limit ?? 20,
      });
      return toApiSearchResult(
        "/v1/subscriptions/search",
        subscriptions as unknown as Stripe.Subscription[],
      );
    },
    resume: async (id, _params, opts) => {
      return (await this.engine.resumeSubscription({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: this.resolveCustomerIdForSubscription(id),
        subscriptionId: id,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.Subscription;
    },
    create: async (params, opts) => {
      const firstItem =
        params.items && params.items.length > 0 && params.items[0] ? params.items[0] : undefined;
      return (await this.engine.createSubscription({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: readStringId(params.customer) ?? this.resolveDefaultCustomerId(),
        priceId: readStringId(firstItem?.price) ?? "price_seed_1",
        quantity:
          typeof firstItem?.quantity === "number" && Number.isFinite(firstItem.quantity)
            ? firstItem.quantity
            : undefined,
        trialPeriodDays:
          typeof params.trial_period_days === "number" ? params.trial_period_days : undefined,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.Subscription;
    },
    deleteDiscount: async (id, opts) => {
      return (await this.engine.deleteSubscriptionDiscount({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: this.resolveCustomerIdForSubscription(id),
        subscriptionId: id,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.DeletedDiscount;
    },
  };

  readonly paymentMethods: StripeClient["paymentMethods"] = {
    list: (params) => {
      const customerId = readStringId(params.customer) ?? this.resolveDefaultCustomerId();
      const type: "card" | "us_bank_account" =
        params.type === "us_bank_account" ? "us_bank_account" : "card";
      return this.listEngine(this.engine.listPaymentMethods, {
        customerId,
        type,
      }) as unknown as Stripe.ApiListPromise<Stripe.PaymentMethod>;
    },
    detach: async (id, _params, opts) => {
      return (await this.mutateCustomerResource(
        (state) => state.paymentMethods,
        id,
        "paymentMethodId",
        opts,
        this.engine.detachPaymentMethod,
        {},
      )) as unknown as Stripe.PaymentMethod;
    },
  };

  readonly paymentIntents: StripeClient["paymentIntents"] = {
    retrieve: async (id) => {
      return (await this.getCustomerResource(
        (state) => state.paymentIntents,
        id,
        "paymentIntentId",
        this.engine.getPaymentIntent,
      )) as unknown as Stripe.PaymentIntent;
    },
    list: (params) => {
      const customerId = readStringId(params?.customer) ?? this.resolveDefaultCustomerId();
      const limit = Math.max(1, params?.limit ?? 20);
      return this.listEngine(this.engine.listPaymentIntents, {
        customerId,
        limit,
      }) as unknown as Stripe.ApiListPromise<Stripe.PaymentIntent>;
    },
    search: async (params) => {
      const intents = await this.engine.searchPaymentIntents({
        accessToken: this.accessToken,
        namespace: this.namespace,
        query: params.query,
        limit: params.limit ?? 20,
      });
      return toApiSearchResult(
        "/v1/payment_intents/search",
        intents as unknown as Stripe.PaymentIntent[],
      );
    },
  };

  readonly coupons: StripeClient["coupons"] = {
    retrieve: async (id) => {
      return (await this.engine.getCoupon(
        this.withContext({ couponId: id }),
      )) as unknown as Stripe.Coupon;
    },
    list: (params) => {
      const limit = this.getLimit(params?.limit);
      return this.toListPromise(
        this.engine.listCoupons(this.withContext({ limit })) as unknown as Promise<Stripe.Coupon[]>,
        limit,
      );
    },
    create: async (params, opts) => {
      return (await this.engine.createCoupon(
        this.withContext({
          id: typeof params.id === "string" ? params.id : undefined,
          name: typeof params.name === "string" ? params.name : undefined,
          percentOff:
            typeof params.percent_off === "number" && Number.isFinite(params.percent_off)
              ? params.percent_off
              : undefined,
          amountOff:
            typeof params.amount_off === "number" && Number.isFinite(params.amount_off)
              ? params.amount_off
              : undefined,
          currency: typeof params.currency === "string" ? params.currency : undefined,
          duration:
            params.duration === "forever" ||
            params.duration === "repeating" ||
            params.duration === "once"
              ? params.duration
              : undefined,
          durationInMonths:
            typeof params.duration_in_months === "number" ? params.duration_in_months : undefined,
          maxRedemptions:
            typeof params.max_redemptions === "number" ? params.max_redemptions : undefined,
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.Coupon;
    },
  };

  readonly promotionCodes: StripeClient["promotionCodes"] = {
    retrieve: async (id) => {
      return (await this.engine.getPromotionCode(
        this.withContext({ promotionCodeId: id }),
      )) as unknown as Stripe.PromotionCode;
    },
    list: (params) => {
      const limit = this.getLimit(params?.limit);
      return this.toListPromise(
        this.engine.listPromotionCodes(
          this.withContext({
            code: typeof params?.code === "string" ? params.code : undefined,
            limit,
          }),
        ) as unknown as Promise<Stripe.PromotionCode[]>,
        limit,
      );
    },
    create: async (params, opts) => {
      const promotion =
        params.promotion && typeof params.promotion === "object" && !Array.isArray(params.promotion)
          ? (params.promotion as { coupon?: unknown })
          : {};
      return (await this.engine.createPromotionCode(
        this.withContext({
          couponId: readStringId(promotion.coupon) ?? "",
          code: typeof params.code === "string" ? params.code : undefined,
          maxRedemptions:
            typeof params.max_redemptions === "number" ? params.max_redemptions : undefined,
          idempotencyKey: getIdempotencyKey(opts),
        }),
      )) as unknown as Stripe.PromotionCode;
    },
  };

  readonly invoiceItems: StripeClient["invoiceItems"] = {
    create: async (params, opts) => {
      return (await this.engine.createInvoiceItem({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: readStringId(params.customer) ?? this.resolveDefaultCustomerId(),
        amount: Number(params.amount ?? 0),
        currency: String(params.currency ?? "usd"),
        description: typeof params.description === "string" ? params.description : undefined,
        invoiceId: readStringId(params.invoice),
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.InvoiceItem;
    },
    del: async (id, opts) => {
      return (await this.engine.deleteInvoiceItem({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: this.resolveCustomerId((state) => state.invoiceItems, id),
        invoiceItemId: id,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.DeletedInvoiceItem;
    },
  };

  readonly products: StripeClient["products"] = {
    retrieve: async (id) => {
      return (await this.getResource(
        id,
        "productId",
        this.engine.getProduct,
      )) as unknown as Stripe.Product;
    },
    list: (params) => {
      const limit = this.getLimit(params?.limit);
      return this.listEngine(
        this.engine.listProducts,
        { active: params?.active, limit },
        limit,
      ) as unknown as Stripe.ApiListPromise<Stripe.Product>;
    },
  };

  readonly prices: StripeClient["prices"] = {
    retrieve: async (id) => {
      return (await this.getResource(
        id,
        "priceId",
        this.engine.getPrice,
      )) as unknown as Stripe.Price;
    },
    list: (params) => {
      const limit = this.getLimit(params?.limit);
      return this.listEngine(
        this.engine.listPrices,
        {
          productId: readStringId(params?.product),
          active: params?.active,
          limit,
        },
        limit,
      ) as unknown as Stripe.ApiListPromise<Stripe.Price>;
    },
  };

  readonly subscriptionItems: NonNullable<StripeClient["subscriptionItems"]> = {
    list: (params) => {
      const subscriptionId = readStringId(params?.subscription) ?? "sub_100";
      const customerId = this.resolveCustomerIdForSubscription(subscriptionId);
      const limit = Math.max(1, params?.limit ?? 20);
      const promise = this.engine.listSubscriptionItems({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId,
        subscriptionId,
        limit,
      });
      return toApiListPromise(promise as unknown as Promise<Stripe.SubscriptionItem[]>);
    },
    create: async (params, opts) => {
      const subscriptionId = readStringId(params.subscription) ?? "sub_100";
      return (await this.engine.createSubscriptionItem({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: this.resolveCustomerIdForSubscription(subscriptionId),
        subscriptionId,
        priceId: readStringId(params.price) ?? "price_seed_1",
        quantity: typeof params.quantity === "number" ? params.quantity : undefined,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.SubscriptionItem;
    },
    update: async (id, params, opts) => {
      return (await this.engine.updateSubscriptionItem({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: this.resolveCustomerId((state) => state.subscriptionItems, id),
        subscriptionItemId: id,
        quantity: typeof params.quantity === "number" ? params.quantity : undefined,
        priceId: readStringId(params.price),
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.SubscriptionItem;
    },
    del: async (id, opts) => {
      return (await this.engine.deleteSubscriptionItem({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: this.resolveCustomerId((state) => state.subscriptionItems, id),
        subscriptionItemId: id,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.DeletedSubscriptionItem;
    },
  };

  readonly subscriptionSchedules: NonNullable<StripeClient["subscriptionSchedules"]> = {
    retrieve: async (id) => {
      return (await this.getResource(
        id,
        "subscriptionScheduleId",
        this.engine.getSubscriptionSchedule,
      )) as unknown as Stripe.SubscriptionSchedule;
    },
    list: (params) => {
      const limit = Math.max(1, params?.limit ?? 20);
      const customerId = readStringId(params?.customer);
      return this.listEngine(
        this.engine.listSubscriptionSchedules,
        { customerId, limit },
        limit,
      ) as unknown as Stripe.ApiListPromise<Stripe.SubscriptionSchedule>;
    },
    update: async (id, params, opts) => {
      return (await this.mutateCustomerResource(
        (state) => state.subscriptionSchedules,
        id,
        "subscriptionScheduleId",
        opts,
        this.engine.updateSubscriptionSchedule,
        {
          endBehavior: typeof params?.end_behavior === "string" ? params.end_behavior : undefined,
        },
      )) as unknown as Stripe.SubscriptionSchedule;
    },
    cancel: async (id, _params, opts) => {
      return (await this.mutateCustomerResource(
        (state) => state.subscriptionSchedules,
        id,
        "subscriptionScheduleId",
        opts,
        this.engine.cancelSubscriptionSchedule,
        {},
      )) as unknown as Stripe.SubscriptionSchedule;
    },
  };

  readonly checkout: NonNullable<StripeClient["checkout"]> = {
    sessions: {
      retrieve: async (id) => {
        return (await this.getResource(
          id,
          "checkoutSessionId",
          this.engine.getCheckoutSession,
        )) as unknown as Stripe.Checkout.Session;
      },
      create: async (params, opts) => {
        const firstItem =
          params.line_items && params.line_items.length > 0 && params.line_items[0]
            ? params.line_items[0]
            : undefined;
        return (await this.engine.createCheckoutSession({
          accessToken: this.accessToken,
          namespace: this.namespace,
          customerId: readStringId(params.customer) ?? this.resolveDefaultCustomerId(),
          successUrl: String(params.success_url ?? "https://example.test/success"),
          cancelUrl: String(params.cancel_url ?? "https://example.test/cancel"),
          mode: params.mode === "setup" || params.mode === "subscription" ? params.mode : "payment",
          priceId: readStringId(firstItem?.price),
          quantity: typeof firstItem?.quantity === "number" ? firstItem.quantity : undefined,
          idempotencyKey: getIdempotencyKey(opts),
        })) as unknown as Stripe.Checkout.Session;
      },
    },
  };

  readonly setupIntents: NonNullable<StripeClient["setupIntents"]> = {
    create: async (params, opts) => {
      const paymentMethodType: "card" | "us_bank_account" =
        Array.isArray(params.payment_method_types) && params.payment_method_types.length > 0
          ? params.payment_method_types[0] === "us_bank_account"
            ? "us_bank_account"
            : "card"
          : "card";
      const usage: "off_session" | "on_session" =
        params.usage === "on_session" ? "on_session" : "off_session";
      return (await this.callEngine(this.engine.createSetupIntent, {
        customerId: readStringId(params.customer) ?? this.resolveDefaultCustomerId(),
        paymentMethodType,
        usage,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.SetupIntent;
    },
  };

  readonly events: NonNullable<StripeClient["events"]> = {
    list: (params) => {
      const limit = Math.max(1, params?.limit ?? 20);
      return this.listEngine(
        this.engine.listEvents,
        {
          type: typeof params?.type === "string" ? params.type : undefined,
          limit,
        },
        limit,
      ) as unknown as Stripe.ApiListPromise<Stripe.Event>;
    },
    retrieve: async (id) => {
      return (await this.getResource(
        id,
        "eventId",
        this.engine.getEvent,
      )) as unknown as Stripe.Event;
    },
  };

  readonly balanceTransactions: NonNullable<StripeClient["balanceTransactions"]> = {
    retrieve: async (id) => {
      return (await this.getResource(
        id,
        "balanceTransactionId",
        this.engine.getBalanceTransaction,
      )) as unknown as Stripe.BalanceTransaction;
    },
    list: (params) => {
      const limit = Math.max(1, params?.limit ?? 20);
      return this.listEngine(
        this.engine.listGlobalBalanceTransactions,
        { limit },
        limit,
      ) as unknown as Stripe.ApiListPromise<Stripe.BalanceTransaction>;
    },
  };

  readonly creditNotes: StripeClient["creditNotes"] = {
    retrieve: async (id) => {
      return (await this.getResource(
        id,
        "creditNoteId",
        this.engine.getCreditNote,
      )) as unknown as Stripe.CreditNote;
    },
    create: async (params, opts) => {
      const invoiceId = readStringId(params.invoice) ?? "";
      return (await this.engine.createCreditNote({
        accessToken: this.accessToken,
        namespace: this.namespace,
        customerId: this.resolveCustomerId((state) => state.invoices, invoiceId),
        invoiceId,
        amount: Number(params.amount ?? 0),
        reason: typeof params.reason === "string" ? params.reason : undefined,
        idempotencyKey: getIdempotencyKey(opts),
      })) as unknown as Stripe.CreditNote;
    },
    preview: async (params) => {
      return (await this.engine.previewCreditNote({
        accessToken: this.accessToken,
        namespace: this.namespace,
        invoiceId: readStringId(params.invoice) ?? "in_cus_100_1",
        amount: Number(params.amount ?? 0),
        reason: typeof params.reason === "string" ? params.reason : undefined,
      })) as unknown as Stripe.CreditNote;
    },
    voidCreditNote: async (id, _params, opts) => {
      return (await this.mutateCustomerResource(
        (state) => state.creditNotes,
        id,
        "creditNoteId",
        opts,
        this.engine.voidCreditNote,
        {},
      )) as unknown as Stripe.CreditNote;
    },
    list: (params) => {
      const limit = Math.max(1, params?.limit ?? 20);
      return this.listEngine(
        this.engine.listCreditNotes,
        {
          customerId: this.resolveDefaultCustomerId(),
          limit,
        },
        limit,
      ) as unknown as Stripe.ApiListPromise<Stripe.CreditNote>;
    },
  };

  readonly disputes: StripeClient["disputes"] = {
    retrieve: async (id) => {
      return (await this.getCustomerResource(
        (state) => state.disputes,
        id,
        "disputeId",
        this.engine.getDispute,
      )) as unknown as Stripe.Dispute;
    },
    list: (params) => {
      const limit = Math.max(1, params?.limit ?? 20);
      return this.listEngine(
        this.engine.listDisputes,
        {
          customerId: this.resolveDefaultCustomerId(),
          limit,
        },
        limit,
      ) as unknown as Stripe.ApiListPromise<Stripe.Dispute>;
    },
    update: async (id, params, opts) => {
      return (await this.mutateCustomerResource(
        (state) => state.disputes,
        id,
        "disputeId",
        opts,
        this.engine.updateDispute,
        {
          evidenceSummary: String(params.evidence?.uncategorized_text ?? ""),
        },
      )) as unknown as Stripe.Dispute;
    },
    close: async (id, opts) => {
      return (await this.mutateCustomerResource(
        (state) => state.disputes,
        id,
        "disputeId",
        opts,
        this.engine.closeDispute,
        {},
      )) as unknown as Stripe.Dispute;
    },
  };

  readonly billingPortal: StripeClient["billingPortal"] = {
    sessions: {
      create: async (params, opts) => {
        return (await this.callEngine(this.engine.createPortalSession, {
          customerId: readStringId(params.customer) ?? this.resolveDefaultCustomerId(),
          returnUrl:
            typeof params.return_url === "string" ? params.return_url : "https://example.test",
          idempotencyKey: getIdempotencyKey(opts),
        })) as unknown as Stripe.BillingPortal.Session;
      },
    },
  };
}

export const createFakeStripeClient = (
  engine: InMemoryStripeSdk,
  accessToken: Parameters<CreateStripeClient>[0],
  namespace: Parameters<CreateStripeClient>[1],
): ReturnType<CreateStripeClient> => {
  return new BoundFakeStripeClient(engine, accessToken, namespace);
};
