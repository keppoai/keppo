import type {
  StripeBalanceTransactionResult,
  StripeCharge,
  StripeCoupon,
  StripeCreditNote,
  StripeCustomer,
  StripeDispute,
  StripeInvoice,
  StripeInvoiceItem,
  StripePaymentIntent,
  StripePaymentMethod,
  StripePrice,
  StripeProduct,
  StripePromotionCode,
  StripeRefund,
  StripeSubscriptionItem,
  StripeSubscriptionSchedule,
  StripeTaxId,
  StripeCheckoutSession,
  StripeSetupIntent,
  StripeEvent,
} from "./types.js";

export type StripeFixtureCustomer = Partial<StripeCustomer> & {
  id: string;
  email: string;
  name: string;
  phone: string;
  active_subscription: boolean;
  balance: number;
  metadata?: Record<string, string>;
  subscriptions: Array<{
    id: string;
    status: string;
    plan: string;
    cancel_at_period_end?: boolean;
    priceId?: string;
    quantity?: number;
  }>;
};

export type StripeFixtureInvoice = Partial<StripeInvoice> & {
  id: string;
  customer: string;
  amount_due: number;
  status: string;
  paid: boolean;
};

export type StripeFixtureCharge = Partial<StripeCharge> & {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  status: string;
};

export type StripeFixtureRefund = Partial<StripeRefund> & {
  id: string;
  customer: string;
  charge: string;
  amount: number;
  currency: string;
  status: string;
  metadata?: Record<string, string>;
};

export type StripeFixturePaymentMethod = Partial<StripePaymentMethod> & {
  id: string;
  customer: string;
  type: "card" | "us_bank_account";
};

export type StripeFixturePaymentIntent = Partial<StripePaymentIntent> & {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  status: string;
};

export type StripeFixtureCreditNote = Partial<StripeCreditNote> & {
  id: string;
  customer: string;
  invoice: string;
  amount: number;
  reason: string | null;
  status?: string;
};

export type StripeFixtureDispute = Partial<StripeDispute> & {
  id: string;
  customer: string;
  charge: string;
  status: string;
  reason: string;
  evidence_summary?: string;
};

export type StripeFixtureBalanceTransaction = Partial<StripeBalanceTransactionResult> & {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  description: string;
  status: string;
};

export type StripeFixtureCoupon = Partial<StripeCoupon> & {
  id: string;
  name: string;
  valid: boolean;
  percent_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
};

export type StripeFixturePromotionCode = Partial<StripePromotionCode> & {
  id: string;
  code: string;
  coupon: string;
  active: boolean;
};

export type StripeFixtureProduct = Partial<StripeProduct> & {
  id: string;
  name: string;
  active: boolean;
  default_price?: string;
};

export type StripeFixturePrice = Partial<StripePrice> & {
  id: string;
  product: string;
  active: boolean;
  currency: string;
  unit_amount: number;
};

export type StripeFixtureInvoiceItem = Partial<StripeInvoiceItem> & {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  invoice?: string;
  description?: string | null;
};

export type StripeFixtureSubscriptionItem = Partial<StripeSubscriptionItem> & {
  id: string;
  customer: string;
  subscription: string;
  price: string;
  quantity: number;
};

export type StripeFixtureSubscriptionSchedule = Partial<StripeSubscriptionSchedule> & {
  id: string;
  customer: string;
  subscription: string;
  status: string;
  end_behavior?: string;
};

export type StripeFixtureTaxId = Partial<StripeTaxId> & {
  id: string;
  customer: string;
  type: string;
  value: string;
};

export type StripeFixtureCheckoutSession = Partial<StripeCheckoutSession> & {
  id: string;
  customer: string;
  status: string;
  payment_status: string;
  mode: "payment" | "setup" | "subscription";
  url: string;
};

export type StripeFixtureSetupIntent = Partial<StripeSetupIntent> & {
  id: string;
  customer: string;
  status: string;
  usage?: "on_session" | "off_session";
  client_secret: string;
};

export type StripeFixtureEvent = Partial<StripeEvent> & {
  id: string;
  type: string;
  created: number;
};

export const seedStripeCustomers = (): Record<string, StripeFixtureCustomer> => ({
  cus_100: {
    id: "cus_100",
    email: "customer@example.com",
    name: "Keppo Customer",
    phone: "+15555550100",
    active_subscription: true,
    balance: 0,
    metadata: {
      segment: "pro",
    },
    subscriptions: [{ id: "sub_100", status: "active", plan: "pro" }],
  },
});

export const seedStripeInvoices = (): Record<string, StripeFixtureInvoice> => ({
  in_cus_100_1: {
    id: "in_cus_100_1",
    customer: "cus_100",
    amount_due: 4900,
    status: "open",
    paid: false,
  },
});

