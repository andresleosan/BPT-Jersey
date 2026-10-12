import { describe, expect, it } from "vitest";

import { adminNotificationDetailsSchema } from "@bpt-jersey/domain/memberships/admin";

import { createNotificationDescriber, type DetailsReader } from "./notification-details";

type Data = Readonly<Record<string, unknown>>;

function fakeReader(docs: Record<string, Data>, users: Record<string, string> = {}): DetailsReader {
  return {
    get: async (path) => docs[path],
    userName: async (userId) => users[userId] ?? null,
  };
}

const long = "N".repeat(200);
const audit = (targetRef: string, actorId = "system") => ({
  action: "test",
  actorId,
  targetRef,
});

describe("notification details subject (NOTIF-FROM)", () => {
  it("fits a 200-character member name to the 160-character from", async () => {
    const describer = createNotificationDescriber(
      fakeReader({
        "academies/a1/memberships/m1": { studentId: "s1", planId: "p1" },
        "academies/a1/students/s1": { fullName: long },
      }),
    );
    const notice = await describer.describe(audit("academies/a1/memberships/m1"), "Plan");
    expect(adminNotificationDetailsSchema.parse(notice?.details).from).toHaveLength(160);
  });

  it("fits a 200-character payer name on payments and invoices", async () => {
    const describer = createNotificationDescriber(
      fakeReader({
        "academies/a1/payments/pay1": { invoiceId: "i1", amountMinor: 1000 },
        "academies/a1/invoices/i1": { membershipId: "m1", totalMinor: 1000 },
        "academies/a1/memberships/m1": { studentId: "s1" },
        "academies/a1/students/s1": { fullName: long },
        "academies/a1/invoices/i2": { familyId: "f1", totalMinor: 1000 },
        "academies/a1/families/f1": { guardianContact: { fullName: long } },
      }),
    );
    for (const ref of ["academies/a1/payments/pay1", "academies/a1/invoices/i2"]) {
      const notice = await describer.describe(audit(ref), "Invoice");
      expect(adminNotificationDetailsSchema.parse(notice?.details).from).toHaveLength(160);
    }
  });

  it("fits a 200-character applicant, member and session title", async () => {
    const describer = createNotificationDescriber(
      fakeReader({
        "academies/a1/enrolmentRequests/e1": { applicant: { fullName: long } },
        "academies/a1/students/s2": { fullName: long },
        "academies/a1/sessions/c1": { title: long },
      }),
    );
    for (const ref of [
      "academies/a1/enrolmentRequests/e1",
      "academies/a1/students/s2",
      "academies/a1/sessions/c1",
    ]) {
      const notice = await describer.describe(audit(ref), "Notice");
      expect(adminNotificationDetailsSchema.parse(notice?.details).from).toHaveLength(160);
    }
  });

  it("fits a 200-character studentName on a member's plan application", async () => {
    const describer = createNotificationDescriber(fakeReader({}));
    const notice = await describer.describeApplication({ studentName: long, priceMinor: 5000 });
    expect(adminNotificationDetailsSchema.parse(notice.details).from).toHaveLength(160);
  });

  it("trims whitespace, including what the cut leaves at the end", async () => {
    const describer = createNotificationDescriber(
      fakeReader(
        {
          "academies/a1/students/s1": { fullName: `${"A".repeat(159)} ${"B".repeat(40)}` },
          "academies/a1/payments/pay1": { amountMinor: 1000 },
        },
        { "office-1": "  Office Person  " },
      ),
    );
    const member = await describer.describe(audit("academies/a1/students/s1"), "Member");
    expect(member?.details.from).toBe("A".repeat(159));
    const payment = await describer.describe(
      audit("academies/a1/payments/pay1", "office-1"),
      "Payment",
    );
    expect(payment?.details.from).toBe("Office Person");
  });

  it("falls back when the subject is blank", async () => {
    const describer = createNotificationDescriber(
      fakeReader(
        {
          "academies/a1/payments/pay1": { amountMinor: 1000 },
          "academies/a1/sessions/c1": {},
        },
        { "blank-1": "   " },
      ),
    );
    const payment = await describer.describe(
      audit("academies/a1/payments/pay1", "blank-1"),
      "Payment",
    );
    expect(payment?.details.from).toBe("Automatic");
    const session = await describer.describe(audit("academies/a1/sessions/c1"), "Class");
    expect(session?.details.from).toBe("Class");
    const application = await describer.describeApplication({ applicantUid: "blank-1" });
    expect(application.details.from).toBe("Member");
    for (const details of [payment?.details, session?.details, application.details]) {
      expect(() => adminNotificationDetailsSchema.parse(details)).not.toThrow();
    }
  });
});
