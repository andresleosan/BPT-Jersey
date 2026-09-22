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
