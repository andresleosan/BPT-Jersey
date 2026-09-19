import { expect, it, vi } from "vitest";
const call = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({ httpsCallable: () => call }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));
import { getMemberClassRecords } from "./member-class-records-client";
it("validates scope and kind, refuses extra fields and translates cursor failures safely", async () => {
  const input = { studentId: "s", kind: "bookings" as const };
  for (const data of [
    { studentId: "sibling", kind: "bookings", rows: [], nextCursor: null },
    { studentId: "s", kind: "attendance", rows: [], nextCursor: null },
    { ...input, rows: [], nextCursor: null, notes: "private" },
  ]) {
    call.mockResolvedValueOnce({ data });
    await expect(getMemberClassRecords(input)).rejects.toThrow(
      "Unable to load class history. Refresh to try again.",
    );
  }
  call.mockRejectedValueOnce({ code: "functions/aborted", message: "private backend" });
  await expect(getMemberClassRecords(input)).rejects.toThrow(
    "History changed; refresh to load the latest records.",
  );
  call.mockResolvedValueOnce({ data: { ...input, rows: [], nextCursor: null } });
  expect(await getMemberClassRecords(input)).toEqual({ ...input, rows: [], nextCursor: null });
});
