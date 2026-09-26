/**
 * The Classes / Services subsections, including office-managed member groups.
 * `staffVisible` is the ADR-010 amendment of 2026-09-14: the mat only gets the three tabs it works
 * from, and the office keeps the remaining tabs.
 */
export type ClassesServicesTab = Readonly<{ label: string; href: string; staffVisible: boolean }>;

export const classesServicesTabs: readonly ClassesServicesTab[] = Object.freeze([
  { label: "Locations", href: "/admin/classes-services/locations", staffVisible: true },
  { label: "Class / Service Types", href: "/admin/classes-services/types", staffVisible: true },
  { label: "Classes & Services 2.0", href: "/admin/classes-services/classes", staffVisible: true },
  {
    label: "Memberships and Vouchers",
    href: "/admin/classes-services/memberships",
    staffVisible: false,
  },
  { label: "Groups", href: "/admin/classes-services/groups", staffVisible: false },
  { label: "Options", href: "/admin/classes-services/options", staffVisible: false },
  { label: "History", href: "/admin/classes-services/history", staffVisible: false },
]);