export const seedStripeCharges = (): Record<string, StripeFixtureCharge> => ({
  ch_cus_100: {
    id: "ch_cus_100",
    customer: "cus_100",
    amount: 4900,
    currency: "usd",
    status: "succeeded",
  },
});

export const seedStripeRefunds = (): Record<string, StripeFixtureRefund> => ({
  re_seed_1: {
    id: "re_seed_1",
    customer: "cus_100",
    charge: "ch_cus_100",
    amount: 1200,
    currency: "usd",
    status: "succeeded",
    metadata: {
      source: "seed",
    },
  },
});

export const seedStripePaymentMethods = (): Record<string, StripeFixturePaymentMethod> => ({
  pm_card_1: {
    id: "pm_card_1",
    customer: "cus_100",
    type: "card",
  },
});

export const seedStripePaymentIntents = (): Record<string, StripeFixturePaymentIntent> => ({
  pi_seed_1: {
    id: "pi_seed_1",
    customer: "cus_100",
    amount: 4900,
    currency: "usd",
    status: "requires_payment_method",
  },
});

export const seedStripeCreditNotes = (): Record<string, StripeFixtureCreditNote> => ({
  cn_seed_1: {
    id: "cn_seed_1",
    customer: "cus_100",
    invoice: "in_cus_100_1",
    amount: 500,
    reason: "order_change",
    status: "issued",
  },
});

export const seedStripeDisputes = (): Record<string, StripeFixtureDispute> => ({
  dp_seed_1: {
    id: "dp_seed_1",
    customer: "cus_100",
    charge: "ch_cus_100",
    status: "needs_response",
    reason: "fraudulent",
  },
});

export const seedStripeBalanceTransactions = (): Record<
  string,
  StripeFixtureBalanceTransaction
> => ({
  cbtxn_seed_1: {
    id: "cbtxn_seed_1",
    customer: "cus_100",
    amount: -300,
    currency: "usd",
    description: "starting balance",
    status: "succeeded",
  },
});

export const seedStripeCoupons = (): Record<string, StripeFixtureCoupon> => ({
  cpn_seed_1: {
    id: "cpn_seed_1",
    name: "Welcome 10%",
    valid: true,
    percent_off: 10,
  },
});

export const seedStripePromotionCodes = (): Record<string, StripeFixturePromotionCode> => ({
  promo_seed_1: {
    id: "promo_seed_1",
    code: "WELCOME10",
    coupon: "cpn_seed_1",
    active: true,
  },
});

export const seedStripeProducts = (): Record<string, StripeFixtureProduct> => ({
  prod_seed_1: {
    id: "prod_seed_1",
    name: "Keppo Pro",
    active: true,
    default_price: "price_seed_1",
  },
});

export const seedStripePrices = (): Record<string, StripeFixturePrice> => ({
  price_seed_1: {
    id: "price_seed_1",
    product: "prod_seed_1",
    active: true,
    currency: "usd",
    unit_amount: 4900,
  },
});

export const seedStripeInvoiceItems = (): Record<string, StripeFixtureInvoiceItem> => ({
  ii_seed_1: {
    id: "ii_seed_1",
    customer: "cus_100",
    amount: 500,
    currency: "usd",
    invoice: "in_cus_100_1",
    description: "seed adjustment",
  },
});

export const seedStripeSubscriptionItems = (): Record<string, StripeFixtureSubscriptionItem> => ({
  si_seed_1: {
    id: "si_seed_1",
    customer: "cus_100",
    subscription: "sub_100",
    price: "price_seed_1",
    quantity: 1,
  },
});

export const seedStripeSubscriptionSchedules = (): Record<
  string,
  StripeFixtureSubscriptionSchedule
> => ({
  sub_sched_seed_1: {
    id: "sub_sched_seed_1",
    customer: "cus_100",
    subscription: "sub_100",
    status: "active",
    end_behavior: "release",
  },
});

export const seedStripeTaxIds = (): Record<string, StripeFixtureTaxId> => ({
  txi_seed_1: {
    id: "txi_seed_1",
    customer: "cus_100",
    type: "eu_vat",
    value: "DE123456789",
  },
});

export const seedStripeCheckoutSessions = (): Record<string, StripeFixtureCheckoutSession> => ({
  cs_seed_1: {
    id: "cs_seed_1",
    customer: "cus_100",
    status: "open",
    payment_status: "unpaid",
    mode: "payment",
    url: "https://checkout.stripe.test/cs_seed_1",
  },
});

export const seedStripeSetupIntents = (): Record<string, StripeFixtureSetupIntent> => ({
  seti_seed_1: {
    id: "seti_seed_1",
    customer: "cus_100",
    status: "requires_payment_method",
    usage: "off_session",
    client_secret: "seti_seed_1_secret",
  },
});

export const seedStripeEvents = (): Record<string, StripeFixtureEvent> => ({
  evt_seed_1: {
    id: "evt_seed_1",
    type: "invoice.payment_failed",
    created: 1700000000,
  },
});
