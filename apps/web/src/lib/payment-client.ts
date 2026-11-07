import { checkoutPageSchema, checkoutRecordSchema, onlinePaymentOptionsSchema, prepareCheckoutSchema, type PrepareCheckoutInput } from "@bpt-jersey/domain/payments";
import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

async function call(name: string, input: unknown) {
  return (await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name, { limitedUseAppCheckTokens: true })(input)).data;
}
export async function getPaymentOptions() {
  return onlinePaymentOptionsSchema.parse(await call("getOnlinePaymentOptions", null));
}
export async function preparePayment(input: PrepareCheckoutInput) {
  try { return checkoutRecordSchema.parse(await call("preparePaymentCheckout", prepareCheckoutSchema.parse(input))); }
  catch { throw new Error("Your payment details could not be saved. Check your connection and try again. No payment has been confirmed."); }
}
export async function listPaymentActivity(invoiceId?: string) {
  return checkoutPageSchema.parse(await call("listPaymentCheckouts", invoiceId ? { invoiceId } : {})).items;
}
