import { academyContent } from "../../../../content/academy";

export type StaffOption = Readonly<{
  staffKey: string;
  role: string;
  active: boolean;
  status: string;
  self: boolean;
  /** The account's display name, from listStaffProfiles (ADR-010, 2026-10-12). */
  name?: string | null;
}>;

// Public teaching identities do not provision staff accounts or confer staff permissions.
export const academyTrainers: readonly StaffOption[] = academyContent.instructors.map((row) => ({
  staffKey: row.id,
  role: "coach",
  active: true,
  status: "active",
  self: false,
}));

/**
 * The website roster's public name first, then the account's display name: coaches given access
 * from their member account are not on the website and used to show as their raw key.
 */
export function trainerName(id: string, staff: readonly StaffOption[] = []): string {
  return (
    academyContent.instructors.find((row) => row.id === id)?.name ??
    (staff.find((row) => row.staffKey === id)?.name || id)
  );
}

export function trainerOptions(staff: readonly StaffOption[]): readonly StaffOption[] {
  const options = new Map(academyTrainers.map((row) => [row.staffKey, row]));
  for (const row of staff) options.set(row.staffKey, row);
  return [...options.values()];
}
