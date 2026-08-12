export type PreviewStatus = "active" | "attention" | "scheduled" | "completed" | "overdue";

export type PreviewMember = Readonly<{
  membershipNumber: string;
  fullName: string;
  email: string;
  idCardNumber: string;
  vatNumber: string;
  birthDate: string;
  mobileNumber: string;
  frequency: string;
  paymentStatus: "regularized" | "overdue";
  membershipStatus: "active" | "inactive" | "suspended";
  gender: "male" | "female" | "unknown";
  trainingCenter: string;
}>;

export type PreviewClass = Readonly<{
  name: string;
  group: string;
  coach: string;
  time: string;
  location: string;
  capacity: number;
  booked: number;
  status: PreviewStatus;
}>;

export type PreviewGroup = Readonly<{
  name: string;
  program: string;
  coach: string;
  level: string;
  schedule: string;
  capacity: number;
  members: number;
  trainingCenter: string;
  status: "active" | "archived";
}>;

export type PreviewActivity = Readonly<{
  name: string;
  program: string;
  coach: string;
  date: string;
  time: string;
  location: string;
  capacity: number;
  booked: number;
  status: "scheduled" | "completed" | "cancelled";
}>;

export type PreviewAttendance = Readonly<{
  student: string;
  group: string;
  session: string;
  coach: string;
  checkIn: string;
  state: "Present" | "Late" | "Absent" | "No-show";
}>;

export type PreviewPayment = Readonly<{
  member: string;
  reference: string;
  date: string;
  amount: string;
  status: "Paid" | "Pending" | "Overdue";
}>;

export type PreviewReport = Readonly<{
  title: string;
  description: string;
  updated: string;
}>;

export const previewData = Object.freeze({
  environment: "synthetic-preview" as const,
  dashboard: Object.freeze({
    classesToday: 8,
    activeMembers: 126,
    attendancePending: 14,
    overduePayments: 7,
    todaysClasses: Object.freeze([
      {
        name: "Kids Gi Fundamentals",
        group: "Little Warriors",
        coach: "Coach Alex",
        time: "16:00",
        location: "St. Helier",
        capacity: 24,
        booked: 19,
        status: "scheduled" as const,
      },
      {
        name: "Adult No-Gi",
        group: "Adult No-Gi",
        coach: "Coach Bruno",
        time: "18:30",
        location: "St. Helier",
        capacity: 28,
        booked: 24,
        status: "attention" as const,
      },
      {
        name: "Competition Team",
        group: "Competition",
        coach: "Head Coach",
        time: "20:00",
        location: "St. Helier",
        capacity: 18,
        booked: 16,
        status: "scheduled" as const,
      },
    ] satisfies readonly PreviewClass[]),
    recentActions: Object.freeze([
      "3 new members added",
      "Kids Gi attendance awaiting review",
      "2 membership renewals due this week",
    ]),
  }),
  members: Object.freeze([
    {
      membershipNumber: "BPT-1042",
      fullName: "Jordan Blake",
      email: "jordan.blake@example.test",
      idCardNumber: "ID-PREVIEW-1042",
      vatNumber: "VAT-PREVIEW-1042",
      birthDate: "1994-06-18",
      mobileNumber: "+4415345551042",
      frequency: "twice-weekly",
      paymentStatus: "regularized" as const,
      membershipStatus: "active" as const,
      gender: "unknown" as const,
      trainingCenter: "St. Helier",
    },
    {
      membershipNumber: "BPT-1043",
      fullName: "Taylor Morgan",
      email: "taylor.morgan@example.test",
      idCardNumber: "ID-PREVIEW-1043",
      vatNumber: "VAT-PREVIEW-1043",
      birthDate: "2012-03-21",
      mobileNumber: "+4415345551043",
      frequency: "weekly",
      paymentStatus: "overdue" as const,
      membershipStatus: "active" as const,
      gender: "female" as const,
      trainingCenter: "St. Helier",
    },
  ] satisfies readonly PreviewMember[]),
  groups: Object.freeze([
    {
      name: "Little Warriors",
      program: "Brazilian Jiu-Jitsu",
      coach: "Coach Alex",
      level: "Kids / Beginner",
      schedule: "Mon & Wed · 16:00",
      capacity: 24,
      members: 19,
      trainingCenter: "St. Helier",
      status: "active" as const,
    },
    {
      name: "Adult No-Gi",
      program: "Brazilian Jiu-Jitsu",
      coach: "Coach Bruno",
      level: "Adult / Mixed",
      schedule: "Tue & Thu · 18:30",
      capacity: 28,
      members: 24,
      trainingCenter: "St. Helier",
      status: "active" as const,
    },
  ] satisfies readonly PreviewGroup[]),
  activities: Object.freeze([
    {
      name: "Kids Gi Fundamentals",
      program: "Brazilian Jiu-Jitsu",
      coach: "Coach Alex",
      date: "Today",
      time: "16:00",
      location: "St. Helier",
      capacity: 24,
      booked: 19,
      status: "scheduled" as const,
    },
    {
      name: "Adult No-Gi",
      program: "Brazilian Jiu-Jitsu",
      coach: "Coach Bruno",
      date: "Today",
      time: "18:30",
      location: "St. Helier",
      capacity: 28,
      booked: 24,
      status: "scheduled" as const,
    },
  ] satisfies readonly PreviewActivity[]),
  attendance: Object.freeze([
    {
      student: "Jordan Blake",
      group: "Adult No-Gi",
      session: "Today · 18:30",
      coach: "Coach Bruno",
      checkIn: "18:21",
      state: "Present" as const,
    },
    {
      student: "Taylor Morgan",
      group: "Little Warriors",
      session: "Today · 16:00",
      coach: "Coach Alex",
      checkIn: "16:08",
      state: "Late" as const,
    },
    {
      student: "Casey Reed",
      group: "Adult No-Gi",
      session: "Today · 18:30",
      coach: "Coach Bruno",
      checkIn: "-",
      state: "No-show" as const,
    },
  ] satisfies readonly PreviewAttendance[]),
  payments: Object.freeze([
    {
      member: "Jordan Blake",
      reference: "MEM-1042",
      date: "12 Aug 2026",
      amount: "£85.00",
      status: "Paid" as const,
    },
    {
      member: "Taylor Morgan",
      reference: "MEM-1043",
      date: "10 Aug 2026",
      amount: "£65.00",
      status: "Overdue" as const,
    },
  ] satisfies readonly PreviewPayment[]),
  reports: Object.freeze([
    {
      title: "Member directory",
      description: "Search, filter, and review member records.",
      updated: "Updated today",
    },
    {
      title: "Attendance overview",
      description: "Review attendance, late arrivals, and no-shows.",
      updated: "Updated today",
    },
    {
      title: "Membership revenue",
      description: "Track payments, renewals, and balances.",
      updated: "Updated yesterday",
    },
  ] satisfies readonly PreviewReport[]),
});
