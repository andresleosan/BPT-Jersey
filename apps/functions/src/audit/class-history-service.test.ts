import { describe, expect, it } from "vitest";

import {
  readClassHistory,
  type ClassHistoryActor,
  type ClassHistoryQuery,
  type ClassHistorySession,
  type ClassHistoryStore,
  type ClassHistoryStoredEvent,
} from "./class-history-service.js";
import type { ListClassHistoryInput } from "@bpt-jersey/domain/audit/class-history";

const ownerActor: ClassHistoryActor = {
  uid: "owner-1",
  academyId: "demo-academy",
  role: "owner",
};
const adminActor: ClassHistoryActor = {
  uid: "admin-1",
  academyId: "demo-academy",
  role: "administrator",
};
const coachActor: ClassHistoryActor = {
  uid: "coach-1",
  academyId: "demo-academy",
  role: "headCoach",
};

const input: ListClassHistoryInput = {
  academyId: "demo-academy",
  since: "2026-09-01T00:00:00.000Z",
  actorId: null,
  registrationType: "all",
  limit: 200,
  cursor: null,
};

const memberBooking: ClassHistoryStoredEvent = {
  id: "event-1",
  occurredAt: "2026-09-16T10:00:00.000Z",
  action: "booking.created",
  actorId: "s1",
  actorRole: "adultStudent",
  actorGroup: "member",
  actorName: null,
  actorIp: "82.112.144.10",
  source: "bpt",
  class: {
    studentId: "s1",
    memberId: null,
    studentName: null,
    sessionId: "session-1",
    sessionStartAt: "2026-09-16T17:30:00.000Z",
    programId: "program-1",
    locationId: "location-1",
  },
};

const staffBooking: ClassHistoryStoredEvent = {
  id: "event-2",
  occurredAt: "2026-09-16T11:00:00.000Z",
  action: "booking.created",
  actorId: "coach-9",
  actorRole: "coach",
  actorGroup: "staff",
  actorName: null,
  actorIp: "82.112.144.11",
  source: "bpt",
  class: {
    studentId: "s2",
    memberId: null,
    studentName: null,
    sessionId: "session-1",
    sessionStartAt: "2026-09-16T17:30:00.000Z",
    programId: "program-1",
    locationId: "location-1",
  },
};

const importedEvent: ClassHistoryStoredEvent = {
  id: "event-3",
  occurredAt: "2026-09-15T09:00:00.000Z",
  action: "booking.created",
  actorId: "regyfit-import",
  actorRole: "regyfit",
  actorGroup: "member",
  actorName: null,
  actorIp: null,
  source: "regyfit",
  class: {
    studentId: null,
    memberId: null,
    studentName: "Olivia Lewis",
    sessionId: "session-1",
    sessionStartAt: "2026-09-16T17:30:00.000Z",
    programId: "program-1",
    locationId: null,
  },
};

/** An attendance row written before the class block existed: no class, no session, no student. */
const legacyAttendanceEvent: ClassHistoryStoredEvent = {
  id: "event-4",
  occurredAt: "2026-05-02T08:00:00.000Z",
  action: "attendance.checked_in",
  actorId: "coach-9",
  actorRole: "coach",
  actorGroup: "staff",
  actorName: null,
  actorIp: null,
  source: "bpt",
  class: null,
};

type FakeStore = ClassHistoryStore & {
  events: ClassHistoryStoredEvent[];
  students: Map<string, string>;
  sessions: Map<string, ClassHistorySession>;
  staff: Map<string, string>;
  members: Map<string, string>;
  directoryMembers: Map<string, string>;
  lastQuery: ClassHistoryQuery | null;
  readStudentCalls: string[][];
  readSessionCalls: string[][];
  readStaffCalls: string[][];
  readMemberCalls: string[][];
  readDirectoryMemberCalls: string[][];
};

function createStore(): FakeStore {
  const store: FakeStore = {
    events: [memberBooking, staffBooking],
    students: new Map([
      ["s1", "Mia Perez"],
      ["s2", "Noah Grant"],
    ]),
    sessions: new Map([
      [
        "session-1",
        { startAt: "2026-09-16T17:30:00.000Z", programId: "program-1", programName: "Adults Gi" },
      ],
    ]),
    staff: new Map([["coach-9", "Coach Ana"]]),
    members: new Map([["s1", "Mia Perez"]]),
    directoryMembers: new Map([["member-7", "Olivia Lewis"]]),
    lastQuery: null,
    readStudentCalls: [],
    readSessionCalls: [],
    readStaffCalls: [],
    readMemberCalls: [],
    readDirectoryMemberCalls: [],
    queryEvents: (query) => {
      store.lastQuery = query;
      return Promise.resolve(store.events);
    },
    readStudents: (ids) => {
      store.readStudentCalls.push([...ids]);
      return Promise.resolve(store.students);
    },
    readSessions: (ids) => {
      store.readSessionCalls.push([...ids]);
      return Promise.resolve(store.sessions);
    },
    readStaffNames: (ids) => {
      store.readStaffCalls.push([...ids]);
      return Promise.resolve(store.staff);
    },
    readMemberNames: (uids) => {
      store.readMemberCalls.push([...uids]);
      return Promise.resolve(store.members);
    },
    readDirectoryMemberNames: (memberIds) => {
      store.readDirectoryMemberCalls.push([...memberIds]);
      return Promise.resolve(store.directoryMembers);
    },
  };
  return store;
}

