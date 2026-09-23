import { z } from "zod";
import { accountMemberProfileSchema } from "@bpt-jersey/domain/members/access";
import { memberPlanRequestInputSchema } from "@bpt-jersey/domain/members/engagement";
import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

/** The callable is not deployed (or not reachable here): the UI that needs it hides itself. */
export class FamilyPlanUnavailableError extends Error {}

const safe = "We couldn't load your plan right now. Try again.";
async function call<T>(name: string, data: unknown, schema: z.ZodType<T>, error = safe): Promise<T> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(data);
    const parsed = schema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch (cause) {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
    if (code.endsWith("not-found") || code.endsWith("unimplemented")) throw new FamilyPlanUnavailableError(error);
    /* fixed message below */
  }
  throw new Error(error);
}

export const listMyProfiles = () =>
  call("listMyMemberProfiles", {}, z.object({ profiles: z.array(accountMemberProfileSchema) })).then((r) => r.profiles);

export const requestMemberPlanPerson = (input: z.input<typeof memberPlanRequestInputSchema>) =>
  call("requestMemberPlanPerson", memberPlanRequestInputSchema.parse(input), z.object({ requestId: z.string() }),
    "We couldn't send your request. Check the details and try again.");

const memberPlanRequestSchema = z.object({
  requestId: z.string(),
  kind: z.enum(["self", "child"]),
  requestedBy: z.string(),
  person: z.object({
    fullName: z.string(),
    dateOfBirth: z.string(),
    trainingCenter: z.string(),
    trainingTimePreferences: z.array(z.string()),
  }),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.string(),
});
export type MemberPlanRequestRow = z.infer<typeof memberPlanRequestSchema>;

export const listMemberPlanRequests = () =>
  call("listMemberPlanRequests", { status: "pending" }, z.object({ requests: z.array(memberPlanRequestSchema) }),
    "Plan requests could not be loaded.").then((r) => r.requests);

export const decideMemberPlanRequest = (requestId: string, decision: "approve" | "reject") =>
  call("decideMemberPlanRequest", { requestId, decision }, z.object({ studentId: z.string().nullable() }),
    decision === "approve"
      ? "The request could not be approved. Check the member's account and try again."
      : "The request could not be rejected. Try again.");
