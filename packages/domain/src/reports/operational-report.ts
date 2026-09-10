import { err, ok, type Result } from "../result";

const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const MAX_REPORT_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

export type OperationalReportQuery = Readonly<{
  from: string;
  to: string;
}>;

export type OperationalReportStudentInput = Readonly<{
  studentId: string;
  status: "active" | "inactive" | "suspended";
  participantType: "adult" | "minor";
  trainingCenter: "Town" | "West";
}>;

export type OperationalReportAttendanceInput = Readonly<{
  attendanceId: string;
  state: "attended" | "late" | "absent" | "no_show" | "excused";
  occurredAt: string;
  correctionOf: string | null;
}>;

export type OperationalReportMembershipInput = Readonly<{
  membershipId: string;
  studentId: string;
  status: "trial" | "active" | "paused" | "overdue" | "cancelled";
  updatedAt: string;
}>;

export type OperationalReportInvoiceInput = Readonly<{
  invoiceId: string;
  status: "open" | "partially_paid" | "paid" | "void";
  totalMinor: number;
  createdAt: string;
}>;

export type OperationalReportPaymentInput = Readonly<{
  paymentId: string;
  invoiceId: string;
  amountMinor: number;
  method: "cash" | "bank_transfer" | "other";
  occurredAt: string;
}>;

export type OperationalReport = Readonly<{
  query: OperationalReportQuery;
  students: Readonly<{
    totalStudents: number;
    activeStudents: number;
    inactiveStudents: number;
    suspendedStudents: number;
    activeAdults: number;
    activeMinors: number;
    activeTown: number;
    activeWest: number;
  }>;
  attendance: Readonly<{
    totalRecords: number;
    checkedIn: number;
    attended: number;
    late: number;
    absent: number;
    noShow: number;
    excused: number;
    attendanceRatePercentage: number;
  }>;
  memberships: Readonly<{
    currentMemberships: number;
    trial: number;
    active: number;
    paused: number;
    overdue: number;
    cancelled: number;
  }>;
  revenue: Readonly<{
    currency: "GBP";
    issuedMinor: number;
    receivedMinor: number;
    outstandingMinor: number;
    invoiceCount: number;
    openInvoiceCount: number;
    partiallyPaidInvoiceCount: number;
    paidInvoiceCount: number;
    voidedInvoiceCount: number;
    paymentCount: number;
    paymentsByMethod: Readonly<{
      cash: number;
      bankTransfer: number;
      other: number;
    }>;
  }>;
  calculatedAt: string;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" && dateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseOperationalReportQuery(
  value: unknown,
): Result<OperationalReportQuery, string> {
  if (!isPlainRecord(value) || !exactFields(value, ["from", "to"])) {
    return err("Operational report query must contain only from and to");
  }
  if (!isIsoDateTime(value.from) || !isIsoDateTime(value.to)) {
    return err("Operational report range must use valid ISO 8601 timestamps");
  }

  const fromMs = Date.parse(value.from);
  const toMs = Date.parse(value.to);
  if (toMs < fromMs) {
    return err("Operational report range must end after it starts");
  }
  if (toMs - fromMs > MAX_REPORT_RANGE_MS) {
    return err("Operational report range cannot exceed 31 days");
  }

  return ok(Object.freeze({ from: value.from, to: value.to }));
}

function withinRange(timestamp: string, query: OperationalReportQuery): boolean {
  const value = Date.parse(timestamp);
  return value >= Date.parse(query.from) && value <= Date.parse(query.to);
}