describe("readClassHistory", () => {
  it("clamps the limit to the Regyfit range", async () => {
    const store = createStore();

    await readClassHistory(store, { ...input, limit: 5000 }, adminActor);
    expect(store.lastQuery?.limit).toBe(1000);

    await readClassHistory(store, { ...input, limit: 1 }, adminActor);
    expect(store.lastQuery?.limit).toBe(100);
  });

  it("asks Firestore for the actions and groups of the chosen type", async () => {
    const store = createStore();

    await readClassHistory(store, { ...input, registrationType: "coach-bookings" }, adminActor);

    expect(store.lastQuery).toMatchObject({
      actions: ["booking.created"],
      groups: ["staff"],
      academyId: "demo-academy",
      since: "2026-09-01T00:00:00.000Z",
      actorId: null,
      cursor: null,
    });
  });

  it("resolves each distinct student once", async () => {
    const store = createStore();
    store.events = [memberBooking, staffBooking, { ...memberBooking, id: "event-1b" }];

    await readClassHistory(store, input, adminActor);

    expect(store.readStudentCalls).toEqual([["s1", "s2"]]);
    expect(store.readSessionCalls).toEqual([["session-1"]]);
    expect(store.readStaffCalls).toEqual([["coach-9"]]);
    expect(store.readMemberCalls).toEqual([["s1"]]);
  });

  it("shows Former member when the student no longer exists", async () => {
    const store = createStore();
    store.students = new Map();

    const { rows } = await readClassHistory(store, input, adminActor);

    expect(rows[0]?.studentName).toBe(null);
    expect(rows[0]?.sentence).toBe("Former member booked the class of 16 Sep 2026 at 18:30");
  });

  describe("the name an imported row shows", () => {
    const linkedImport: ClassHistoryStoredEvent = {
      ...importedEvent,
      class: { ...importedEvent.class!, memberId: "member-7", studentName: null },
    };

    it("resolves the member directory rather than storing the name", async () => {
      const store = createStore();
      store.events = [linkedImport];

      const { rows } = await readClassHistory(store, input, adminActor);

      expect(store.readDirectoryMemberCalls).toEqual([["member-7"]]);
      expect(rows[0]?.studentName).toBe("Olivia Lewis");
    });

    it("prefers the resolved member name over a name stored beside it", async () => {
      const store = createStore();
      store.events = [
        { ...linkedImport, class: { ...linkedImport.class!, studentName: "Olivia Lewes" } },
      ];

      const { rows } = await readClassHistory(store, input, adminActor);

      expect(rows[0]?.studentName).toBe("Olivia Lewis");
    });

    it("keeps the captured name for a person the directory never matched", async () => {
      const store = createStore();
      store.events = [importedEvent];

      const { rows } = await readClassHistory(store, input, adminActor);

      expect(store.readDirectoryMemberCalls).toEqual([[]]);
      expect(rows[0]?.studentName).toBe("Olivia Lewis");
    });

    it("falls back to Former member once the linked member is erased", async () => {
      const store = createStore();
      store.events = [linkedImport];
      store.directoryMembers = new Map();

      const { rows } = await readClassHistory(store, input, adminActor);

      // Erasing the member erases their name from the log too: the row names the class, not a
      // stale copy of somebody the directory no longer holds.
      expect(rows[0]?.studentName).toBe(null);
      expect(rows[0]?.sentence).toBe("Former member booked the class of 16 Sep 2026 at 18:30");
    });
  });

  it("hides the IP from an actor who may not read it", async () => {
    const store = createStore();

    const { rows } = await readClassHistory(store, input, coachActor);

    expect(rows[0]?.actorIp).toBe(null);
  });

  it("hides the IP from an administrator, who may not read restricted addresses", async () => {
    const store = createStore();

    const { rows } = await readClassHistory(store, input, adminActor);

    expect(rows[0]?.actorIp).toBe(null);
  });

  it("keeps the IP for an owner", async () => {
    const store = createStore();

    const { rows } = await readClassHistory(store, input, ownerActor);

    expect(rows[0]?.actorIp).toBe("82.112.144.10");
  });

  it("uses the imported name when the event has no student id", async () => {
    const store = createStore();
    store.events = [importedEvent];

    const { rows } = await readClassHistory(store, input, ownerActor);

    expect(rows[0]?.studentName).toBe("Olivia Lewis");
    expect(rows[0]?.sentence).toBe("Olivia Lewis booked the class of 16 Sep 2026 at 18:30");
  });

  it("names the staff member who booked for someone else", async () => {
    const store = createStore();

    const { rows } = await readClassHistory(store, input, ownerActor);

    expect(rows[1]?.actorName).toBe("Coach Ana");
    expect(rows[1]?.sentence).toBe(
      "Noah Grant was booked by Coach Ana into Adults Gi on 16 Sep 2026 at 18:30",
    );
  });

  it("shows Office for a staff actor with no matching staff profile", async () => {
    const store = createStore();
    store.events = [{ ...staffBooking, actorId: "coach-unknown" }];

    const { rows } = await readClassHistory(store, input, ownerActor);

    expect(rows[0]?.actorName).toBe("Office");
    expect(rows[0]?.actorName).not.toBe("coach-unknown");
    expect(rows[0]?.sentence).toBe(
      "Noah Grant was booked by Office into Adults Gi on 16 Sep 2026 at 18:30",
    );
  });

  it("shows the Regyfit user an imported staff row names, never Office", async () => {
    const store = createStore();
    store.events = [
      { ...importedEvent, id: "event-3s", actorGroup: "staff", actorName: "Prof. Charles Tromans" },
    ];

    const { rows } = await readClassHistory(store, input, ownerActor);

    // The actor is a Regyfit user, so the staff lookup can never resolve it: the captured name is
    // the only truthful answer, and it is what the academy saw in Regyfit's own USER column.
    expect(rows[0]?.actorName).toBe("Prof. Charles Tromans");
    expect(rows[0]?.sentence).toBe(
      "Olivia Lewis was booked by Prof. Charles Tromans into Adults Gi on 16 Sep 2026 at 18:30",
    );
  });

  it("still shows Office for a BPT staff row with no profile, whatever name it stored", async () => {
    const store = createStore();
    store.events = [
      { ...staffBooking, actorId: "coach-unknown", actorName: "Somebody Else", source: "bpt" },
    ];

    const { rows } = await readClassHistory(store, input, ownerActor);

    // A name stored on a BPT-written row would be a fabrication: only an import carries one.
    expect(rows[0]?.actorName).toBe("Office");
    expect(rows[0]?.sentence).toBe(
      "Noah Grant was booked by Office into Adults Gi on 16 Sep 2026 at 18:30",
    );
  });

  it("names the member who booked by resolving their uid to the student record", async () => {
    const store = createStore();

    const { rows } = await readClassHistory(store, input, ownerActor);

    // The writers store actorName: null for every member row, so an empty USER column here would
    // be exactly what production shows.
    expect(memberBooking.actorName).toBe(null);
    expect(rows[0]?.actorName).toBe("Mia Perez");
    expect(rows[0]?.actorName).not.toBe(memberBooking.actorId);
  });

  it("labels a member actor with no student record of their own as Member", async () => {
    const store = createStore();
    // A guardian books for their child: the uid holds no student record, so nothing resolves.
    store.events = [{ ...memberBooking, actorId: "uid-guardian" }];

    const { rows } = await readClassHistory(store, input, ownerActor);

    expect(rows[0]?.actorName).toBe("Member");
    expect(rows[0]?.actorName).not.toBe("uid-guardian");
  });

  it("still returns a row for an attendance event stored without a class block", async () => {
    const store = createStore();
    store.events = [legacyAttendanceEvent];

    const { rows, total } = await readClassHistory(store, input, ownerActor);

    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      id: "event-4",
      sessionId: null,
      sessionStartAt: null,
      studentId: null,
      studentName: null,
      programName: null,
      sentence: "Attendance was marked",
    });
    expect(store.readSessionCalls).toEqual([[]]);
  });

  it("renders an imported row whose class predates the BPT schedule from its own moment", async () => {
    const store = createStore();
    store.events = [
      {
        ...importedEvent,
        class: {
          studentId: null,
          memberId: null,
          studentName: "Ana Lewis",
          sessionId: null,
          sessionStartAt: "2026-03-12T18:30:00.000Z",
          programId: null,
          locationId: null,
        },
      },
    ];

    const { rows, total } = await readClassHistory(store, input, ownerActor);

    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      id: "event-3",
      sessionId: null,
      sessionStartAt: "2026-03-12T18:30:00.000Z",
      studentName: "Ana Lewis",
      programName: null,
      sentence: "Ana Lewis booked the class of 12 Mar 2026 at 18:30",
    });
    // Nothing to resolve, so the null id never reaches the store as a document read.
    expect(store.readSessionCalls).toEqual([[]]);
  });

  it("returns as many rows as the store answered", async () => {
    const store = createStore();

    const { rows, total } = await readClassHistory(store, input, ownerActor);

    expect(rows).toHaveLength(2);
    expect(total).toBe(2);
  });
});
