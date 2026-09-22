import { z } from "zod";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

const statusSchema = z.strictObject({
  version: z.string(),
  pending: z.array(z.strictObject({ studentId: z.string(), fullName: z.string() })).max(100),
});
export type EnrolmentWaiverStatus = z.infer<typeof statusSchema>;

/** Which of this account's students still have to accept the enrolment waiver (once each). */
export async function getEnrolmentWaiverStatus(): Promise<EnrolmentWaiverStatus> {
  try {
    const response = await httpsCallable<null, unknown>(
      getFirebaseFunctions(),
      "getEnrolmentWaiverStatus",
    )(null);
    return statusSchema.parse(response.data);
  } catch {
    throw new Error("The waiver is unavailable right now.");
  }
}

export async function acceptEnrolmentWaiver(input: {
  version: string;
  studentIds: readonly string[];
}): Promise<readonly string[]> {
  try {
    const response = await httpsCallable<typeof input, unknown>(
      getFirebaseFunctions(),
      "acceptEnrolmentWaiver",
    )(input);
    return z.strictObject({ accepted: z.array(z.string()) }).parse(response.data).accepted;
  } catch {
    throw new Error("Your acceptance could not be saved. Please try again.");
  }
}
