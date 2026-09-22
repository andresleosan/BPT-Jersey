import { httpsCallable } from "firebase/functions";
import { memberOverviewSchema, type MemberOverview } from "@bpt-jersey/domain/members/overview";
import { getFirebaseFunctions, memberFunctionsRegion } from "./firebase-client";

const safeError = "Unable to load the member directory. Please try again.";

/** The whole directory for the office, read next to the data in europe-west9. */
export async function getMemberOverview(): Promise<MemberOverview> {
  try {
    const result = await httpsCallable<null, unknown>(
      getFirebaseFunctions(memberFunctionsRegion),
      "getMemberOverview",
    )(null);
    return memberOverviewSchema.parse(result.data);
  } catch {
    throw new Error(safeError);
  }
}
