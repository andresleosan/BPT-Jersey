import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onRequest } from "firebase-functions/v2/https";
import { onCallWithFreshAppCheck } from "../auth/app-check.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { financeCallableServices } from "../finance/finance-callables.js";
import { getOnlinePaymentProvider } from "./online-provider.js";
import {
  listOnlineCheckouts,
  paymentActor,
  prepareOnlineCheckout,
  settleOnlinePayment,
} from "./online-checkout.js";

const options = { ...browserAdminCallableOptions, consumeAppCheckToken: true };

export const getOnlinePaymentOptions = onCallWithFreshAppCheck(options, async (request) => {
  await paymentActor(request);
  if (request.data !== null)
    throw new HttpsError("invalid-argument", "Invalid payment options request.");
  const provider = getOnlinePaymentProvider();
  return { provider: provider.name, methods: provider.methods };
});
export const preparePaymentCheckout = onCallWithFreshAppCheck(options, async (request) => {
  const actor = await paymentActor(request);
  return prepareOnlineCheckout(getFirestore(), actor, request.data, getOnlinePaymentProvider());
});
export const listPaymentCheckouts = onCallWithFreshAppCheck(options, async (request) => {
  const actor = await paymentActor(request);
  return listOnlineCheckouts(getFirestore(), actor, request.data);
});

/** No browser return URL or callable can mark a payment received. */
export const onlinePaymentWebhook = onRequest(
  { cors: false, invoker: "public", timeoutSeconds: 60 },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).end();
      return;
    }
    const provider = getOnlinePaymentProvider();
    if (provider.name === "unconfigured" || provider.methods.length === 0) {
      response.status(503).send("Payment provider is not connected.");
      return;
    }
    if (request.rawBody.length > 65536) {
      response.status(413).end();
      return;
    }
    let event;
    try {
      event = await provider.verifyWebhook(request.rawBody, request.headers);
    } catch {
      response.status(400).send("Invalid payment notification.");
      return;
    }
    try {
      await settleOnlinePayment(getFirestore(), financeCallableServices().store, provider, event);
      response.status(204).end();
    } catch {
      // A non-2xx response asks the provider to retry. Never expose or log its raw payload.
      response.status(503).send("Payment notification requires reconciliation.");
    }
  },
);
