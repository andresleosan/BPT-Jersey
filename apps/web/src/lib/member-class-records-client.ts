import { httpsCallable } from "firebase/functions";
import {
  memberClassPageSchema,
  memberClassQuerySchema,
  type MemberClassQuery,
} from "@bpt-jersey/domain/schedule/member-class-records";
import { getFirebaseFunctions } from "./firebase-client";
const unavailable = "Unable to load class history. Refresh to try again.";
export class MemberClassLoadError extends Error {}
export async function getMemberClassRecords(input: MemberClassQuery) {
  try {
    const query = memberClassQuerySchema.parse(input);
    const response = await httpsCallable<unknown, unknown>(
      getFirebaseFunctions(),
      "listMemberClassRecords",
    )(query);
    const page = memberClassPageSchema.parse(response.data);
    if (page.studentId !== query.studentId || page.kind !== query.kind)
      throw new Error(unavailable);
    return page;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    throw new MemberClassLoadError(
      code === "functions/aborted"
        ? "History changed; refresh to load the latest records."
        : code === "functions/not-found"
          ? "Live member record unavailable. Return to Members to find the current record."
          : code === "functions/permission-denied" || code === "functions/unauthenticated"
            ? "An active office session is required. Sign in again to view class history."
            : unavailable,
    );
  }
}
