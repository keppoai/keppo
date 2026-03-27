import type Stripe from "stripe";

export interface StripeClient {
  customers: {
    retrieve(id: string): Promise<Stripe.Customer | Stripe.DeletedCustomer>;
    search(params: Stripe.CustomerSearchParams): Promise<Stripe.ApiSearchResult<Stripe.Customer>>;
    update(
      id: string,
      params: Stripe.CustomerUpdateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Customer>;
    createBalanceTransaction(
      id: string,
      params: Stripe.CustomerCreateBalanceTransactionParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.CustomerBalanceTransaction>;
    listBalanceTransactions(
      id: string,
      params?: Stripe.CustomerListBalanceTransactionsParams,
    ): Stripe.ApiListPromise<Stripe.CustomerBalanceTransaction>;
    listTaxIds?(
      id: string,
      params?: Stripe.CustomerListTaxIdsParams,
    ): Stripe.ApiListPromise<Stripe.TaxId>;
    createTaxId?(
      id: string,
      params: Stripe.CustomerCreateTaxIdParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.TaxId>;
    deleteTaxId?(
      id: string,
      taxId: string,
      params?: Stripe.CustomerDeleteTaxIdParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.DeletedTaxId>;
    deleteDiscount?(id: string, opts?: Stripe.RequestOptions): Promise<Stripe.DeletedDiscount>;
  };
  charges: {
    list(params: Stripe.ChargeListParams): Stripe.ApiListPromise<Stripe.Charge>;
    search?(params: Stripe.ChargeSearchParams): Promise<Stripe.ApiSearchResult<Stripe.Charge>>;
    retrieve(id: string): Promise<Stripe.Charge>;
    update?(
      id: string,
      params: Stripe.ChargeUpdateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Charge>;
  };
  invoices: {
    list(params: Stripe.InvoiceListParams): Stripe.ApiListPromise<Stripe.Invoice>;
    search?(params: Stripe.InvoiceSearchParams): Promise<Stripe.ApiSearchResult<Stripe.Invoice>>;
    retrieve(id: string): Promise<Stripe.Invoice>;
    createPreview?(params: Stripe.InvoiceCreatePreviewParams): Promise<Stripe.Invoice>;
    finalizeInvoice?(id: string, opts?: Stripe.RequestOptions): Promise<Stripe.Invoice>;
    markUncollectible?(id: string, opts?: Stripe.RequestOptions): Promise<Stripe.Invoice>;
    create?(
      params?: Stripe.InvoiceCreateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Invoice>;
    sendInvoice(id: string, opts?: Stripe.RequestOptions): Promise<Stripe.Invoice>;
    voidInvoice(id: string, opts?: Stripe.RequestOptions): Promise<Stripe.Invoice>;
    pay(
      id: string,
      params?: Stripe.InvoicePayParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Invoice>;
  };
  refunds: {
    create(params: Stripe.RefundCreateParams, opts?: Stripe.RequestOptions): Promise<Stripe.Refund>;
    retrieve(id: string): Promise<Stripe.Refund>;
    cancel?(id: string, opts?: Stripe.RequestOptions): Promise<Stripe.Refund>;
    update?(
      id: string,
      params: Stripe.RefundUpdateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Refund>;
    list(params?: Stripe.RefundListParams): Stripe.ApiListPromise<Stripe.Refund>;
  };
  subscriptions: {
    update(
      id: string,
      params?: Stripe.SubscriptionUpdateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Subscription>;
    cancel(
      id: string,
      params?: Stripe.SubscriptionCancelParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Subscription>;
    retrieve(id: string): Promise<Stripe.Subscription>;
    search?(
      params: Stripe.SubscriptionSearchParams,
    ): Promise<Stripe.ApiSearchResult<Stripe.Subscription>>;
    resume(
      id: string,
      params?: Stripe.SubscriptionResumeParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Subscription>;
    create?(
      params: Stripe.SubscriptionCreateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Subscription>;
    deleteDiscount?(id: string, opts?: Stripe.RequestOptions): Promise<Stripe.DeletedDiscount>;
  };
  paymentMethods: {
    list(params: Stripe.PaymentMethodListParams): Stripe.ApiListPromise<Stripe.PaymentMethod>;
    detach?(
      id: string,
      params?: Stripe.PaymentMethodDetachParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.PaymentMethod>;
  };
  paymentIntents: {
    retrieve(id: string): Promise<Stripe.PaymentIntent>;
    list(params?: Stripe.PaymentIntentListParams): Stripe.ApiListPromise<Stripe.PaymentIntent>;
    search?(
      params: Stripe.PaymentIntentSearchParams,
    ): Promise<Stripe.ApiSearchResult<Stripe.PaymentIntent>>;
  };
  coupons: {
    retrieve(id: string): Promise<Stripe.Coupon>;
    list(params?: Stripe.CouponListParams): Stripe.ApiListPromise<Stripe.Coupon>;
    create?(
      params: Stripe.CouponCreateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Coupon>;
  };
  promotionCodes: {
    retrieve(id: string): Promise<Stripe.PromotionCode>;
    list(params?: Stripe.PromotionCodeListParams): Stripe.ApiListPromise<Stripe.PromotionCode>;
    create?(
      params: Stripe.PromotionCodeCreateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.PromotionCode>;
  };
  invoiceItems: {
    create(
      params: Stripe.InvoiceItemCreateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.InvoiceItem>;
    del(id: string, opts?: Stripe.RequestOptions): Promise<Stripe.DeletedInvoiceItem>;
  };
  products: {
    retrieve(id: string): Promise<Stripe.Product>;
    list(params?: Stripe.ProductListParams): Stripe.ApiListPromise<Stripe.Product>;
  };
  prices: {
    retrieve(id: string): Promise<Stripe.Price>;
    list(params?: Stripe.PriceListParams): Stripe.ApiListPromise<Stripe.Price>;
  };
  subscriptionItems?: {
    list(
      params?: Stripe.SubscriptionItemListParams,
    ): Stripe.ApiListPromise<Stripe.SubscriptionItem>;
    create?(
      params: Stripe.SubscriptionItemCreateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.SubscriptionItem>;
    update?(
      id: string,
      params: Stripe.SubscriptionItemUpdateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.SubscriptionItem>;
    del?(id: string, opts?: Stripe.RequestOptions): Promise<Stripe.DeletedSubscriptionItem>;
  };
  subscriptionSchedules?: {
    retrieve?(id: string): Promise<Stripe.SubscriptionSchedule>;
    list?(
      params?: Stripe.SubscriptionScheduleListParams,
    ): Stripe.ApiListPromise<Stripe.SubscriptionSchedule>;
    update?(
      id: string,
      params?: Stripe.SubscriptionScheduleUpdateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.SubscriptionSchedule>;
    cancel?(
      id: string,
      params?: Stripe.SubscriptionScheduleCancelParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.SubscriptionSchedule>;
  };
  checkout?: {
    sessions: {
      retrieve?(id: string): Promise<Stripe.Checkout.Session>;
      create?(
        params: Stripe.Checkout.SessionCreateParams,
        opts?: Stripe.RequestOptions,
      ): Promise<Stripe.Checkout.Session>;
    };
  };
  setupIntents?: {
    create?(
      params: Stripe.SetupIntentCreateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.SetupIntent>;
  };
  events?: {
    list?(params?: Stripe.EventListParams): Stripe.ApiListPromise<Stripe.Event>;
    retrieve?(id: string): Promise<Stripe.Event>;
  };
  balanceTransactions?: {
    retrieve(id: string): Promise<Stripe.BalanceTransaction>;
    list(
      params?: Stripe.BalanceTransactionListParams,
    ): Stripe.ApiListPromise<Stripe.BalanceTransaction>;
  };
  creditNotes: {
    retrieve?(id: string): Promise<Stripe.CreditNote>;
    create(
      params: Stripe.CreditNoteCreateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.CreditNote>;
    preview?(params: Stripe.CreditNotePreviewParams): Promise<Stripe.CreditNote>;
    voidCreditNote?(
      id: string,
      params?: Stripe.CreditNoteVoidCreditNoteParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.CreditNote>;
    list(params?: Stripe.CreditNoteListParams): Stripe.ApiListPromise<Stripe.CreditNote>;
  };
  disputes: {
    retrieve(id: string): Promise<Stripe.Dispute>;
    list(params?: Stripe.DisputeListParams): Stripe.ApiListPromise<Stripe.Dispute>;
    update(
      id: string,
      params: Stripe.DisputeUpdateParams,
      opts?: Stripe.RequestOptions,
    ): Promise<Stripe.Dispute>;
    close(id: string, opts?: Stripe.RequestOptions): Promise<Stripe.Dispute>;
  };
  billingPortal: {
    sessions: {
      create(
        params: Stripe.BillingPortal.SessionCreateParams,
        opts?: Stripe.RequestOptions,
      ): Promise<Stripe.BillingPortal.Session>;
    };
  };
}

export type CreateStripeClient = (accessToken: string, namespace?: string) => StripeClient;
