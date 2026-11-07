import type {
  CheckoutRecord,
  OnlinePaymentMethod,
  VerifiedPaymentEvent,
} from "@bpt-jersey/domain/payments";

export type OnlinePaymentProvider = Readonly<{
  name: string;
  methods: readonly OnlinePaymentMethod[];
  checkoutOrigins: readonly string[];
  createCheckout: (
    checkout: CheckoutRecord,
    returnUrl: string,
  ) => Promise<{
    providerCheckoutId: string;
    checkoutUrl: string;
  }>;
  /** Verify the signature, signed timestamp and merchant account before returning an event.
   * Never parse an unsigned body as a successful payment. Do not log this input. */
  verifyWebhook: (
    rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ) => Promise<VerifiedPaymentEvent>;
}>;

/** Replace this factory with the contracted provider's SDK adapter. An API key alone cannot
 * enable money movement: capabilities, hosted fields, 3DS and signed webhooks must be wired. */
export function getOnlinePaymentProvider(): OnlinePaymentProvider {
  return {
    name: "unconfigured",
    methods: [],
    checkoutOrigins: [],
    async createCheckout() {
      throw new Error("provider_unconfigured");
    },
    async verifyWebhook() {
      throw new Error("provider_unconfigured");
    },
  };
}
