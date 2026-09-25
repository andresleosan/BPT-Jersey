import { memberHistoryInputSchema } from "@bpt-jersey/domain/members/history";
import { memberReviewCallable } from "./member-reconciliation-callables.js";
import { createMemberHistoryService } from "./member-history-service.js";

export const getMemberHistory = memberReviewCallable(memberHistoryInputSchema, (deps, actor, input) =>
  createMemberHistoryService(deps, actor).list(actor.academyId, input.studentId, input.cursor));
