import { httpsCallable as sdkHttpsCallable, type Functions, type HttpsCallable, type HttpsCallableOptions } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase-client";

/**
 * Functions ran in us-central1 until 22 September 2026 and move to europe-west9 in batches. A
 * callable the browser asks for in the new region before its copy exists there answers 404
 * (`functions/not-found`) and is retried once in the old region, so the move needs no cut-over.
 * ponytail: once us-central1 is empty, delete this file and import httpsCallable from firebase/functions.
 */
const legacyRegion = "us-central1";

export function httpsCallable<RequestData = unknown, ResponseData = unknown>(
  functions: Functions,
  name: string,
  options?: HttpsCallableOptions,
): HttpsCallable<RequestData, ResponseData> {
  const primary = sdkHttpsCallable<RequestData, ResponseData>(functions, name, options);
  const withFallback = (async (data?: RequestData | null) => {
    try {
      return await primary(data);
    } catch (error) {
      if (functions.region === legacyRegion || !isNotFound(error)) throw error;
      return sdkHttpsCallable<RequestData, ResponseData>(getFirebaseFunctions(legacyRegion), name, options)(data);
    }
  }) as HttpsCallable<RequestData, ResponseData>;
  withFallback.stream = primary.stream;
  return withFallback;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "functions/not-found";
}

export const appCheckFailureMessage = "We couldn't verify this device. Try again in a moment.";

/**
 * A device App Check could not vouch for. A limited-use token request throws the App Check error
 * itself (`appCheck/initial-throttle`, …); a cached-token request that failed goes out without a
 * token and the server answers `functions/unauthenticated` with the framework's literal
 * "Unauthenticated"; our own refusals count only when they name App Check.
 */
export function isAppCheckFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  if (code.startsWith("appCheck/") || message.includes("appCheck/")) return true;
  if (code === "functions/unauthenticated" && message === "Unauthenticated") return true;
  return (
    (code === "functions/unauthenticated" || code === "functions/permission-denied") &&
    /app ?check/i.test(message)
  );
}
