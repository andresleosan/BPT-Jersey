import { describe, expect, it } from "vitest";

import { createInMemoryCrmStore, CrmStoreError } from "./crm-service";

const draft = {
  academyId: "demo-academy",
  contactReference: "lead-morgan-f",
  source: "website-f" as const,
  ownerId: "reception-f",
  status: "new_enquiry" as const,
  nextActionAt: "2026-08-26T10:00:00Z",
  consentState: "unknown" as const,
};

describe("CRM service store", () => {
  it("creates, filters and updates a tenant-scoped lead", async () => {
    const store = createInMemoryCrmStore();
    const created = await store.createLead({
      academyId: "demo-academy",
      input: draft,
      createdBy: "admin-1",
      now: "2026-08-25T10:00:00Z",
    });

    expect(created.lead.status).toBe("new_enquiry");
    expect((await store.listLeads("demo-academy", { ownerId: "reception-f" })).length).toBe(1);
    expect((await store.listLeads("other-academy")).length).toBe(0);

    const updated = await store.updateLead({
      academyId: "demo-academy",
      leadId: created.lead.leadId,
      ownerId: "admin-team-f",
      updatedBy: "admin-1",
      now: "2026-08-25T11:00:00Z",
    });
    expect(updated.lead.ownerId).toBe("admin-team-f");
    expect((await store.listTimeline("demo-academy", created.lead.leadId)).length).toBe(2);
  });

  it("enforces transitions, terminal states, and tenant isolation", async () => {
    const store = createInMemoryCrmStore();
    const created = await store.createLead({
      academyId: "demo-academy",
      input: { ...draft, status: "new_enquiry" },
      createdBy: "admin-1",
      now: "2026-08-25T10:00:00Z",
    });

    const booked = await store.transitionLead({
      academyId: "demo-academy",
      leadId: created.lead.leadId,
      targetStatus: "trial_booked",
      updatedBy: "admin-1",
      now: "2026-08-25T11:00:00Z",
    });
    expect(booked.lead.status).toBe("trial_booked");

    await expect(
      store.transitionLead({
        academyId: "demo-academy",
        leadId: created.lead.leadId,
        targetStatus: "won",
        updatedBy: "admin-1",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    await expect(store.getLead("other-academy", created.lead.leadId)).resolves.toBeNull();
    await expect(
      store.transitionLead({
        academyId: "other-academy",
        leadId: created.lead.leadId,
        targetStatus: "lost",
        updatedBy: "admin-1",
      }),
    ).rejects.toBeInstanceOf(CrmStoreError);
  });
});
