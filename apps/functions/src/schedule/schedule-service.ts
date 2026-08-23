import {
  buildAttendanceId,
  buildBookingId,
  buildCheckoutId,
  buildCorrectionAttendanceId,
  buildSessionOperationalView,
  determinePunctuality,
  generateSessionsFromClass,
  isWithinBookingCutoff,
  type AttendanceRecord,
  type BookingRecord,
  type CancelBookingInput,
  type CheckInInput,
  type CheckoutRecord,
  type ClassRecord,
  type CorrectAttendanceInput,
  type CreateClassInput,
  type CreateProgramInput,
  type CreateSessionInput,
  type ListSessionsQuery,
  type LocationRecord,
  type ProgramRecord,
  type RecordCheckoutInput,
  type RequestBookingInput,
  type SessionOperationalView,
  type SessionRecord,
  type UpdateClassInput,
} from "@bpt-jersey/domain/schedule";

export const defaultLocations: readonly LocationRecord[] = Object.freeze([
  {
    locationId: "town",
    academyId: "default",
    name: "BPT Town",
    address: "St Helier, Jersey",
    timezone: "Europe/Jersey",
    active: true,
    schemaVersion: "1",
  },
  {
    locationId: "west",
    academyId: "default",
    name: "BPT West",
    address: "St Peter, Jersey",
    timezone: "Europe/Jersey",
    active: true,
    schemaVersion: "1",
  },
]);

