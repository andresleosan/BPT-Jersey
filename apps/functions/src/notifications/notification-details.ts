import type { AdminNotificationDetails } from "@bpt-jersey/domain/memberships/admin";

/**
 * Turns the document an audit event points at into the full story of the notification: who,
 * how much, what for, when and who recorded it. The result is stored on the notification itself,
 * so the inbox never reads payments, members or sessions again to show it.
 *
 * Every lookup is best effort: a missing or legacy-shaped document drops that line, never the
 * notification. Only office staff read these notifications; no date of birth, medical or
 * emergency-contact data is copied.
 */
type Data = Readonly<Record<string, unknown>>;
export type DetailsReader = Readonly<{
  get: (path: string) => Promise<Data | undefined>;
  /** Display name of an account, or null when it has none (automatic jobs). */
  userName: (userId: string) => Promise<string | null>;
}>;
export type AuditSnapshot = Readonly<{
  action: string;
  actorId: string;
  targetRef: string;
  amountMinor?: unknown;
  method?: unknown;
}>;
export type DescribedNotice = Readonly<{
  message: string;
  details: AdminNotificationDetails;
  studentId: string | null;
  membershipId: string | null;
}>;

const zone = "Europe/Jersey";
const text = (data: Data | undefined, key: string): string | null => {
  const value = data?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};
const count = (data: Data | undefined, key: string): number | null => {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const record = (data: Data | undefined, key: string): Data | undefined => {
  const value = data?.[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Data)
    : undefined;
};

export const money = (minor: number | null): string | null =>
  minor === null
    ? null
    : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
export function when(iso: string | null, withTime = true): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(iso));
}
const plain = (value: string | null) =>
  value ? value.replaceAll(/[_-]+/gu, " ").replace(/^./u, (c) => c.toUpperCase()) : null;
const methods: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  other: "Other",
};

type Fact = AdminNotificationDetails["facts"][number];
function facts(pairs: ReadonlyArray<readonly [string, string | null | undefined]>): Fact[] {
  return pairs
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1]))
    .slice(0, 16)
    .map(([label, value]) => ({ label: label.slice(0, 40), value: value.slice(0, 300) }));
}

function split(targetRef: string) {
  const [, academyId, collection, id] = targetRef.split("/");
  return { base: `academies/${academyId}`, collection: collection ?? "", id: id ?? "" };
}