export function buildOperationalReport(input: {
  query: OperationalReportQuery;
  students: readonly OperationalReportStudentInput[];
  attendance: readonly OperationalReportAttendanceInput[];
  memberships: readonly OperationalReportMembershipInput[];
  invoices: readonly OperationalReportInvoiceInput[];
  payments: readonly OperationalReportPaymentInput[];
  now?: string;
}): OperationalReport {
  const students = Array.from(
    new Map(input.students.map((student) => [student.studentId, student])).values(),
  );
  const activeStudents = students.filter((student) => student.status === "active");

  const canonicalAttendance = Array.from(
    new Map(
      input.attendance
        .filter(
          (record) => record.correctionOf === null && withinRange(record.occurredAt, input.query),
        )
        .map((record) => [record.attendanceId, record]),
    ).values(),
  );
  const attendanceCount = (state: OperationalReportAttendanceInput["state"]) =>
    canonicalAttendance.filter((record) => record.state === state).length;
  const attended = attendanceCount("attended");
  const late = attendanceCount("late");
  const absent = attendanceCount("absent");
  const noShow = attendanceCount("no_show");
  const excused = attendanceCount("excused");
  const checkedIn = attended + late;
  const attendanceRateDenominator = checkedIn + absent + noShow;

  const currentMembershipByStudent = new Map<string, OperationalReportMembershipInput>();
  for (const membership of input.memberships) {
    const current = currentMembershipByStudent.get(membership.studentId);
    if (!current || membership.updatedAt.localeCompare(current.updatedAt) > 0) {
      currentMembershipByStudent.set(membership.studentId, membership);
    }
  }
  const memberships = Array.from(currentMembershipByStudent.values());
  const membershipCount = (status: OperationalReportMembershipInput["status"]) =>
    memberships.filter((membership) => membership.status === status).length;

  const invoices = Array.from(
    new Map(
      input.invoices
        .filter((invoice) => withinRange(invoice.createdAt, input.query))
        .map((invoice) => [invoice.invoiceId, invoice]),
    ).values(),
  );
  const payments = Array.from(
    new Map(input.payments.map((payment) => [payment.paymentId, payment])).values(),
  );
  const periodPayments = payments.filter((payment) => withinRange(payment.occurredAt, input.query));
  const paymentsByInvoice = new Map<string, number>();
  for (const payment of payments) {
    paymentsByInvoice.set(
      payment.invoiceId,
      (paymentsByInvoice.get(payment.invoiceId) ?? 0) + payment.amountMinor,
    );
  }
  const billableInvoices = invoices.filter((invoice) => invoice.status !== "void");
  const invoiceStatusCount = (status: OperationalReportInvoiceInput["status"]) =>
    invoices.filter((invoice) => invoice.status === status).length;
  const paymentMethodCount = (method: OperationalReportPaymentInput["method"]) =>
    periodPayments.filter((payment) => payment.method === method).length;

  return Object.freeze({
    query: input.query,
    students: Object.freeze({
      totalStudents: students.length,
      activeStudents: activeStudents.length,
      inactiveStudents: students.filter((student) => student.status === "inactive").length,
      suspendedStudents: students.filter((student) => student.status === "suspended").length,
      activeAdults: activeStudents.filter((student) => student.participantType === "adult").length,
      activeMinors: activeStudents.filter((student) => student.participantType === "minor").length,
      activeTown: activeStudents.filter((student) => student.trainingCenter === "Town").length,
      activeWest: activeStudents.filter((student) => student.trainingCenter === "West").length,
    }),
    attendance: Object.freeze({
      totalRecords: canonicalAttendance.length,
      checkedIn,
      attended,
      late,
      absent,
      noShow,
      excused,
      attendanceRatePercentage:
        attendanceRateDenominator === 0
          ? 0
          : Math.round((checkedIn / attendanceRateDenominator) * 100),
    }),
    memberships: Object.freeze({
      currentMemberships: memberships.length,
      trial: membershipCount("trial"),
      active: membershipCount("active"),
      paused: membershipCount("paused"),
      overdue: membershipCount("overdue"),
      cancelled: membershipCount("cancelled"),
    }),
    revenue: Object.freeze({
      currency: "GBP",
      issuedMinor: billableInvoices.reduce((total, invoice) => total + invoice.totalMinor, 0),
      receivedMinor: periodPayments.reduce((total, payment) => total + payment.amountMinor, 0),
      outstandingMinor: billableInvoices.reduce(
        (total, invoice) =>
          total + Math.max(0, invoice.totalMinor - (paymentsByInvoice.get(invoice.invoiceId) ?? 0)),
        0,
      ),
      invoiceCount: invoices.length,
      openInvoiceCount: invoiceStatusCount("open"),
      partiallyPaidInvoiceCount: invoiceStatusCount("partially_paid"),
      paidInvoiceCount: invoiceStatusCount("paid"),
      voidedInvoiceCount: invoiceStatusCount("void"),
      paymentCount: periodPayments.length,
      paymentsByMethod: Object.freeze({
        cash: paymentMethodCount("cash"),
        bankTransfer: paymentMethodCount("bank_transfer"),
        other: paymentMethodCount("other"),
      }),
    }),
    calculatedAt: input.now ?? new Date().toISOString(),
  });
}