export const defaultPrograms: readonly ProgramRecord[] = Object.freeze([
  {
    programId: "kids-bjj-4-7",
    academyId: "default",
    name: "Kids BJJ (4-7 yrs)",
    ageBand: "kids",
    discipline: "bjj",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "kids-bjj-8-11",
    academyId: "default",
    name: "Kids BJJ (8-11 yrs)",
    ageBand: "kids",
    discipline: "bjj",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "teens-bjj",
    academyId: "default",
    name: "Teens BJJ (12-15 yrs)",
    ageBand: "teens",
    discipline: "bjj",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "adult-fundamentals",
    academyId: "default",
    name: "Adult BJJ Fundamentals",
    ageBand: "adult",
    discipline: "bjj",
    level: "fundamentals",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "adult-advanced",
    academyId: "default",
    name: "Adult BJJ Advanced",
    ageBand: "adult",
    discipline: "bjj",
    level: "advanced",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "open-mat",
    academyId: "default",
    name: "Open Mat",
    ageBand: "all",
    discipline: "open-mat",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "seminar",
    academyId: "default",
    name: "Special Seminar / Workshop",
    ageBand: "all",
    discipline: "bjj",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
]);

export type ScheduleStore = Readonly<{
  listLocations: (academyId: string) => Promise<readonly LocationRecord[]>;
  listPrograms: (academyId: string) => Promise<readonly ProgramRecord[]>;
  createProgram: (academyId: string, input: CreateProgramInput) => Promise<ProgramRecord>;
  updateProgram: (
    academyId: string,
    programId: string,
    input: Partial<CreateProgramInput & { active: boolean }>,
  ) => Promise<ProgramRecord>;
  listClasses: (academyId: string) => Promise<readonly ClassRecord[]>;
  getClass: (academyId: string, classId: string) => Promise<ClassRecord | null>;
  createClass: (
    academyId: string,
    input: CreateClassInput,
    actorId: string,
  ) => Promise<ClassRecord>;
  updateClass: (
    academyId: string,
    input: UpdateClassInput,
    actorId: string,
  ) => Promise<ClassRecord>;
  generateSessions: (
    academyId: string,
    classId: string,
    fromDate: string,
    toDate: string,
    timezone: string,
    actorId: string,
  ) => Promise<readonly SessionRecord[]>;
  listSessions: (academyId: string, query: ListSessionsQuery) => Promise<readonly SessionRecord[]>;
  getSession: (academyId: string, sessionId: string) => Promise<SessionRecord | null>;
  createSession: (
    academyId: string,
    input: CreateSessionInput,
    actorId: string,
  ) => Promise<SessionRecord>;
  cancelSession: (
    academyId: string,
    sessionId: string,
    reason: string,
    actorId: string,
  ) => Promise<SessionRecord>;
  requestBooking: (
    academyId: string,
    input: RequestBookingInput,
    actorId: string,
  ) => Promise<BookingRecord>;
  cancelBooking: (
    academyId: string,
    input: CancelBookingInput,
    actorId: string,
    isStaffOverride?: boolean,
  ) => Promise<BookingRecord>;
  listSessionBookings: (academyId: string, sessionId: string) => Promise<readonly BookingRecord[]>;
  listStudentBookings: (academyId: string, studentId: string) => Promise<readonly BookingRecord[]>;
  evaluateSessionMinimum: (
    academyId: string,
    sessionId: string,
  ) => Promise<{ confirmedCount: number; minParticipants: number; quorumMet: boolean }>;
  recordCheckIn: (
    academyId: string,
    input: CheckInInput,
    actorId: string,
    occurredAt?: string,
  ) => Promise<AttendanceRecord>;
  listSessionAttendance: (
    academyId: string,
    sessionId: string,
  ) => Promise<readonly AttendanceRecord[]>;
  listStudentAttendance: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly AttendanceRecord[]>;
  correctAttendance: (
    academyId: string,
    input: CorrectAttendanceInput,
    actorId: string,
    occurredAt?: string,
  ) => Promise<{ correction: AttendanceRecord; canonical: AttendanceRecord }>;
  reconcileSessionNoShows: (
    academyId: string,
    sessionId: string,
    actorId: string,
    occurredAt?: string,
  ) => Promise<{ noShowsMarked: number; records: readonly AttendanceRecord[] }>;
  listAttendanceHistory: (
    academyId: string,
    sessionId: string,
    studentId: string,
  ) => Promise<readonly AttendanceRecord[]>;
  recordCheckout: (
    academyId: string,
    input: RecordCheckoutInput,
    actorId: string,
    occurredAt?: string,
  ) => Promise<CheckoutRecord>;
  listSessionCheckouts: (
    academyId: string,
    sessionId: string,
  ) => Promise<readonly CheckoutRecord[]>;
  getStudentCheckout: (
    academyId: string,
    sessionId: string,
    studentId: string,
  ) => Promise<CheckoutRecord | null>;
  getSessionOperationalView: (
    academyId: string,
    sessionId: string,
  ) => Promise<SessionOperationalView>;
}>;

type GenericQuery = {
  get: () => Promise<{
    docs: Array<{
      id: string;
      data: () => Record<string, unknown>;
    }>;
  }>;
  where: (field: string, op: string, val: unknown) => GenericQuery;
};

type GenericFirestore = {
  collection: (path: string) => {
    doc: (id?: string) => {
      id: string;
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      set: (data: unknown) => Promise<unknown>;
      update: (data: unknown) => Promise<unknown>;
    };
    get: () => Promise<{
      docs: Array<{
        id: string;
        data: () => Record<string, unknown>;
      }>;
    }>;
    where: (field: string, op: string, val: unknown) => GenericQuery;
  };
};

export function createFirestoreScheduleStore(options: {
  firestore: GenericFirestore;
}): ScheduleStore {
  const { firestore } = options;

  return {
    async listLocations(academyId: string): Promise<readonly LocationRecord[]> {
      const snapshot = await firestore.collection(`academies/${academyId}/locations`).get();

      if (snapshot.docs.length === 0) {
        return defaultLocations.map((loc) => ({ ...loc, academyId }));
      }

      return snapshot.docs.map((doc) => doc.data() as LocationRecord);
    },

    async listPrograms(academyId: string): Promise<readonly ProgramRecord[]> {
      const snapshot = await firestore.collection(`academies/${academyId}/programs`).get();

      if (snapshot.docs.length === 0) {
        return defaultPrograms.map((prog) => ({ ...prog, academyId }));
      }

      return snapshot.docs.map((doc) => doc.data() as ProgramRecord);
    },

    async createProgram(academyId: string, input: CreateProgramInput): Promise<ProgramRecord> {
      const docRef = firestore.collection(`academies/${academyId}/programs`).doc();
      const programId = docRef.id;

      const record: ProgramRecord = Object.freeze({
        programId,
        academyId,
        name: input.name,
        ageBand: input.ageBand,
        discipline: input.discipline,
        level: input.level,
        active: true,
        schemaVersion: "1",
      });

      await docRef.set(record);
      return record;
    },

    async updateProgram(
      academyId: string,
      programId: string,
      input: Partial<CreateProgramInput & { active: boolean }>,
    ): Promise<ProgramRecord> {
      const docRef = firestore.collection(`academies/${academyId}/programs`).doc(programId);
      const existing = await docRef.get();

      if (!existing.exists) {
        throw new Error(`Program ${programId} does not exist`);
      }

      const current = existing.data() as ProgramRecord;
      const updated: ProgramRecord = Object.freeze({
        ...current,
        name: input.name ?? current.name,
        ageBand: input.ageBand ?? current.ageBand,
        discipline: input.discipline ?? current.discipline,
        level: input.level ?? current.level,
        active: input.active ?? current.active,
      });

      await docRef.set(updated);
      return updated;
    },

    async listClasses(academyId: string): Promise<readonly ClassRecord[]> {
      const snapshot = await firestore.collection(`academies/${academyId}/classes`).get();

      return snapshot.docs.map((doc) => doc.data() as ClassRecord);
    },

    async getClass(academyId: string, classId: string): Promise<ClassRecord | null> {
      const doc = await firestore.collection(`academies/${academyId}/classes`).doc(classId).get();

      if (!doc.exists) return null;
      return (doc.data() as ClassRecord) ?? null;
    },

    async createClass(
      academyId: string,
      input: CreateClassInput,
      actorId: string,
    ): Promise<ClassRecord> {
      const now = new Date().toISOString();
      const docRef = firestore.collection(`academies/${academyId}/classes`).doc();
      const classId = docRef.id;

      const record: ClassRecord = Object.freeze({
        classId,
        academyId,
        programId: input.programId,
        locationId: input.locationId,
        name: input.name,
        recurrenceRule: input.recurrenceRule,
        instructorIds: input.instructorIds,
        capacity: input.capacity,
        minParticipants: input.minParticipants ?? 4,
        active: true,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      await docRef.set(record);
      return record;
    },

    async updateClass(
      academyId: string,
      input: UpdateClassInput,
      actorId: string,
    ): Promise<ClassRecord> {
      const docRef = firestore.collection(`academies/${academyId}/classes`).doc(input.classId);
      const existing = await docRef.get();

      if (!existing.exists) {
        throw new Error(`Class ${input.classId} does not exist`);
      }

      const current = existing.data() as ClassRecord;
      const now = new Date().toISOString();

      const updated: ClassRecord = Object.freeze({
        ...current,
        name: input.name ?? current.name,
        instructorIds: input.instructorIds ?? current.instructorIds,
        capacity: input.capacity ?? current.capacity,
        minParticipants: input.minParticipants ?? current.minParticipants,
        active: input.active ?? current.active,
        updatedAt: now,
        updatedBy: actorId,
      });

      await docRef.set(updated);
      return updated;
    },

    async generateSessions(
      academyId: string,
      classId: string,
      fromDate: string,
      toDate: string,
      timezone: string,
      actorId: string,
    ): Promise<readonly SessionRecord[]> {
      const docRef = firestore.collection(`academies/${academyId}/classes`).doc(classId);
      const existing = await docRef.get();

      if (!existing.exists) {
        throw new Error(`Class ${classId} does not exist`);
      }

      const cls = existing.data() as ClassRecord;
      const drafts = generateSessionsFromClass(cls, fromDate, toDate, timezone);
      const now = new Date().toISOString();
      const created: SessionRecord[] = [];

      for (const draft of drafts) {
        const sessionRef = firestore
          .collection(`academies/${academyId}/sessions`)
          .doc(draft.sessionId);
        const existingSession = await sessionRef.get();

        if (existingSession.exists) {
          created.push(existingSession.data() as SessionRecord);
        } else {
          const sessionRecord: SessionRecord = Object.freeze({
            ...draft,
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });
          await sessionRef.set(sessionRecord);
          created.push(sessionRecord);
        }
      }

      return created;
    },

    async listSessions(
      academyId: string,
      query: ListSessionsQuery,
    ): Promise<readonly SessionRecord[]> {
      const snapshot = await firestore.collection(`academies/${academyId}/sessions`).get();

      return snapshot.docs
        .map((doc) => doc.data() as SessionRecord)
        .filter((session) => {
          if (session.startAt < query.from || session.startAt > query.to) {
            return false;
          }
          if (query.locationId && session.locationId !== query.locationId) {
            return false;
          }
          if (query.programId && session.programId !== query.programId) {
            return false;
          }
          return true;
        })
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
    },

    async getSession(academyId: string, sessionId: string): Promise<SessionRecord | null> {
      const doc = await firestore
        .collection(`academies/${academyId}/sessions`)
        .doc(sessionId)
        .get();

      if (!doc.exists) return null;
      return (doc.data() as SessionRecord) ?? null;
    },

    async createSession(
      academyId: string,
      input: CreateSessionInput,
      actorId: string,
    ): Promise<SessionRecord> {
      const now = new Date().toISOString();
      const docRef = firestore.collection(`academies/${academyId}/sessions`).doc();
      const sessionId = docRef.id;

      const record: SessionRecord = Object.freeze({
        sessionId,
        academyId,
        classId: input.classId ?? null,
        programId: input.programId,
        locationId: input.locationId,
        instructorId: input.instructorId,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        capacity: input.capacity,
        minParticipants: input.minParticipants ?? 4,
        status: "scheduled",
        isSeminar: input.isSeminar ?? false,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      await docRef.set(record);
      return record;
    },

    async cancelSession(
      academyId: string,
      sessionId: string,
      reason: string,
      actorId: string,
    ): Promise<SessionRecord> {
      const docRef = firestore.collection(`academies/${academyId}/sessions`).doc(sessionId);
      const existing = await docRef.get();

      if (!existing.exists) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const current = existing.data() as SessionRecord;
      const now = new Date().toISOString();

      const cancelled: SessionRecord = Object.freeze({
        ...current,
        status: "cancelled",
        cancellationReason: reason,
        updatedAt: now,
        updatedBy: actorId,
      });

      await docRef.set(cancelled);
      return cancelled;
    },

    async requestBooking(
      academyId: string,
      input: RequestBookingInput,
      actorId: string,
    ): Promise<BookingRecord> {
      const bookingId = buildBookingId(input.sessionId, input.studentId);
      const sessionRef = firestore
        .collection(`academies/${academyId}/sessions`)
        .doc(input.sessionId);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        throw new Error(`Session ${input.sessionId} does not exist`);
      }

      const session = sessionDoc.data() as SessionRecord;
      if (session.status === "cancelled") {
        throw new Error(`Cannot book cancelled session ${input.sessionId}`);
      }

      const bookingRef = firestore.collection(`academies/${academyId}/bookings`).doc(bookingId);
      const existingBookingDoc = await bookingRef.get();

      if (existingBookingDoc.exists) {
        const existing = existingBookingDoc.data() as BookingRecord;
        if (existing.status === "confirmed") {
          return existing;
        }
      }

      // Check capacity
      const bookingsSnapshot = await firestore
        .collection(`academies/${academyId}/bookings`)
        .where("sessionId", "==", input.sessionId)
        .get();

      const confirmedCount = bookingsSnapshot.docs
        .map((d) => d.data() as BookingRecord)
        .filter((b) => b.status === "confirmed" && b.bookingId !== bookingId).length;

      if (confirmedCount >= session.capacity) {
        throw new Error(`Session capacity reached (${session.capacity})`);
      }

      const now = new Date().toISOString();
      const record: BookingRecord = Object.freeze({
        bookingId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        membershipId: input.membershipId,
        status: "confirmed",
        requestedAt: now,
        cancelledAt: null,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: existingBookingDoc.exists
          ? (existingBookingDoc.data() as BookingRecord).createdAt
          : now,
        createdBy: existingBookingDoc.exists
          ? (existingBookingDoc.data() as BookingRecord).createdBy
          : actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      await bookingRef.set(record);
      return record;
    },

    async cancelBooking(
      academyId: string,
      input: CancelBookingInput,
      actorId: string,
      isStaffOverride = false,
    ): Promise<BookingRecord> {
      const bookingId = buildBookingId(input.sessionId, input.studentId);
      const bookingRef = firestore.collection(`academies/${academyId}/bookings`).doc(bookingId);
      const existingDoc = await bookingRef.get();

      if (!existingDoc.exists) {
        throw new Error(`Booking ${bookingId} does not exist`);
      }

      const existing = existingDoc.data() as BookingRecord;

      if (!isStaffOverride) {
        const sessionRef = firestore
          .collection(`academies/${academyId}/sessions`)
          .doc(input.sessionId);
        const sessionDoc = await sessionRef.get();
        if (sessionDoc.exists) {
          const session = sessionDoc.data() as SessionRecord;
          if (!isWithinBookingCutoff(session.startAt)) {
            throw new Error("Cannot cancel within 1 hour of session start without staff override");
          }
        }
      }

      const now = new Date().toISOString();
      const updated: BookingRecord = Object.freeze({
        ...existing,
        status: "cancelled",
        cancelledAt: now,
        cancellationReason: input.reason,
        updatedAt: now,
        updatedBy: actorId,
      });

      await bookingRef.set(updated);
      return updated;
    },

    async listSessionBookings(
      academyId: string,
      sessionId: string,
    ): Promise<readonly BookingRecord[]> {
      const snapshot = await firestore
        .collection(`academies/${academyId}/bookings`)
        .where("sessionId", "==", sessionId)
        .get();

      return snapshot.docs
        .map((d) => d.data() as BookingRecord)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async listStudentBookings(
      academyId: string,
      studentId: string,
    ): Promise<readonly BookingRecord[]> {
      const snapshot = await firestore
        .collection(`academies/${academyId}/bookings`)
        .where("studentId", "==", studentId)
        .get();

      return snapshot.docs
        .map((d) => d.data() as BookingRecord)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async evaluateSessionMinimum(
      academyId: string,
      sessionId: string,
    ): Promise<{ confirmedCount: number; minParticipants: number; quorumMet: boolean }> {
      const sessionRef = firestore.collection(`academies/${academyId}/sessions`).doc(sessionId);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const session = sessionDoc.data() as SessionRecord;
      const minParticipants = session.minParticipants ?? 4;

      const bookingsSnapshot = await firestore
        .collection(`academies/${academyId}/bookings`)
        .where("sessionId", "==", sessionId)
        .get();

      const confirmedCount = bookingsSnapshot.docs
        .map((d) => d.data() as BookingRecord)
        .filter((b) => b.status === "confirmed").length;

      return {
        confirmedCount,
        minParticipants,
        quorumMet: confirmedCount >= minParticipants,
      };
    },

    async recordCheckIn(
      academyId: string,
      input: CheckInInput,
      actorId: string,
      occurredAt?: string,
    ): Promise<AttendanceRecord> {
      const attendanceId = buildAttendanceId(input.sessionId, input.studentId);
      const sessionRef = firestore
        .collection(`academies/${academyId}/sessions`)
        .doc(input.sessionId);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        throw new Error(`Session ${input.sessionId} does not exist`);
      }

      const session = sessionDoc.data() as SessionRecord;
      if (session.status === "cancelled") {
        throw new Error(`Cannot check in to cancelled session ${input.sessionId}`);
      }

      const attendanceRef = firestore
        .collection(`academies/${academyId}/attendance`)
        .doc(attendanceId);
      const existingDoc = await attendanceRef.get();

      if (existingDoc.exists) {
        return existingDoc.data() as AttendanceRecord;
      }

      const checkInTime = occurredAt ?? new Date().toISOString();
      const state = determinePunctuality(session.startAt, checkInTime);

      const record: AttendanceRecord = Object.freeze({
        attendanceId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        method: input.method,
        state,
        occurredAt: checkInTime,
        notes: input.notes ?? null,
        correctionOf: null,
        schemaVersion: "1",
        createdAt: checkInTime,
        createdBy: actorId,
        updatedAt: checkInTime,
        updatedBy: actorId,
      });

      await attendanceRef.set(record);
      return record;
    },

    async listSessionAttendance(
      academyId: string,
      sessionId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const snapshot = await firestore
        .collection(`academies/${academyId}/attendance`)
        .where("sessionId", "==", sessionId)
        .get();

      return snapshot.docs
        .map((d) => d.data() as AttendanceRecord)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    },

    async listStudentAttendance(
      academyId: string,
      studentId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const snapshot = await firestore
        .collection(`academies/${academyId}/attendance`)
        .where("studentId", "==", studentId)
        .get();

      return snapshot.docs
        .map((d) => d.data() as AttendanceRecord)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },

    async correctAttendance(
      academyId: string,
      input: CorrectAttendanceInput,
      actorId: string,
      occurredAt?: string,
    ): Promise<{ correction: AttendanceRecord; canonical: AttendanceRecord }> {
      const canonicalId = buildAttendanceId(input.sessionId, input.studentId);
      const canonicalRef = firestore
        .collection(`academies/${academyId}/attendance`)
        .doc(canonicalId);
      const canonicalDoc = await canonicalRef.get();

      if (!canonicalDoc.exists) {
        throw new Error(`Canonical attendance record ${canonicalId} does not exist`);
      }

      const existingCanonical = canonicalDoc.data() as AttendanceRecord;
      const now = occurredAt ?? new Date().toISOString();
      const correctionId = buildCorrectionAttendanceId();

      const correction: AttendanceRecord = Object.freeze({
        attendanceId: correctionId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        method: existingCanonical.method,
        state: input.newState,
        occurredAt: now,
        notes: input.reason,
        correctionOf: canonicalId,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      const updatedCanonical: AttendanceRecord = Object.freeze({
        ...existingCanonical,
        state: input.newState,
        updatedAt: now,
        updatedBy: actorId,
      });

      await Promise.all([
        firestore.collection(`academies/${academyId}/attendance`).doc(correctionId).set(correction),
        canonicalRef.update(updatedCanonical),
        firestore
          .collection(`academies/${academyId}/auditEvents`)
          .doc(`audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`)
          .set({
            action: "attendance_correction",
            academyId,
            sessionId: input.sessionId,
            studentId: input.studentId,
            previousState: existingCanonical.state,
            newState: input.newState,
            reason: input.reason,
            actorId,
            occurredAt: now,
          }),
      ]);

      return { correction, canonical: updatedCanonical };
    },

    async reconcileSessionNoShows(
      academyId: string,
      sessionId: string,
      actorId: string,
      occurredAt?: string,
    ): Promise<{ noShowsMarked: number; records: readonly AttendanceRecord[] }> {
      const sessionRef = firestore.collection(`academies/${academyId}/sessions`).doc(sessionId);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const bookingsSnapshot = await firestore
        .collection(`academies/${academyId}/bookings`)
        .where("sessionId", "==", sessionId)
        .get();

      const confirmedBookings = bookingsSnapshot.docs
        .map((d) => d.data() as BookingRecord)
        .filter((b) => b.status === "confirmed");

      const attendanceSnapshot = await firestore
        .collection(`academies/${academyId}/attendance`)
        .where("sessionId", "==", sessionId)
        .get();

      const attendedStudentIds = new Set(
        attendanceSnapshot.docs.map((d) => (d.data() as AttendanceRecord).studentId),
      );

      const now = occurredAt ?? new Date().toISOString();
      const records: AttendanceRecord[] = [];

      for (const booking of confirmedBookings) {
        if (!attendedStudentIds.has(booking.studentId)) {
          const attendanceId = buildAttendanceId(sessionId, booking.studentId);
          const noShowRecord: AttendanceRecord = Object.freeze({
            attendanceId,
            academyId,
            sessionId,
            studentId: booking.studentId,
            method: "manual",
            state: "no_show",
            occurredAt: now,
            notes: "Automated no-show reconciliation",
            correctionOf: null,
            schemaVersion: "1",
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });

          await firestore
            .collection(`academies/${academyId}/attendance`)
            .doc(attendanceId)
            .set(noShowRecord);
          records.push(noShowRecord);
          attendedStudentIds.add(booking.studentId);
        }
      }

      return { noShowsMarked: records.length, records };
    },

    async listAttendanceHistory(
      academyId: string,
      sessionId: string,
      studentId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const canonicalId = buildAttendanceId(sessionId, studentId);
      const snapshot = await firestore
        .collection(`academies/${academyId}/attendance`)
        .where("sessionId", "==", sessionId)
        .where("studentId", "==", studentId)
        .get();

      return snapshot.docs
        .map((d) => d.data() as AttendanceRecord)
        .filter((a) => a.attendanceId === canonicalId || a.correctionOf === canonicalId)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    },

    async recordCheckout(
      academyId: string,
      input: RecordCheckoutInput,
      actorId: string,
      occurredAt?: string,
    ): Promise<CheckoutRecord> {
      const checkoutId = buildCheckoutId(input.sessionId, input.studentId);
      const checkoutRef = firestore.collection(`academies/${academyId}/checkouts`).doc(checkoutId);
      const existingDoc = await checkoutRef.get();

      if (existingDoc.exists) {
        return existingDoc.data() as CheckoutRecord;
      }

      // Verify attendance
      const attendanceId = buildAttendanceId(input.sessionId, input.studentId);
      const attendanceDoc = await firestore
        .collection(`academies/${academyId}/attendance`)
        .doc(attendanceId)
        .get();

      if (!attendanceDoc.exists) {
        throw new Error(
          `Student ${input.studentId} did not attend this session ${input.sessionId}`,
        );
      }

      const attendance = attendanceDoc.data() as AttendanceRecord;
      if (attendance.state !== "attended" && attendance.state !== "late") {
        throw new Error(
          `Student ${input.studentId} did not attend this session (state: ${attendance.state})`,
        );
      }

      const now = occurredAt ?? new Date().toISOString();
      const record: CheckoutRecord = Object.freeze({
        checkoutId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        method: input.method,
        authorizedAdultId: input.authorizedAdultId ?? null,
        authorizedAdultName: input.authorizedAdultName ?? null,
        notes: input.notes ?? null,
        checkedOutAt: now,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      await Promise.all([
        checkoutRef.set(record),
        firestore
          .collection(`academies/${academyId}/auditEvents`)
          .doc(`audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`)
          .set({
            action: "child_checkout",
            academyId,
            sessionId: input.sessionId,
            studentId: input.studentId,
            method: input.method,
            authorizedAdultId: input.authorizedAdultId ?? null,
            actorId,
            occurredAt: now,
          }),
      ]);

      return record;
    },

    async listSessionCheckouts(
      academyId: string,
      sessionId: string,
    ): Promise<readonly CheckoutRecord[]> {
      const snapshot = await firestore
        .collection(`academies/${academyId}/checkouts`)
        .where("sessionId", "==", sessionId)
        .get();

      return snapshot.docs
        .map((d) => d.data() as CheckoutRecord)
        .sort((a, b) => a.checkedOutAt.localeCompare(b.checkedOutAt));
    },

    async getStudentCheckout(
      academyId: string,
      sessionId: string,
      studentId: string,
    ): Promise<CheckoutRecord | null> {
      const checkoutId = buildCheckoutId(sessionId, studentId);
      const doc = await firestore
        .collection(`academies/${academyId}/checkouts`)
        .doc(checkoutId)
        .get();

      if (!doc.exists) {
        return null;
      }

      return doc.data() as CheckoutRecord;
    },

    async getSessionOperationalView(
      academyId: string,
      sessionId: string,
    ): Promise<SessionOperationalView> {
      const sessionDoc = await firestore
        .collection(`academies/${academyId}/sessions`)
        .doc(sessionId)
        .get();

      if (!sessionDoc.exists) {
        throw new Error(`Session ${sessionId} not found in academy ${academyId}`);
      }

      const session = sessionDoc.data() as SessionRecord;

      const [bookingsSnap, attendanceSnap, checkoutsSnap] = await Promise.all([
        firestore
          .collection(`academies/${academyId}/bookings`)
          .where("sessionId", "==", sessionId)
          .get(),
        firestore
          .collection(`academies/${academyId}/attendance`)
          .where("sessionId", "==", sessionId)
          .get(),
        firestore
          .collection(`academies/${academyId}/checkouts`)
          .where("sessionId", "==", sessionId)
          .get(),
      ]);

      const bookings = bookingsSnap.docs.map((d) => d.data() as BookingRecord);
      const attendance = attendanceSnap.docs.map((d) => d.data() as AttendanceRecord);
      const checkouts = checkoutsSnap.docs.map((d) => d.data() as CheckoutRecord);

      return buildSessionOperationalView({
        session,
        bookings,
        attendance,
        checkouts,
      });
    },
  };
}

export function createInMemoryScheduleStore(): ScheduleStore {
  const locationsMap = new Map<string, LocationRecord[]>();
  const programsMap = new Map<string, ProgramRecord[]>();
  const classesMap = new Map<string, Map<string, ClassRecord>>();
  const sessionsMap = new Map<string, Map<string, SessionRecord>>();
  const bookingsMap = new Map<string, Map<string, BookingRecord>>();
  const attendanceMap = new Map<string, Map<string, AttendanceRecord>>();
  const checkoutsMap = new Map<string, Map<string, CheckoutRecord>>();

  let classSeq = 1;
  let sessionSeq = 1;

  return {
    async listLocations(academyId: string): Promise<readonly LocationRecord[]> {
      const custom = locationsMap.get(academyId);
      if (!custom || custom.length === 0) {
        return defaultLocations.map((loc) => ({ ...loc, academyId }));
      }
      return custom;
    },

    async listPrograms(academyId: string): Promise<readonly ProgramRecord[]> {
      const custom = programsMap.get(academyId);
      if (!custom || custom.length === 0) {
        return defaultPrograms.map((prog) => ({ ...prog, academyId }));
      }
      return custom;
    },

    async createProgram(academyId: string, input: CreateProgramInput): Promise<ProgramRecord> {
      let list = programsMap.get(academyId);
      if (!list) {
        list = defaultPrograms.map((prog) => ({ ...prog, academyId }));
        programsMap.set(academyId, list);
      }

      const programId = `prog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const record: ProgramRecord = Object.freeze({
        programId,
        academyId,
        name: input.name,
        ageBand: input.ageBand,
        discipline: input.discipline,
        level: input.level,
        active: true,
        schemaVersion: "1",
      });

      list.push(record);
      return record;
    },

    async updateProgram(
      academyId: string,
      programId: string,
      input: Partial<CreateProgramInput & { active: boolean }>,
    ): Promise<ProgramRecord> {
      let list = programsMap.get(academyId);
      if (!list) {
        list = defaultPrograms.map((prog) => ({ ...prog, academyId }));
        programsMap.set(academyId, list);
      }

      const index = list.findIndex((p) => p.programId === programId);
      if (index === -1) {
        throw new Error(`Program ${programId} does not exist`);
      }

      const current = list[index]!;
      const updated: ProgramRecord = Object.freeze({
        ...current,
        name: input.name ?? current.name,
        ageBand: input.ageBand ?? current.ageBand,
        discipline: input.discipline ?? current.discipline,
        level: input.level ?? current.level,
        active: input.active ?? current.active,
      });

      list[index] = updated;
      return updated;
    },

    async listClasses(academyId: string): Promise<readonly ClassRecord[]> {
      const map = classesMap.get(academyId);
      if (!map) return [];
      return Array.from(map.values());
    },

    async getClass(academyId: string, classId: string): Promise<ClassRecord | null> {
      const map = classesMap.get(academyId);
      return map?.get(classId) ?? null;
    },

    async createClass(
      academyId: string,
      input: CreateClassInput,
      actorId: string,
    ): Promise<ClassRecord> {
      const now = new Date().toISOString();
      const classId = `class-${classSeq++}`;
      const record: ClassRecord = Object.freeze({
        classId,
        academyId,
        programId: input.programId,
        locationId: input.locationId,
        name: input.name,
        recurrenceRule: input.recurrenceRule,
        instructorIds: input.instructorIds,
        capacity: input.capacity,
        minParticipants: input.minParticipants ?? 4,
        active: true,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      if (!classesMap.has(academyId)) {
        classesMap.set(academyId, new Map());
      }
      classesMap.get(academyId)!.set(classId, record);
      return record;
    },

    async updateClass(
      academyId: string,
      input: UpdateClassInput,
      actorId: string,
    ): Promise<ClassRecord> {
      const map = classesMap.get(academyId);
      const current = map?.get(input.classId);
      if (!current) {
        throw new Error(`Class ${input.classId} does not exist`);
      }

      const now = new Date().toISOString();
      const updated: ClassRecord = Object.freeze({
        ...current,
        name: input.name ?? current.name,
        instructorIds: input.instructorIds ?? current.instructorIds,
        capacity: input.capacity ?? current.capacity,
        minParticipants: input.minParticipants ?? current.minParticipants,
        active: input.active ?? current.active,
        updatedAt: now,
        updatedBy: actorId,
      });

      map!.set(input.classId, updated);
      return updated;
    },

    async generateSessions(
      academyId: string,
      classId: string,
      fromDate: string,
      toDate: string,
      timezone: string,
      actorId: string,
    ): Promise<readonly SessionRecord[]> {
      const map = classesMap.get(academyId);
      const cls = map?.get(classId);
      if (!cls) {
        throw new Error(`Class ${classId} does not exist`);
      }

      const drafts = generateSessionsFromClass(cls, fromDate, toDate, timezone);
      const now = new Date().toISOString();
      const created: SessionRecord[] = [];

      if (!sessionsMap.has(academyId)) {
        sessionsMap.set(academyId, new Map());
      }
      const aSessions = sessionsMap.get(academyId)!;

      for (const draft of drafts) {
        if (aSessions.has(draft.sessionId)) {
          created.push(aSessions.get(draft.sessionId)!);
        } else {
          const sessionRecord: SessionRecord = Object.freeze({
            ...draft,
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });
          aSessions.set(draft.sessionId, sessionRecord);
          created.push(sessionRecord);
        }
      }

      return created;
    },

    async listSessions(
      academyId: string,
      query: ListSessionsQuery,
    ): Promise<readonly SessionRecord[]> {
      const map = sessionsMap.get(academyId);
      if (!map) return [];

      return Array.from(map.values())
        .filter((session) => {
          if (session.startAt < query.from || session.startAt > query.to) {
            return false;
          }
          if (query.locationId && session.locationId !== query.locationId) {
            return false;
          }
          if (query.programId && session.programId !== query.programId) {
            return false;
          }
          return true;
        })
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
    },

    async getSession(academyId: string, sessionId: string): Promise<SessionRecord | null> {
      const map = sessionsMap.get(academyId);
      return map?.get(sessionId) ?? null;
    },

    async createSession(
      academyId: string,
      input: CreateSessionInput,
      actorId: string,
    ): Promise<SessionRecord> {
      const now = new Date().toISOString();
      const sessionId = `session-${sessionSeq++}`;
      const record: SessionRecord = Object.freeze({
        sessionId,
        academyId,
        classId: input.classId ?? null,
        programId: input.programId,
        locationId: input.locationId,
        instructorId: input.instructorId,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        capacity: input.capacity,
        minParticipants: input.minParticipants ?? 4,
        status: "scheduled",
        isSeminar: input.isSeminar ?? false,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      if (!sessionsMap.has(academyId)) {
        sessionsMap.set(academyId, new Map());
      }
      sessionsMap.get(academyId)!.set(sessionId, record);
      return record;
    },

    async cancelSession(
      academyId: string,
      sessionId: string,
      reason: string,
      actorId: string,
    ): Promise<SessionRecord> {
      const map = sessionsMap.get(academyId);
      const current = map?.get(sessionId);
      if (!current) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const now = new Date().toISOString();
      const cancelled: SessionRecord = Object.freeze({
        ...current,
        status: "cancelled",
        cancellationReason: reason,
        updatedAt: now,
        updatedBy: actorId,
      });

      map!.set(sessionId, cancelled);
      return cancelled;
    },

    async requestBooking(
      academyId: string,
      input: RequestBookingInput,
      actorId: string,
    ): Promise<BookingRecord> {
      const sMap = sessionsMap.get(academyId);
      const session = sMap?.get(input.sessionId);
      if (!session) {
        throw new Error(`Session ${input.sessionId} does not exist`);
      }
      if (session.status === "cancelled") {
        throw new Error(`Cannot book cancelled session ${input.sessionId}`);
      }

      if (!bookingsMap.has(academyId)) {
        bookingsMap.set(academyId, new Map());
      }
      const bMap = bookingsMap.get(academyId)!;
      const bookingId = buildBookingId(input.sessionId, input.studentId);

      const existing = bMap.get(bookingId);
      if (existing && existing.status === "confirmed") {
        return existing;
      }

      const confirmedCount = Array.from(bMap.values()).filter(
        (b) =>
          b.sessionId === input.sessionId && b.status === "confirmed" && b.bookingId !== bookingId,
      ).length;

      if (confirmedCount >= session.capacity) {
        throw new Error(`Session capacity reached (${session.capacity})`);
      }

      const now = new Date().toISOString();
      const record: BookingRecord = Object.freeze({
        bookingId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        membershipId: input.membershipId,
        status: "confirmed",
        requestedAt: now,
        cancelledAt: null,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: existing ? existing.createdAt : now,
        createdBy: existing ? existing.createdBy : actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      bMap.set(bookingId, record);
      return record;
    },

    async cancelBooking(
      academyId: string,
      input: CancelBookingInput,
      actorId: string,
      isStaffOverride = false,
    ): Promise<BookingRecord> {
      const bMap = bookingsMap.get(academyId);
      const bookingId = buildBookingId(input.sessionId, input.studentId);
      const existing = bMap?.get(bookingId);

      if (!existing) {
        throw new Error(`Booking ${bookingId} does not exist`);
      }

      if (!isStaffOverride) {
        const sMap = sessionsMap.get(academyId);
        const session = sMap?.get(input.sessionId);
        if (session && !isWithinBookingCutoff(session.startAt)) {
          throw new Error("Cannot cancel within 1 hour of session start without staff override");
        }
      }

      const now = new Date().toISOString();
      const updated: BookingRecord = Object.freeze({
        ...existing,
        status: "cancelled",
        cancelledAt: now,
        cancellationReason: input.reason,
        updatedAt: now,
        updatedBy: actorId,
      });

      bMap!.set(bookingId, updated);
      return updated;
    },

    async listSessionBookings(
      academyId: string,
      sessionId: string,
    ): Promise<readonly BookingRecord[]> {
      const bMap = bookingsMap.get(academyId);
      if (!bMap) return [];
      return Array.from(bMap.values())
        .filter((b) => b.sessionId === sessionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async listStudentBookings(
      academyId: string,
      studentId: string,
    ): Promise<readonly BookingRecord[]> {
      const bMap = bookingsMap.get(academyId);
      if (!bMap) return [];
      return Array.from(bMap.values())
        .filter((b) => b.studentId === studentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async evaluateSessionMinimum(
      academyId: string,
      sessionId: string,
    ): Promise<{ confirmedCount: number; minParticipants: number; quorumMet: boolean }> {
      const sMap = sessionsMap.get(academyId);
      const session = sMap?.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const minParticipants = session.minParticipants ?? 4;
      const bMap = bookingsMap.get(academyId);
      const confirmedCount = bMap
        ? Array.from(bMap.values()).filter(
            (b) => b.sessionId === sessionId && b.status === "confirmed",
          ).length
        : 0;

      return {
        confirmedCount,
        minParticipants,
        quorumMet: confirmedCount >= minParticipants,
      };
    },

    async recordCheckIn(
      academyId: string,
      input: CheckInInput,
      actorId: string,
      occurredAt?: string,
    ): Promise<AttendanceRecord> {
      const sMap = sessionsMap.get(academyId);
      const session = sMap?.get(input.sessionId);
      if (!session) {
        throw new Error(`Session ${input.sessionId} does not exist`);
      }
      if (session.status === "cancelled") {
        throw new Error(`Cannot check in to cancelled session ${input.sessionId}`);
      }

      if (!attendanceMap.has(academyId)) {
        attendanceMap.set(academyId, new Map());
      }
      const aMap = attendanceMap.get(academyId)!;
      const attendanceId = buildAttendanceId(input.sessionId, input.studentId);

      const existing = aMap.get(attendanceId);
      if (existing) {
        return existing;
      }

      const checkInTime = occurredAt ?? new Date().toISOString();
      const state = determinePunctuality(session.startAt, checkInTime);

      const record: AttendanceRecord = Object.freeze({
        attendanceId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        method: input.method,
        state,
        occurredAt: checkInTime,
        notes: input.notes ?? null,
        correctionOf: null,
        schemaVersion: "1",
        createdAt: checkInTime,
        createdBy: actorId,
        updatedAt: checkInTime,
        updatedBy: actorId,
      });

      aMap.set(attendanceId, record);
      return record;
    },

    async listSessionAttendance(
      academyId: string,
      sessionId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const aMap = attendanceMap.get(academyId);
      if (!aMap) return [];
      return Array.from(aMap.values())
        .filter((a) => a.sessionId === sessionId)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    },

    async listStudentAttendance(
      academyId: string,
      studentId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const aMap = attendanceMap.get(academyId);
      if (!aMap) return [];
      return Array.from(aMap.values())
        .filter((a) => a.studentId === studentId && a.correctionOf === null)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },

    async correctAttendance(
      academyId: string,
      input: CorrectAttendanceInput,
      actorId: string,
      occurredAt?: string,
    ): Promise<{ correction: AttendanceRecord; canonical: AttendanceRecord }> {
      if (!attendanceMap.has(academyId)) {
        attendanceMap.set(academyId, new Map());
      }
      const aMap = attendanceMap.get(academyId)!;
      const canonicalId = buildAttendanceId(input.sessionId, input.studentId);
      const existingCanonical = aMap.get(canonicalId);

      if (!existingCanonical) {
        throw new Error(`Canonical attendance record ${canonicalId} does not exist`);
      }

      const now = occurredAt ?? new Date().toISOString();
      const correctionId = buildCorrectionAttendanceId();

      const correction: AttendanceRecord = Object.freeze({
        attendanceId: correctionId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        method: existingCanonical.method,
        state: input.newState,
        occurredAt: now,
        notes: input.reason,
        correctionOf: canonicalId,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      const updatedCanonical: AttendanceRecord = Object.freeze({
        ...existingCanonical,
        state: input.newState,
        updatedAt: now,
        updatedBy: actorId,
      });

      aMap.set(correctionId, correction);
      aMap.set(canonicalId, updatedCanonical);

      return { correction, canonical: updatedCanonical };
    },

    async reconcileSessionNoShows(
      academyId: string,
      sessionId: string,
      actorId: string,
      occurredAt?: string,
    ): Promise<{ noShowsMarked: number; records: readonly AttendanceRecord[] }> {
      const sMap = sessionsMap.get(academyId);
      const session = sMap?.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const bMap = bookingsMap.get(academyId);
      const confirmedBookings = bMap
        ? Array.from(bMap.values()).filter(
            (b) => b.sessionId === sessionId && b.status === "confirmed",
          )
        : [];

      if (!attendanceMap.has(academyId)) {
        attendanceMap.set(academyId, new Map());
      }
      const aMap = attendanceMap.get(academyId)!;

      const now = occurredAt ?? new Date().toISOString();
      const records: AttendanceRecord[] = [];

      for (const booking of confirmedBookings) {
        const canonicalId = buildAttendanceId(sessionId, booking.studentId);
        if (!aMap.has(canonicalId)) {
          const noShowRecord: AttendanceRecord = Object.freeze({
            attendanceId: canonicalId,
            academyId,
            sessionId,
            studentId: booking.studentId,
            method: "manual",
            state: "no_show",
            occurredAt: now,
            notes: "Automated no-show reconciliation",
            correctionOf: null,
            schemaVersion: "1",
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });

          aMap.set(canonicalId, noShowRecord);
          records.push(noShowRecord);
        }
      }

      return { noShowsMarked: records.length, records };
    },

    async listAttendanceHistory(
      academyId: string,
      sessionId: string,
      studentId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const aMap = attendanceMap.get(academyId);
      if (!aMap) return [];
      const canonicalId = buildAttendanceId(sessionId, studentId);
      return Array.from(aMap.values())
        .filter((a) => a.attendanceId === canonicalId || a.correctionOf === canonicalId)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    },

    async recordCheckout(
      academyId: string,
      input: RecordCheckoutInput,
      actorId: string,
      occurredAt?: string,
    ): Promise<CheckoutRecord> {
      if (!checkoutsMap.has(academyId)) {
        checkoutsMap.set(academyId, new Map());
      }
      const cMap = checkoutsMap.get(academyId)!;
      const checkoutId = buildCheckoutId(input.sessionId, input.studentId);

      const existing = cMap.get(checkoutId);
      if (existing) {
        return existing;
      }

      // Verify attendance
      const aMap = attendanceMap.get(academyId);
      const attendanceId = buildAttendanceId(input.sessionId, input.studentId);
      const attendance = aMap?.get(attendanceId);

      if (!attendance || (attendance.state !== "attended" && attendance.state !== "late")) {
        throw new Error(
          `Student ${input.studentId} did not attend this session ${input.sessionId}${
            attendance ? ` (state: ${attendance.state})` : ""
          }`,
        );
      }

      const now = occurredAt ?? new Date().toISOString();
      const record: CheckoutRecord = Object.freeze({
        checkoutId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        method: input.method,
        authorizedAdultId: input.authorizedAdultId ?? null,
        authorizedAdultName: input.authorizedAdultName ?? null,
        notes: input.notes ?? null,
        checkedOutAt: now,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      cMap.set(checkoutId, record);
      return record;
    },

    async listSessionCheckouts(
      academyId: string,
      sessionId: string,
    ): Promise<readonly CheckoutRecord[]> {
      const cMap = checkoutsMap.get(academyId);
      if (!cMap) return [];
      return Array.from(cMap.values())
        .filter((c) => c.sessionId === sessionId)
        .sort((a, b) => a.checkedOutAt.localeCompare(b.checkedOutAt));
    },

    async getStudentCheckout(
      academyId: string,
      sessionId: string,
      studentId: string,
    ): Promise<CheckoutRecord | null> {
      const cMap = checkoutsMap.get(academyId);
      if (!cMap) return null;
      const checkoutId = buildCheckoutId(sessionId, studentId);
      return cMap.get(checkoutId) ?? null;
    },

    async getSessionOperationalView(
      academyId: string,
      sessionId: string,
    ): Promise<SessionOperationalView> {
      const sMap = sessionsMap.get(academyId);
      const session = sMap?.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found in academy ${academyId}`);
      }

      const bMap = bookingsMap.get(academyId);
      const bookings = bMap
        ? Array.from(bMap.values()).filter((b) => b.sessionId === sessionId)
        : [];

      const aMap = attendanceMap.get(academyId);
      const attendance = aMap
        ? Array.from(aMap.values()).filter((a) => a.sessionId === sessionId)
        : [];

      const cMap = checkoutsMap.get(academyId);
      const checkouts = cMap
        ? Array.from(cMap.values()).filter((c) => c.sessionId === sessionId)
        : [];

      return buildSessionOperationalView({
        session,
        bookings,
        attendance,
        checkouts,
      });
    },
  };
}
