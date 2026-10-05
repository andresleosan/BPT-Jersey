import { err, ok, type Result } from "../result";

export type AgeCapacity = Readonly<{ age: number; capacity: number }>;

/** Absence means the historical total-capacity policy. [] explicitly clears limits. */
export function parseAgeCapacities(value: unknown, total: number | null = 300): Result<readonly AgeCapacity[], string> {
  if (value === undefined) return ok([]);
  if (!Array.isArray(value) || value.length > 121) return err("Age limits must be a list");
  const ages = new Set<number>();
  for (const row of value) {
    if (!row || typeof row !== "object" || Object.keys(row).some((key) => !["age", "capacity"].includes(key)) ||
      !Number.isInteger(row.age) || row.age < 0 || row.age > 120 || ages.has(row.age) ||
      !Number.isInteger(row.capacity) || row.capacity < 1 || row.capacity > (total ?? 300)) {
      return err("Use each age once (0-120), with places between 1 and the maximum capacity");
    }
    ages.add(row.age);
  }
  return ok(value.map((row) => ({ age: row.age as number, capacity: row.capacity as number })).sort((a, b) => a.age - b.age));
}

export type AgeAvailability = Readonly<{ age: number; capacity: number; occupied: number }>;