export function isOperationalReport(value: unknown): value is OperationalReport {
  if (
    !isPlainRecord(value) ||
    !exactFields(value, [
      "query",
      "students",
      "attendance",
      "memberships",
      "revenue",
      "calculatedAt",
    ]) ||
    !parseOperationalReportQuery(value.query).ok ||
    !isIsoDateTime(value.calculatedAt)
  ) {
    return false;
  }

  if (
    !isPlainRecord(value.students) ||
    !exactFields(value.students, [
      "totalStudents",
      "activeStudents",
      "inactiveStudents",
      "suspendedStudents",
      "activeAdults",
      "activeMinors",
      "activeTown",
      "activeWest",
    ]) ||
    !Object.values(value.students).every(isNonNegativeInteger)
  ) {
    return false;
  }

  if (
    !isPlainRecord(value.attendance) ||
    !exactFields(value.attendance, [
      "totalRecords",
      "checkedIn",
      "attended",
      "late",
      "absent",
      "noShow",
      "excused",
      "attendanceRatePercentage",
    ]) ||
    !Object.values(value.attendance).every(isNonNegativeInteger) ||
    (value.attendance.attendanceRatePercentage as number) > 100
  ) {
    return false;
  }

  if (
    !isPlainRecord(value.memberships) ||
    !exactFields(value.memberships, [
      "currentMemberships",
      "trial",
      "active",
      "paused",
      "overdue",
      "cancelled",
    ]) ||
    !Object.values(value.memberships).every(isNonNegativeInteger)
  ) {
    return false;
  }

  const students = value.students as OperationalReport["students"];
  const attendance = value.attendance as OperationalReport["attendance"];
  const memberships = value.memberships as OperationalReport["memberships"];
  const attendanceDenominator = attendance.checkedIn + attendance.absent + attendance.noShow;
  if (
    students.totalStudents !==
      students.activeStudents + students.inactiveStudents + students.suspendedStudents ||
    students.activeStudents !== students.activeAdults + students.activeMinors ||
    students.activeStudents !== students.activeTown + students.activeWest ||
    attendance.totalRecords !==
      attendance.attended +
        attendance.late +
        attendance.absent +
        attendance.noShow +
        attendance.excused ||
    attendance.checkedIn !== attendance.attended + attendance.late ||
    attendance.attendanceRatePercentage !==
      (attendanceDenominator === 0
        ? 0
        : Math.round((attendance.checkedIn / attendanceDenominator) * 100)) ||
    memberships.currentMemberships !==
      memberships.trial +
        memberships.active +
        memberships.paused +
        memberships.overdue +
        memberships.cancelled
  ) {
    return false;
  }

  if (
    !isPlainRecord(value.revenue) ||
    !exactFields(value.revenue, [
      "currency",
      "issuedMinor",
      "receivedMinor",
      "outstandingMinor",
      "invoiceCount",
      "openInvoiceCount",
      "partiallyPaidInvoiceCount",
      "paidInvoiceCount",
      "voidedInvoiceCount",
      "paymentCount",
      "paymentsByMethod",
    ]) ||
    value.revenue.currency !== "GBP"
  ) {
    return false;
  }

  const revenue = value.revenue;
  const revenueCounts = [
    "issuedMinor",
    "receivedMinor",
    "outstandingMinor",
    "invoiceCount",
    "openInvoiceCount",
    "partiallyPaidInvoiceCount",
    "paidInvoiceCount",
    "voidedInvoiceCount",
    "paymentCount",
  ];
  if (!revenueCounts.every((field) => isNonNegativeInteger(revenue[field]))) {
    return false;
  }

  if (
    !isPlainRecord(revenue.paymentsByMethod) ||
    !exactFields(revenue.paymentsByMethod, ["cash", "bankTransfer", "other"]) ||
    !Object.values(revenue.paymentsByMethod).every(isNonNegativeInteger)
  ) {
    return false;
  }

  return (
    revenue.invoiceCount ===
      (revenue.openInvoiceCount as number) +
        (revenue.partiallyPaidInvoiceCount as number) +
        (revenue.paidInvoiceCount as number) +
        (revenue.voidedInvoiceCount as number) &&
    revenue.paymentCount ===
      (revenue.paymentsByMethod.cash as number) +
        (revenue.paymentsByMethod.bankTransfer as number) +
        (revenue.paymentsByMethod.other as number)
  );
}
