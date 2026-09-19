import { expect, it, vi } from "vitest";
import {
  listMemberClassRecordsPage,
  type MemberClassReader,
  type MemberClassStore,
} from "./member-class-records-service.js";
const at = "2026-09-20T10:00:00.000Z";
const state = {
  stateId: "current",
  academyId: "a",
  readerVersion: "canonical-v1",
  directoryWriteMode: "canonical-v1",
  freezeStatus: "open",
  stateRevision: 0,
  globalLegacyReadEliminated: false,
  identityKeyCoverage: "complete",
  digestVersion: "hmac-sha256-v1",
  secretVersion: "v1",
  identityKeyBaselineMac: "a".repeat(64),
  identityKeyBaselineArtifactId: "baseline",
  rollbackProtocolVersion: "legacy-projection-v1",
  rollbackCapacityLimit: 400,
  rollbackEligibleStudentCount: 1,
  operationPhase: "idle",
  lastCommittedChunkNo: 0,
  schemaVersion: "1",
  createdAt: at,
  updatedAt: at,
  createdBy: "u",
  updatedBy: "u",
};
const student = {
  studentId: "s",
  academyId: "a",
  fullName: "Fixture",
  participantType: "adult",
  dateOfBirth: "1990-01-01",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: at,
  updatedAt: at,
  createdBy: "u",
  updatedBy: "u",
};
export const booking = (id: string) => ({
  id,
  data: {
    bookingId: id,
    studentId: "s",
    academyId: "a",
    sessionId: "session-" + id,
    status: "confirmed",
    requestedAt: at,
  },
});
function harness() {
  const reader = {
    getState: vi.fn(async () => state),
    getStudent: vi.fn(async () => student),
    getRecord: vi.fn(),
    queryRecords: vi.fn(async () => Array.from({ length: 26 }, (_, i) => booking(String(26 - i)))),
    getSessions: vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => ({ id, data: undefined })),
    ),
  } satisfies MemberClassReader;
  const store: MemberClassStore = { read: async (_academy, work) => work(reader) };
  return { reader, store };
}
it("scans 25 plus lookahead, joins at most 25 sessions and continues from the last scanned event", async () => {
  const h = harness();
  const page = await listMemberClassRecordsPage(
    h.store,
    { academyId: "a", role: "owner" },
    { studentId: "s", kind: "bookings" },
  );
  expect(page.rows).toHaveLength(25);
  expect(page.rows[0]).toEqual({
    recordId: "26",
    session: null,
    requestedAt: at,
    status: "confirmed",
  });
  expect(page.nextCursor).toEqual({ at, recordId: "2" });
  expect(h.reader.queryRecords).toHaveBeenCalledWith({ studentId: "s", kind: "bookings" }, 26);
  expect(h.reader.getSessions.mock.calls[0]![0]).toHaveLength(25);
});
it("advances an all-imported page without joining sessions or fabricating an empty lifetime history", async () => {
  const h = harness();
  h.reader.queryRecords.mockResolvedValue(
    Array.from({ length: 26 }, (_, i) => {
      const row = booking(String(26 - i));
      return { ...row, data: { ...row.data, source: "legacy-import" } };
    }),
  );
  const page = await listMemberClassRecordsPage(
    h.store,
    { academyId: "a", role: "administrator" },
    { studentId: "s", kind: "bookings" },
  );
  expect(page).toEqual({
    studentId: "s",
    kind: "bookings",
    rows: [],
    nextCursor: { at, recordId: "2" },
  });
  expect(h.reader.getSessions).toHaveBeenCalledWith([]);
});
it.each(["coach", "headCoach", "adultStudent"])(
  "denies %s before reading the store",
  async (role) => {
    const h = harness();
    await expect(
      listMemberClassRecordsPage(
        h.store,
        { academyId: "a", role },
        { studentId: "s", kind: "attendance" },
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(h.reader.getState).not.toHaveBeenCalled();
  },
);
it.each(["deleted", "student", "timestamp", "correction"])(
  "rejects a %s cursor before the page query",
  async (kind) => {
    const h = harness();
    const data = {
      attendanceId: "r",
      academyId: "a",
      studentId: kind === "student" ? "sibling" : "s",
      occurredAt: kind === "timestamp" ? "2026-09-19T10:00:00.000Z" : at,
      correctionOf: kind === "correction" ? "original" : null,
    };
    h.reader.getRecord.mockResolvedValue({ id: "r", data: kind === "deleted" ? undefined : data });
    await expect(
      listMemberClassRecordsPage(
        h.store,
        { academyId: "a", role: "owner" },
        { studentId: "s", kind: "attendance", cursor: { at, recordId: "r" } },
      ),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(h.reader.queryRecords).not.toHaveBeenCalled();
  },
);
it("requires an existing student and an open canonical directory", async () => {
  const h = harness();
  h.reader.getStudent.mockResolvedValueOnce(undefined as unknown as typeof student);
  await expect(
    listMemberClassRecordsPage(
      h.store,
      { academyId: "a", role: "owner" },
      { studentId: "s", kind: "bookings" },
    ),
  ).rejects.toMatchObject({ code: "not-found" });
  h.reader.getState.mockResolvedValueOnce({ ...state, freezeStatus: "frozen" });
  await expect(
    listMemberClassRecordsPage(
      h.store,
      { academyId: "a", role: "owner" },
      { studentId: "s", kind: "bookings" },
    ),
  ).rejects.toMatchObject({ code: "failed-precondition" });
  expect(h.reader.queryRecords).not.toHaveBeenCalled();
});
it("returns only validated session labels and fails unknown live provenance", async () => {
  const h = harness();
  h.reader.queryRecords.mockResolvedValue([booking("r")]);
  h.reader.getSessions.mockResolvedValue([
    {
      id: "session-r",
      data: {
        academyId: "a",
        sessionId: "session-r",
        title: "BJJ",
        startAt: at,
        endAt: "2026-09-20T11:00:00.000Z",
        locationId: "town",
        instructorId: "private",
      },
    },
  ] as never);
  const page = await listMemberClassRecordsPage(
    h.store,
    { academyId: "a", role: "owner" },
    { studentId: "s", kind: "bookings" },
  );
  expect(page.rows[0]?.session).toEqual({
    sessionId: "session-r",
    title: "BJJ",
    startAt: at,
    endAt: "2026-09-20T11:00:00.000Z",
    locationId: "town",
  });
  h.reader.queryRecords.mockResolvedValue([
    { ...booking("r"), data: { ...booking("r").data, source: "unknown" } },
  ] as never);
  await expect(
    listMemberClassRecordsPage(
      h.store,
      { academyId: "a", role: "owner" },
      { studentId: "s", kind: "bookings" },
    ),
  ).rejects.toMatchObject({ code: "failed-precondition" });
});
