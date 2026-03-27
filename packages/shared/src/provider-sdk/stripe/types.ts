import type Stripe from "stripe";
import type { ProviderSdkPort } from "../port.js";

export type StripeSdkContext = {
  accessToken: string;
  namespace?: string | undefined;
};

type StripeRecord = Record<string, unknown>;

export type StripeCustomer = Pick<Stripe.Customer, "id"> & {
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  balance?: number;
  metadata?: Record<string, string>;
  subscriptions?: unknown;
} & StripeRecord;

export type StripeCharge = Pick<Stripe.Charge, "id"> & {
  amount?: number;
  currency?: string;
  status?: string;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
} & StripeRecord;

export type StripeInvoice = Pick<Stripe.Invoice, "id"> & {
  amount_due?: number;
  status?: string | null;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  paid?: boolean;
} & StripeRecord;

export type StripeRefund = Pick<Stripe.Refund, "id"> & {
  object?: string;
  status?: string | null;
  amount?: number;
  currency?: string;
  charge?: string | Stripe.Charge | null;
  metadata?: Record<string, string> | null;
} & StripeRecord;

export type StripeSubscriptionResult = Pick<Stripe.Subscription, "id"> & {
  status?: string;
  cancel_at_period_end?: boolean;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer;
  items?: unknown;
} & StripeRecord;

export type StripeBalanceTransactionResult = Pick<Stripe.CustomerBalanceTransaction, "id"> & {
  amount?: number;
  currency?: string;
  description?: string | null;
  status?: string;
} & StripeRecord;

export type StripePaymentMethod = Pick<Stripe.PaymentMethod, "id"> & {
  type?: string;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
} & StripeRecord;

export type StripeCreditNote = Pick<Stripe.CreditNote, "id"> & {
  invoice?: string | Stripe.Invoice;
  amount?: number;
  reason?: string | null;
  status?: string;
} & StripeRecord;

export type StripeDispute = Pick<Stripe.Dispute, "id"> & {
  status?: string;
  reason?: string;
  charge?: string | Stripe.Charge;
} & StripeRecord;

export type StripePortalSession = Pick<Stripe.BillingPortal.Session, "id"> & {
  url?: string;
  customer?: string;
} & StripeRecord;

export type StripePaymentIntent = Pick<Stripe.PaymentIntent, "id"> & {
  status?: string;
  amount?: number;
  currency?: string;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
} & StripeRecord;

export type StripeCoupon = Pick<Stripe.Coupon, "id"> & {
  name?: string | null;
  valid?: boolean;
  percent_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
} & StripeRecord;

export type StripePromotionCode = Pick<Stripe.PromotionCode, "id"> & {
  code?: string;
  active?: boolean;
  coupon?: string | Stripe.Coupon;
} & StripeRecord;

export type StripeProduct = Pick<Stripe.Product, "id"> & {
  name?: string;
  active?: boolean;
  default_price?: string | Stripe.Price | null;
} & StripeRecord;

export type StripePrice = Pick<Stripe.Price, "id"> & {
  active?: boolean;
  currency?: string;
  unit_amount?: number | null;
  product?: string | Stripe.Product | Stripe.DeletedProduct;
} & StripeRecord;

export type StripeInvoiceItem = Pick<Stripe.InvoiceItem, "id"> & {
  amount?: number;
  currency?: string;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  invoice?: string | Stripe.Invoice | null;
  description?: string | null;
} & StripeRecord;

export type StripeDeletedInvoiceItem = Pick<Stripe.DeletedInvoiceItem, "id" | "deleted"> &
  StripeRecord;

export type StripeSubscriptionItem = Pick<Stripe.SubscriptionItem, "id"> & {
  subscription?: string | Stripe.Subscription;
  quantity?: number;
  price?: string | Stripe.Price;
} & StripeRecord;

export type StripeDeletedSubscriptionItem = Pick<Stripe.DeletedSubscriptionItem, "id" | "deleted"> &
  StripeRecord;

export type StripeSubscriptionSchedule = Pick<Stripe.SubscriptionSchedule, "id"> & {
  subscription?: string | Stripe.Subscription | null;
  status?: string;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
} & StripeRecord;

