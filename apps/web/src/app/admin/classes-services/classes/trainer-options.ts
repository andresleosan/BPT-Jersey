import { academyContent } from "../../../../content/academy";

export type StaffOption = Readonly<{
  staffKey: string;
  role: string;
  active: boolean;
  status: string;
  self: boolean;
}>;

// Public teaching identities do not provision staff accounts or confer staff permissions.
export const academyTrainers: readonly StaffOption[] = academyContent.instructors.map((row) => ({
  staffKey: row.id,
  role: "coach",
  active: true,
  status: "active",
  self: false,
}));

export function trainerName(id: string): string {
  return academyContent.instructors.find((row) => row.id === id)?.name ?? id;
}

export function trainerOptions(staff: readonly StaffOption[]): readonly StaffOption[] {
  const options = new Map(academyTrainers.map((row) => [row.staffKey, row]));
  for (const row of staff) options.set(row.staffKey, row);
  return [...options.values()];
}
