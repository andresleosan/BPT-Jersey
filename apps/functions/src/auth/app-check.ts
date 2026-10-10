import {
  HttpsError,
  onCall,
  type CallableOptions,
  type CallableRequest,
  type CallableResponse,
} from "firebase-functions/v2/https";

export function requireFreshAppCheck(request: CallableRequest<unknown>): void {
  if (!request.app || request.app.alreadyConsumed === true) {
    throw new HttpsError("unauthenticated", "A fresh verified application token is required.");
  }
}

export function onCallWithFreshAppCheck<T = any, Return = unknown, Stream = unknown>(
  options: CallableOptions<T>,
  handler: (request: CallableRequest<T>, response?: CallableResponse<Stream>) => Return,
) {
  if (options.consumeAppCheckToken !== true) {
    throw new Error("Fresh App Check requires consumeAppCheckToken.");
  }
  return onCall(options, (request, response) => {
    requireFreshAppCheck(request);
    return handler(request, response);
  });
}