export type StripeTaxId = Pick<Stripe.TaxId, "id"> & {
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer;
  type?: string;
  value?: string;
} & StripeRecord;

export type StripeDeletedTaxId = Pick<Stripe.DeletedTaxId, "id" | "deleted"> & StripeRecord;

export type StripeCheckoutSession = Pick<Stripe.Checkout.Session, "id"> & {
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  status?: string | null;
  payment_status?: string;
  url?: string | null;
} & StripeRecord;

export type StripeSetupIntent = Pick<Stripe.SetupIntent, "id"> & {
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  status?: string;
  client_secret?: string | null;
} & StripeRecord;

export type StripeEvent = Pick<Stripe.Event, "id"> & {
  type?: string;
  created?: number;
} & StripeRecord;

export type StripeDeletedDiscount = {
  object?: string;
  deleted?: boolean;
} & StripeRecord;

export type StripeRetrieveCustomerArgs = StripeSdkContext & {
  customerId: string;
};

export type StripeSearchCustomersArgs = StripeSdkContext & {
  query: string;
  limit: number;
};

export type StripeUpdateCustomerArgs = StripeSdkContext & {
  customerId: string;
  email?: string | undefined;
  name?: string | undefined;
  phone?: string | undefined;
  metadata?: Record<string, string> | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeListChargesArgs = StripeSdkContext & {
  customerId: string;
};

export type StripeGetChargeArgs = StripeSdkContext & {
  customerId: string;
  chargeId: string;
};

export type StripeListInvoicesArgs = StripeSdkContext & {
  customerId: string;
};

export type StripeGetInvoiceArgs = StripeSdkContext & {
  customerId: string;
  invoiceId: string;
};

export type StripePreviewInvoiceArgs = StripeSdkContext & {
  customerId: string;
  subscriptionId?: string | undefined;
  priceId?: string | undefined;
  quantity?: number | undefined;
};

export type StripeCreateRefundArgs = StripeSdkContext & {
  customerId: string;
  chargeId: string;
  amount: number;
  currency: string;
  idempotencyKey?: string | undefined;
};

export type StripeGetRefundArgs = StripeSdkContext & {
  customerId: string;
  refundId: string;
};

export type StripeListRefundsArgs = StripeSdkContext & {
  customerId: string;
  limit: number;
};

export type StripeCancelSubscriptionArgs = StripeSdkContext & {
  customerId: string;
  subscriptionId: string;
  atPeriodEnd: boolean;
  idempotencyKey?: string | undefined;
};

export type StripeGetSubscriptionArgs = StripeSdkContext & {
  customerId: string;
  subscriptionId: string;
};

export type StripeUpdateSubscriptionArgs = StripeSdkContext & {
  customerId: string;
  subscriptionId: string;
  priceId?: string | undefined;
  quantity?: number | undefined;
  cancelAtPeriodEnd?: boolean | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeResumeSubscriptionArgs = StripeSdkContext & {
  customerId: string;
  subscriptionId: string;
  idempotencyKey?: string | undefined;
};

export type StripeAdjustBalanceArgs = StripeSdkContext & {
  customerId: string;
  amount: number;
  currency: string;
  reason: string;
  idempotencyKey?: string | undefined;
};

export type StripeInvoiceWriteArgs = StripeSdkContext & {
  customerId: string;
  invoiceId: string;
  idempotencyKey?: string | undefined;
};

export type StripeListPaymentMethodsArgs = StripeSdkContext & {
  customerId: string;
  type: "card" | "us_bank_account";
};

export type StripeCreateCreditNoteArgs = StripeSdkContext & {
  customerId: string;
  invoiceId: string;
  amount: number;
  reason?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeListCreditNotesArgs = StripeSdkContext & {
  customerId: string;
  limit: number;
};

export type StripeGetDisputeArgs = StripeSdkContext & {
  customerId: string;
  disputeId: string;
};

export type StripeListDisputesArgs = StripeSdkContext & {
  customerId: string;
  limit: number;
};

export type StripeUpdateDisputeArgs = StripeSdkContext & {
  customerId: string;
  disputeId: string;
  evidenceSummary: string;
  idempotencyKey?: string | undefined;
};

export type StripeCloseDisputeArgs = StripeSdkContext & {
  customerId: string;
  disputeId: string;
  idempotencyKey?: string | undefined;
};

export type StripeCreatePortalSessionArgs = StripeSdkContext & {
  customerId: string;
  returnUrl: string;
  idempotencyKey?: string | undefined;
};

export type StripeListBalanceTransactionsArgs = StripeSdkContext & {
  customerId: string;
  limit: number;
};

export type StripeSearchChargesArgs = StripeSdkContext & {
  query: string;
  limit: number;
};

export type StripeSearchSubscriptionsArgs = StripeSdkContext & {
  query: string;
  limit: number;
};

export type StripeSearchInvoicesArgs = StripeSdkContext & {
  query: string;
  limit: number;
};

export type StripeGetPaymentIntentArgs = StripeSdkContext & {
  customerId: string;
  paymentIntentId: string;
};

export type StripeListPaymentIntentsArgs = StripeSdkContext & {
  customerId: string;
  limit: number;
};

export type StripeSearchPaymentIntentsArgs = StripeSdkContext & {
  query: string;
  limit: number;
};

export type StripeDetachPaymentMethodArgs = StripeSdkContext & {
  customerId: string;
  paymentMethodId: string;
  idempotencyKey?: string | undefined;
};

export type StripeCancelRefundArgs = StripeSdkContext & {
  customerId: string;
  refundId: string;
  idempotencyKey?: string | undefined;
};

export type StripeUpdateRefundArgs = StripeSdkContext & {
  customerId: string;
  refundId: string;
  metadata: Record<string, string>;
  idempotencyKey?: string | undefined;
};

export type StripeGetCouponArgs = StripeSdkContext & {
  couponId: string;
};

export type StripeListCouponsArgs = StripeSdkContext & {
  limit: number;
};

export type StripeGetPromotionCodeArgs = StripeSdkContext & {
  promotionCodeId: string;
};

export type StripeListPromotionCodesArgs = StripeSdkContext & {
  code?: string | undefined;
  limit: number;
};

export type StripeCreateInvoiceItemArgs = StripeSdkContext & {
  customerId: string;
  amount: number;
  currency: string;
  description?: string | undefined;
  invoiceId?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeDeleteInvoiceItemArgs = StripeSdkContext & {
  customerId: string;
  invoiceItemId: string;
  idempotencyKey?: string | undefined;
};

export type StripeGetProductArgs = StripeSdkContext & {
  productId: string;
};

export type StripeListProductsArgs = StripeSdkContext & {
  active?: boolean | undefined;
  limit: number;
};

export type StripeGetPriceArgs = StripeSdkContext & {
  priceId: string;
};

export type StripeListPricesArgs = StripeSdkContext & {
  productId?: string | undefined;
  active?: boolean | undefined;
  limit: number;
};

export type StripeListSubscriptionItemsArgs = StripeSdkContext & {
  customerId: string;
  subscriptionId: string;
  limit: number;
};

export type StripeCreateSubscriptionItemArgs = StripeSdkContext & {
  customerId: string;
  subscriptionId: string;
  priceId: string;
  quantity?: number | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeUpdateSubscriptionItemArgs = StripeSdkContext & {
  customerId: string;
  subscriptionItemId: string;
  quantity?: number | undefined;
  priceId?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeDeleteSubscriptionItemArgs = StripeSdkContext & {
  customerId: string;
  subscriptionItemId: string;
  idempotencyKey?: string | undefined;
};

export type StripeGetSubscriptionScheduleArgs = StripeSdkContext & {
  subscriptionScheduleId: string;
};

export type StripeListSubscriptionSchedulesArgs = StripeSdkContext & {
  customerId?: string | undefined;
  limit: number;
};

export type StripeUpdateSubscriptionScheduleArgs = StripeSdkContext & {
  customerId: string;
  subscriptionScheduleId: string;
  endBehavior?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeCancelSubscriptionScheduleArgs = StripeSdkContext & {
  customerId: string;
  subscriptionScheduleId: string;
  idempotencyKey?: string | undefined;
};

export type StripeListCustomerTaxIdsArgs = StripeSdkContext & {
  customerId: string;
  limit: number;
};

export type StripeCreateCustomerTaxIdArgs = StripeSdkContext & {
  customerId: string;
  type: string;
  value: string;
  idempotencyKey?: string | undefined;
};

export type StripeDeleteCustomerTaxIdArgs = StripeSdkContext & {
  customerId: string;
  taxId: string;
  idempotencyKey?: string | undefined;
};

export type StripeCreateCouponArgs = StripeSdkContext & {
  id?: string | undefined;
  name?: string | undefined;
  percentOff?: number | undefined;
  amountOff?: number | undefined;
  currency?: string | undefined;
  duration?: "once" | "repeating" | "forever" | undefined;
  durationInMonths?: number | undefined;
  maxRedemptions?: number | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeCreatePromotionCodeArgs = StripeSdkContext & {
  couponId: string;
  code?: string | undefined;
  maxRedemptions?: number | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeGetCheckoutSessionArgs = StripeSdkContext & {
  checkoutSessionId: string;
};

export type StripeCreateCheckoutSessionArgs = StripeSdkContext & {
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  mode: "payment" | "setup" | "subscription";
  priceId?: string | undefined;
  quantity?: number | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeCreateSetupIntentArgs = StripeSdkContext & {
  customerId: string;
  paymentMethodType?: "card" | "us_bank_account" | undefined;
  usage?: "on_session" | "off_session" | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeListEventsArgs = StripeSdkContext & {
  type?: string | undefined;
  limit: number;
};

export type StripeGetEventArgs = StripeSdkContext & {
  eventId: string;
};

export type StripeUpdateChargeArgs = StripeSdkContext & {
  customerId: string;
  chargeId: string;
  description?: string | undefined;
  metadata?: Record<string, string> | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeCreateInvoiceArgs = StripeSdkContext & {
  customerId: string;
  autoAdvance?: boolean | undefined;
  collectionMethod?: "charge_automatically" | "send_invoice" | undefined;
  daysUntilDue?: number | undefined;
  description?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeCreateSubscriptionArgs = StripeSdkContext & {
  customerId: string;
  priceId: string;
  quantity?: number | undefined;
  trialPeriodDays?: number | undefined;
  idempotencyKey?: string | undefined;
};

export type StripeDeleteCustomerDiscountArgs = StripeSdkContext & {
  customerId: string;
  idempotencyKey?: string | undefined;
};

export type StripeDeleteSubscriptionDiscountArgs = StripeSdkContext & {
  customerId: string;
  subscriptionId: string;
  idempotencyKey?: string | undefined;
};

export type StripeGetBalanceTransactionArgs = StripeSdkContext & {
  balanceTransactionId: string;
};

export type StripeListGlobalBalanceTransactionsArgs = StripeSdkContext & {
  limit: number;
};

export type StripeGetCreditNoteArgs = StripeSdkContext & {
  creditNoteId: string;
};

export type StripePreviewCreditNoteArgs = StripeSdkContext & {
  invoiceId: string;
  amount: number;
  reason?: string | undefined;
};

export type StripeVoidCreditNoteArgs = StripeSdkContext & {
  customerId: string;
  creditNoteId: string;
  idempotencyKey?: string | undefined;
};

export type StripeInvoiceMutateArgs = StripeSdkContext & {
  customerId: string;
  invoiceId: string;
  idempotencyKey?: string | undefined;
};

export interface StripeSdkPort extends ProviderSdkPort {
  retrieveCustomer(args: StripeRetrieveCustomerArgs): Promise<StripeCustomer>;
  searchCustomers(args: StripeSearchCustomersArgs): Promise<StripeCustomer[]>;
  updateCustomer(args: StripeUpdateCustomerArgs): Promise<StripeCustomer>;
  listCharges(args: StripeListChargesArgs): Promise<StripeCharge[]>;
  getCharge(args: StripeGetChargeArgs): Promise<StripeCharge>;
  listInvoices(args: StripeListInvoicesArgs): Promise<StripeInvoice[]>;
  getInvoice(args: StripeGetInvoiceArgs): Promise<StripeInvoice>;
  previewInvoice(args: StripePreviewInvoiceArgs): Promise<StripeInvoice>;
  createRefund(args: StripeCreateRefundArgs): Promise<StripeRefund>;
  getRefund(args: StripeGetRefundArgs): Promise<StripeRefund>;
  listRefunds(args: StripeListRefundsArgs): Promise<StripeRefund[]>;
  cancelSubscription(args: StripeCancelSubscriptionArgs): Promise<StripeSubscriptionResult>;
  getSubscription(args: StripeGetSubscriptionArgs): Promise<StripeSubscriptionResult>;
  updateSubscription(args: StripeUpdateSubscriptionArgs): Promise<StripeSubscriptionResult>;
  resumeSubscription(args: StripeResumeSubscriptionArgs): Promise<StripeSubscriptionResult>;
  adjustBalance(args: StripeAdjustBalanceArgs): Promise<StripeBalanceTransactionResult>;
  sendInvoice(args: StripeInvoiceWriteArgs): Promise<StripeInvoice>;
  voidInvoice(args: StripeInvoiceWriteArgs): Promise<StripeInvoice>;
  payInvoice(args: StripeInvoiceWriteArgs): Promise<StripeInvoice>;
  listPaymentMethods(args: StripeListPaymentMethodsArgs): Promise<StripePaymentMethod[]>;
  createCreditNote(args: StripeCreateCreditNoteArgs): Promise<StripeCreditNote>;
  listCreditNotes(args: StripeListCreditNotesArgs): Promise<StripeCreditNote[]>;
  getDispute(args: StripeGetDisputeArgs): Promise<StripeDispute>;
  listDisputes(args: StripeListDisputesArgs): Promise<StripeDispute[]>;
  updateDispute(args: StripeUpdateDisputeArgs): Promise<StripeDispute>;
  closeDispute(args: StripeCloseDisputeArgs): Promise<StripeDispute>;
  createPortalSession(args: StripeCreatePortalSessionArgs): Promise<StripePortalSession>;
  listBalanceTransactions(
    args: StripeListBalanceTransactionsArgs,
  ): Promise<StripeBalanceTransactionResult[]>;
  searchCharges(args: StripeSearchChargesArgs): Promise<StripeCharge[]>;
  searchSubscriptions(args: StripeSearchSubscriptionsArgs): Promise<StripeSubscriptionResult[]>;
  searchInvoices(args: StripeSearchInvoicesArgs): Promise<StripeInvoice[]>;
  getPaymentIntent(args: StripeGetPaymentIntentArgs): Promise<StripePaymentIntent>;
  listPaymentIntents(args: StripeListPaymentIntentsArgs): Promise<StripePaymentIntent[]>;
  searchPaymentIntents(args: StripeSearchPaymentIntentsArgs): Promise<StripePaymentIntent[]>;
  detachPaymentMethod(args: StripeDetachPaymentMethodArgs): Promise<StripePaymentMethod>;
  cancelRefund(args: StripeCancelRefundArgs): Promise<StripeRefund>;
  updateRefund(args: StripeUpdateRefundArgs): Promise<StripeRefund>;
  getCoupon(args: StripeGetCouponArgs): Promise<StripeCoupon>;
  listCoupons(args: StripeListCouponsArgs): Promise<StripeCoupon[]>;
  getPromotionCode(args: StripeGetPromotionCodeArgs): Promise<StripePromotionCode>;
  listPromotionCodes(args: StripeListPromotionCodesArgs): Promise<StripePromotionCode[]>;
  createInvoiceItem(args: StripeCreateInvoiceItemArgs): Promise<StripeInvoiceItem>;
  deleteInvoiceItem(args: StripeDeleteInvoiceItemArgs): Promise<StripeDeletedInvoiceItem>;
  getProduct(args: StripeGetProductArgs): Promise<StripeProduct>;
  listProducts(args: StripeListProductsArgs): Promise<StripeProduct[]>;
  getPrice(args: StripeGetPriceArgs): Promise<StripePrice>;
  listPrices(args: StripeListPricesArgs): Promise<StripePrice[]>;
  listSubscriptionItems(args: StripeListSubscriptionItemsArgs): Promise<StripeSubscriptionItem[]>;
  createSubscriptionItem(args: StripeCreateSubscriptionItemArgs): Promise<StripeSubscriptionItem>;
  updateSubscriptionItem(args: StripeUpdateSubscriptionItemArgs): Promise<StripeSubscriptionItem>;
  deleteSubscriptionItem(
    args: StripeDeleteSubscriptionItemArgs,
  ): Promise<StripeDeletedSubscriptionItem>;
  getSubscriptionSchedule(
    args: StripeGetSubscriptionScheduleArgs,
  ): Promise<StripeSubscriptionSchedule>;
  listSubscriptionSchedules(
    args: StripeListSubscriptionSchedulesArgs,
  ): Promise<StripeSubscriptionSchedule[]>;
  updateSubscriptionSchedule(
    args: StripeUpdateSubscriptionScheduleArgs,
  ): Promise<StripeSubscriptionSchedule>;
  cancelSubscriptionSchedule(
    args: StripeCancelSubscriptionScheduleArgs,
  ): Promise<StripeSubscriptionSchedule>;
  listCustomerTaxIds(args: StripeListCustomerTaxIdsArgs): Promise<StripeTaxId[]>;
  createCustomerTaxId(args: StripeCreateCustomerTaxIdArgs): Promise<StripeTaxId>;
  deleteCustomerTaxId(args: StripeDeleteCustomerTaxIdArgs): Promise<StripeDeletedTaxId>;
  createCoupon(args: StripeCreateCouponArgs): Promise<StripeCoupon>;
  createPromotionCode(args: StripeCreatePromotionCodeArgs): Promise<StripePromotionCode>;
  getCheckoutSession(args: StripeGetCheckoutSessionArgs): Promise<StripeCheckoutSession>;
  createCheckoutSession(args: StripeCreateCheckoutSessionArgs): Promise<StripeCheckoutSession>;
  createSetupIntent(args: StripeCreateSetupIntentArgs): Promise<StripeSetupIntent>;
  listEvents(args: StripeListEventsArgs): Promise<StripeEvent[]>;
  getEvent(args: StripeGetEventArgs): Promise<StripeEvent>;
  updateCharge(args: StripeUpdateChargeArgs): Promise<StripeCharge>;
  createInvoice(args: StripeCreateInvoiceArgs): Promise<StripeInvoice>;
  createSubscription(args: StripeCreateSubscriptionArgs): Promise<StripeSubscriptionResult>;
  deleteCustomerDiscount(args: StripeDeleteCustomerDiscountArgs): Promise<StripeDeletedDiscount>;
  deleteSubscriptionDiscount(
    args: StripeDeleteSubscriptionDiscountArgs,
  ): Promise<StripeDeletedDiscount>;
  getBalanceTransaction(
    args: StripeGetBalanceTransactionArgs,
  ): Promise<StripeBalanceTransactionResult>;
  listGlobalBalanceTransactions(
    args: StripeListGlobalBalanceTransactionsArgs,
  ): Promise<StripeBalanceTransactionResult[]>;
  getCreditNote(args: StripeGetCreditNoteArgs): Promise<StripeCreditNote>;
  previewCreditNote(args: StripePreviewCreditNoteArgs): Promise<StripeCreditNote>;
  voidCreditNote(args: StripeVoidCreditNoteArgs): Promise<StripeCreditNote>;
  finalizeInvoice(args: StripeInvoiceMutateArgs): Promise<StripeInvoice>;
  markUncollectible(args: StripeInvoiceMutateArgs): Promise<StripeInvoice>;
}

const _stripeTypeCompatibilityCheck: Pick<Stripe.Customer, "id"> = {} as StripeCustomer;
void _stripeTypeCompatibilityCheck;
