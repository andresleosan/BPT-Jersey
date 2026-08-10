import { httpsCallable } from "firebase/functions";
import type { RegyfitAccessRecord } from "@bpt-jersey/domain";

import { getFirebaseFunctions } from "./firebase-client";

export type RegyfitAccessProjection = RegyfitAccessRecord | Omit<RegyfitAccessRecord, "ip">;

type EmptyCallablePayload = Readonly<Record<string, never>>;

export async function loadRegyfitAccessRecords(): Promise<readonly RegyfitAccessProjection[]> {
  try {
    const callable = httpsCallable<EmptyCallablePayload, readonly RegyfitAccessProjection[]>(
      getFirebaseFunctions(),
      "listRegyfitAccessRecords",
    );
    const result = await callable({});
    return result.data;
  } catch {
    throw new Error("Unable to load Regyfit access records.");
  }
}
