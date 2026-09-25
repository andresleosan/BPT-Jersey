import { describe, expect, it } from "vitest";

import { createInMemoryCrmStore } from "./crm-service";
import {
  createListLeadTimelineHandler,
  createListLeadsHandler,
  createTransitionLeadHandler,
  createUpdateLeadHandler,
} from "./crm-callables";

function fakeRequest(
  data: unknown,
  role = "administrator",
  uid = "admin-1",
  academyId = "demo-academy",
) {
  return { auth: { uid, token: { academyId, role } }, data } as never;
}

const validDraft = {
  academyId: "demo-academy",
  contactReference: "lead-jamie-f",
  source: "website-f" as const,
  ownerId: "coach-1",
  status: "new_enquiry" as const,
  nextActionAt: "2026-08-26T10:00:00Z",
  consentState: "unknown" as const,
};

describe("CRM callables", () => {
  it("filters, updates, transitions and lists timeline", async () => {
    const store = createInMemoryCrmStore();
    const created = await store.createLead({
      academyId: "demo-academy",
      input: validDraft,
      createdBy: "admin-1",
    });
    expect(created.lead.academyId).toBe("demo-academy");

    const listed = await createListLeadsHandler({ store })(
      fakeRequest({ status: "new_enquiry" }, "headCoach", "coach-1"),
    );
    expect(listed.leads).toHaveLength(1);

    const updated = await createUpdateLeadHandler({ store })(
      fakeRequest({ leadId: created.lead.leadId, ownerId: "coach-1" }),
    );
    expect(updated.lead.ownerId).toBe("coach-1");

    const transitioned = await createTransitionLeadHandler({ store })(
      fakeRequest({ leadId: created.lead.leadId, targetStatus: "trial_booked" }),
    );
    expect(transitioned.lead.status).toBe("trial_booked");

    const timeline = await createListLeadTimelineHandler({ store })(
      fakeRequest({ leadId: created.lead.leadId }, "headCoach", "coach-1"),
    );
    expect(timeline.events.length).toBe(3);
  });

  it("rejects non-CRM roles and malformed filters", async () => {
    const store = createInMemoryCrmStore();
    const list = createListLeadsHandler({ store });
    await expect(list(fakeRequest({}, "coach", "coach-1"))).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(list(fakeRequest({ ownerId: "bad/id" }))).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });
});
