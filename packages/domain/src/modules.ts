export const domainModules = Object.freeze([
  "access",
  "people",
  "academy",
  "scheduling",
  "attendance",
  "memberships",
  "payments",
  "student-development",
  "safeguarding",
  "crm",
  "communications",
  "documents",
  "reporting",
  "audit",
] as const);

export type DomainModule = (typeof domainModules)[number];