export function createNotificationDescriber(reader: DetailsReader) {
  const get = async (path: string | null) =>
    path ? reader.get(path).catch(() => undefined) : undefined;
  const name = async (userId: string | null) =>
    userId ? reader.userName(userId).catch(() => null) : null;

  async function planName(base: string, planId: string | null) {
    return text(await get(planId ? `${base}/plans/${planId}` : null), "displayName") ?? planId;
  }
  async function studentName(base: string, studentId: string | null) {
    return text(await get(studentId ? `${base}/students/${studentId}` : null), "fullName");
  }
  /** Who is paying: the member on the subscription, else the family contact, else the payer. */
  async function payerName(base: string, source: Data | undefined, invoice: Data | undefined) {
    const membership = await get(
      text(invoice, "membershipId") ? `${base}/memberships/${text(invoice, "membershipId")}` : null,
    );
    const student = await studentName(base, text(membership, "studentId"));
    if (student) return { name: student, studentId: text(membership, "studentId") };
    const familyId = text(source, "familyId") ?? text(invoice, "familyId");
    const family = await get(familyId ? `${base}/families/${familyId}` : null);
    const contact =
      text(record(family, "guardianContact"), "fullName") ??
      (await name(text(family, "primaryContactUserId") ?? text(family, "billingContactUserId")));
    if (contact) return { name: contact, studentId: null };
    const payer = record(source, "payer");
    return { name: await name(text(payer, "userId")), studentId: null };
  }

  async function describe(audit: AuditSnapshot, title: string): Promise<DescribedNotice | null> {
    const { base, collection, id } = split(audit.targetRef);
    const target = await get(audit.targetRef);
    const actor = (await name(audit.actorId)) ?? "Automatic";
    const recordedBy = ["Recorded by", actor] as const;

    if (collection === "payments") {
      const invoice = await get(
        text(target, "invoiceId") ? `${base}/invoices/${text(target, "invoiceId")}` : null,
      );
      const payer = await payerName(base, target, invoice);
      const amount = money(count(target, "amountMinor") ?? count(audit, "amountMinor"));
      const method = methods[text(target, "method") ?? text(audit, "method") ?? ""] ?? null;
      const purpose = text(invoice, "description");
      const who = payer.name ?? actor;
      return {
        message: [
          payer.name
            ? `${payer.name} paid ${amount ?? "an amount"}`
            : `${amount ?? "A payment"} was recorded`,
          method ? ` by ${method.toLowerCase()}` : "",
          purpose ? ` for ${purpose}` : "",
          ".",
        ].join(""),
        studentId: payer.studentId,
        membershipId: text(invoice, "membershipId"),
        details: {
          from: who,
          amount,
          facts: facts([
            ["Paid by", payer.name],
            ["Amount", amount],
            ["For", purpose],
            ["Charge", plain(text(invoice, "chargeKind"))],
            ["Method", method],
            ["Paid on", when(text(target, "occurredAt"))],
            ["Payment reference", text(target, "manualReference")],
            ["Invoice", text(invoice, "invoiceReference")],
            ["Invoice status", plain(text(invoice, "status"))],
            recordedBy,
          ]),
        },
      };
    }

    if (collection === "invoices") {
      const payer = await payerName(base, target, target);
      const amount = money(count(target, "totalMinor") ?? count(audit, "amountMinor"));
      const purpose = text(target, "description");
      const status = plain(text(target, "status"));
      const who = payer.name ?? actor;
      return {
        message: `${title}: ${amount ?? "invoice"}${payer.name ? ` for ${payer.name}` : ""}${purpose ? `, ${purpose}` : ""}.`,
        studentId: payer.studentId,
        membershipId: text(target, "membershipId"),
        details: {
          from: who,
          amount,
          facts: facts([
            ["Billed to", payer.name],
            ["Amount", amount],
            ["For", purpose],
            ["Charge", plain(text(target, "chargeKind"))],
            ["Status", status],
            ["Due", when(text(target, "dueAt"), false)],
            ["Paid on", when(text(target, "paidAt"))],
            ["Invoice", text(target, "invoiceReference")],
            recordedBy,
          ]),
        },
      };
    }

    if (collection === "memberships") {
      const studentId = text(target, "studentId");
      const member = await studentName(base, studentId);
      const plan = await planName(base, text(target, "planId"));
      const status = plain(text(target, "status"));
      const who = member ?? actor;
      return {
        message: `${who}: ${plan ?? "subscription"}${status ? `, now ${status.toLowerCase()}` : ""}.`,
        studentId,
        membershipId: id,
        details: {
          from: who,
          amount: null,
          facts: facts([
            ["Member", member],
            ["Plan", plan],
            ["Status", status],
            ["Starts", when(text(target, "startsAt"), false)],
            ["Ends", when(text(target, "endsAt"), false) ?? "No end date"],
            ["Next billing", when(text(target, "nextBillingAt"), false)],
            ["Changed by", actor],
          ]),
        },
      };
    }

    if (collection === "enrolmentRequests") {
      const applicant = record(target, "applicant");
      const minors = Array.isArray(target?.minors) ? (target.minors as Data[]) : [];
      const selections = record(target, "planSelections");
      const planIds = [
        text(selections, "applicant"),
        ...(Array.isArray(selections?.minors) ? (selections.minors as unknown[]) : []),
      ].filter((plan): plan is string => typeof plan === "string");
      const plans = await Promise.all([...new Set(planIds)].map((plan) => planName(base, plan)));
      const payment = record(target, "payment");
      const amount = money(count(payment, "amountMinor"));
      const who = text(applicant, "fullName") ?? actor;
      const people = [
        target?.applicantIsStudent === true ? text(applicant, "fullName") : null,
        ...minors.map((minor) => text(minor, "fullName")),
      ].filter(Boolean);
      return {
        message: `${who} registered ${people.length === 1 ? people[0] : `${people.length} people`}${
          amount ? ` and paid ${amount}` : ""
        }.`,
        studentId: null,
        membershipId: null,
        details: {
          from: who,
          amount,
          facts: facts([
            ["Applicant", text(applicant, "fullName")],
            ["Email", text(applicant, "email")],
            ["Phone", text(applicant, "phoneNumber")],
            ["Training", people.join(", ")],
            ["Plans", plans.filter(Boolean).join(", ")],
            ["Amount paid", amount],
            ["Paid on", when(text(payment, "paidOn"), false)],
            ["Bank reference", text(payment, "reference")],
            ["Status", plain(text(target, "status"))],
            ["Office note", text(target, "reviewNote")],
            ["Problem", plain(text(target, "approvalFailureCode"))],
            ["Submitted", when(text(target, "submittedAt"))],
            [audit.actorId === text(target, "submittedBy") ? "Sent by" : "Handled by", actor],
          ]),
        },
      };
    }

    if (collection === "students") {
      const who = text(target, "fullName") ?? actor;
      return {
        message: `${who} was added to the member directory.`,
        studentId: id,
        membershipId: null,
        details: {
          from: who,
          amount: null,
          facts: facts([
            ["Member", text(target, "fullName")],
            ["Type", plain(text(target, "participantType"))],
            ["Training centre", text(target, "trainingCenter")],
            ["Email", text(target, "email")],
            ["Phone", text(target, "phoneNumber")],
            ["Added by", actor],
          ]),
        },
      };
    }

    if (collection === "sessions") {
      const classTitle = text(target, "title") ?? "Class";
      const startsAt = when(text(target, "startAt"));
      return {
        message: `${classTitle}${startsAt ? ` on ${startsAt}` : ""} was cancelled because too few members booked.`,
        studentId: null,
        membershipId: null,
        details: {
          from: classTitle,
          amount: null,
          facts: facts([
            ["Class", classTitle],
            ["Starts", startsAt],
            ["Centre", text(target, "locationId")],
            ["Coach", text(target, "instructorName")],
            ["Minimum", count(target, "minParticipants")?.toString()],
            ["Reason", text(target, "cancellationReason")],
            ["Cancelled by", actor],
          ]),
        },
      };
    }
    return null;
  }

  /** A member's own transfer, sent from My plan with a screenshot; the office approves it. */
  async function describeApplication(application: Data): Promise<DescribedNotice> {
    const payer =
      (await name(text(application, "applicantUid"))) ?? text(application, "studentName");
    const member = text(application, "studentName");
    const who = payer ?? member ?? "Member";
    const perClass = text(application, "billingPeriod") === "per-session";
    const amount = perClass ? null : money(count(application, "priceMinor"));
    const plan = text(application, "planName");
    return {
      message: amount
        ? `${who} paid ${amount} by bank transfer for ${plan ?? "a plan"}${member && member !== who ? ` (${member})` : ""}. Check the transfer and approve it.`
        : `${who} chose ${plan ?? "a plan"}${member && member !== who ? ` for ${member}` : ""}. Review and approve it.`,
      studentId: text(application, "studentId"),
      membershipId: null,
      details: {
        from: who,
        amount,
        facts: facts([
          ["Paid by", payer],
          ["Member", member],
          ["Plan", plan],
          ["Amount", amount ?? (perClass ? "Paid per class" : null)],
          ["Billing", plain(text(application, "billingPeriod"))],
          ["Method", amount ? "Bank transfer" : null],
          ["Bank reference", text(application, "bankReference")],
          ["Proof", text(application, "proofId") ? "Screenshot attached" : null],
          ["Centre", text(application, "site")],
          ["Sent", when(text(application, "createdAt"))],
        ]),
      },
    };
  }

  return Object.freeze({ describe, describeApplication });
}
