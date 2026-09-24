import { groupKey } from "./group-keys.js";
import { type Firestore, type Transaction, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { buildBookingIdCandidates, type SessionRecord } from "@bpt-jersey/domain/schedule";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import type { GroupSessionView, GroupSite, MemberGroup, MemberGroupView, SaveMemberGroup } from "@bpt-jersey/domain/schedule/groups";
import { isGuardianOnly } from "@bpt-jersey/domain/members/overview";
import { trialAccessSchema, trialStatusAt } from "@bpt-jersey/domain/memberships/trial-access";
import {
  BookingTransactionError, confirmBookingInTransaction, cancelBookingInTransaction,
  type BookingFirestore, type BookingTransaction,
} from "./booking-transaction-service.js";

const root = (academy: string) => `academies/${academy}`;
type Actor = { userId: string; role: "owner" | "administrator" | "system"; ip?: string | null };
type Assignment = { groupId: string; sessionId: string; seriesId: string | null; fromIndex: number; startAt: string; active: boolean; authorisedBy: string; authorisedRole: "owner" | "administrator"; authorisedAt: string; authorisationRef: string };
const systemActor: Actor = { userId: "group-registration", role: "system" };
/** Same mapping as the booking transaction: a class is at Town or, otherwise, West. */
const siteOf = (session: SessionRecord): GroupSite => (session.locationId === "town" ? "Town" : "West");
const offeredFor = (group: MemberGroup, session: SessionRecord) => !group.site || group.site === siteOf(session);
const time = () => new Date().toISOString();
const covers = (assignment: Assignment, session: SessionRecord) => assignment.active && Boolean(assignment.authorisedBy) && ["owner", "administrator"].includes(assignment.authorisedRole) &&
  (assignment.seriesId ? assignment.seriesId === session.weeklySeriesId && (session.weeklyIndex ?? 0) >= assignment.fromIndex : assignment.sessionId === session.sessionId);
function activeMemberships(documents: QueryDocumentSnapshot[], academy: string, studentId: string, at: string) {
  const now = Date.now();
  return documents.flatMap((doc) => {
    const parsed = parseMembershipRecord(doc.data());
    if (!parsed.ok) return [];
    const m = parsed.value;
    return m.academyId === academy && m.membershipId === doc.id && m.studentId === studentId && m.status === "active" &&
      Date.parse(m.startsAt) <= now && Date.parse(m.startsAt) <= Date.parse(at) &&
      (m.endsAt === null || (Date.parse(m.endsAt) > now && Date.parse(m.endsAt) > Date.parse(at))) ? [m] : [];
  }).sort((a, b) => a.membershipId.localeCompare(b.membershipId));
}
function reasonOf(error: BookingTransactionError): string {
  if (error.code === "financial") return "Missing Payment";
  if (error.code === "capacity") return "Class is full";
  if (error.code === "weekly-limit") return "Weekly allowance reached";
  if (error.code === "capacity-not-set") return "Class capacity has not been set";
  if (error.code === "ineligible") return error.message;
  return "Booking could not be completed. Ask the office to review this member.";
}

export function createGroupService(db: Firestore, academy: string) {
  const collection = (name: string) => db.collection(`${root(academy)}/${name}`);
  const assignmentRef = (groupId: string, session: SessionRecord) => collection("groupAssignments").doc(groupKey(groupId, session.weeklySeriesId ?? session.sessionId));
  const receiptRef = (groupId: string, sessionId: string, studentId: string) => collection("groupRegistrationResults").doc(groupKey(groupId, sessionId, studentId));
  async function sessionById(sessionId: string) {
    const data = (await collection("sessions").doc(sessionId).get()).data();
    if (!data || data.academyId !== academy || data.sessionId !== sessionId) throw new HttpsError("not-found", "Class not found.");
    return data as SessionRecord;
  }
  async function assignmentsFor(session: SessionRecord) {
    const rows = await collection("groupAssignments").where(session.weeklySeriesId ? "seriesId" : "sessionId", "==", session.weeklySeriesId ?? session.sessionId).get();
    return rows.docs.filter((doc) => covers(doc.data() as Assignment, session));
  }
  async function membersOf(group: MemberGroup, at: string) {
    return Promise.all(group.studentIds.map(async (studentId) => {
      const [student, memberships] = await Promise.all([
        collection("students").doc(studentId).get(), collection("memberships").where("studentId", "==", studentId).get(),
      ]);
      const data = student.data();
      if (!data || data.academyId !== academy) return null;
      return { studentId, fullName: String(data.fullName ?? "Member"), missingPayment: activeMemberships(memberships.docs, academy, studentId, at).length === 0 };
    })).then((rows) => rows.filter((row): row is NonNullable<typeof row> => row !== null));
  }
  const isActive = (data: FirebaseFirestore.DocumentData | undefined) => data?.active !== false && data?.status === "active";
  async function coveredAt(studentId: string, at: string) {
    const [memberships, trial] = await Promise.all([
      collection("memberships").where("studentId", "==", studentId).get(), collection("trialAccess").doc(studentId).get(),
    ]);
    const parsedTrial = trialAccessSchema.safeParse(trial.data());
    return {
      hasOwnCoveringPlan: activeMemberships(memberships.docs, academy, studentId, at).length > 0,
      hasActiveTrial: parsedTrial.success && parsedTrial.data.academyId === academy && trialStatusAt(parsedTrial.data, at) === "active",
    };
  }
  /** A guardian is the primary contact of a family where another member trains, with no plan or trial of their own. */
  async function assertAddable(studentId: string, data: FirebaseFirestore.DocumentData | undefined, at: string) {
    if (!isActive(data)) throw new HttpsError("failed-precondition", `Only active members can be added: ${String(data?.fullName ?? "Member")}`);
    const userId = data?.userId;
    if (typeof userId !== "string") return;
    const families = await collection("families").where("primaryContactUserId", "==", userId).get();
    let guardsActiveStudent = false;
    for (const family of families.docs) {
      const relatives = await collection("students").where("familyId", "==", family.id).get();
      for (const relative of relatives.docs) {
        if (relative.id === studentId || relative.get("academyId") !== academy || !isActive(relative.data())) continue;
        const cover = await coveredAt(relative.id, at);
        if (cover.hasOwnCoveringPlan || cover.hasActiveTrial) { guardsActiveStudent = true; break; }
      }
      if (guardsActiveStudent) break;
    }
    if (!guardsActiveStudent) return;
    if (isGuardianOnly({ ...(await coveredAt(studentId, at)), guardsActiveStudent }))
      throw new HttpsError("failed-precondition", `Guardians can't be added to a group: ${String(data?.fullName ?? "Member")}`);
  }
  async function save(input: SaveMemberGroup, actor: Actor) {
    const ref = collection("memberGroups").doc(input.groupId);
    // Only newly added members are checked, so a rename or site pick on an older group still saves.
    // Existing members are not re-validated here: syncMember re-checks active status and payment at booking time.
    // The revision check in the transaction below refuses the save if the group changed since this read.
    const existingIds = new Set<string>((await ref.get()).data()?.studentIds ?? []);
    const added = input.studentIds.filter((id) => !existingIds.has(id));
    const at = time();
    const addedDocs = added.length ? await db.getAll(...added.map((id) => collection("students").doc(id))) : [];
    await Promise.all(addedDocs.filter((doc) => doc.exists && doc.data()?.academyId === academy).map((doc) => assertAddable(doc.id, doc.data(), at)));
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if ((existing.data()?.revision ?? 0) !== input.revision || (existing.exists && existing.data()?.active !== true))
        throw new HttpsError("aborted", "This group changed. Reload it before saving.");
      const students = input.studentIds.length ? await tx.getAll(...input.studentIds.map((id) => collection("students").doc(id))) : [];
      if (students.some((doc) => !doc.exists || doc.data()?.academyId !== academy)) throw new HttpsError("failed-precondition", "Choose existing members only. Reload the member list.");
      const record = { ...input, academyId: academy, active: true, revision: input.revision + 1, updatedAt: time(), updatedBy: actor.userId };
      tx.set(ref, record);
      tx.create(collection("groupActivity").doc(), { academyId: academy, groupId: input.groupId, action: existing.exists ? "updated" : "created", actorId: actor.userId, at: record.updatedAt, before: existing.data() ?? null, after: record });
    });
  }
  async function remove(groupId: string, revision: number, actor: Actor) {
    await db.runTransaction(async (tx) => {
      const ref = collection("memberGroups").doc(groupId);
      const current = await tx.get(ref);
      const assignments = await tx.get(collection("groupAssignments").where("groupId", "==", groupId));
      if (current.data()?.revision !== revision) throw new HttpsError("aborted", "This group changed. Reload it before deleting.");
      tx.update(ref, { active: false, revision: revision + 1, updatedAt: time(), updatedBy: actor.userId });
      for (const assignment of assignments.docs) tx.update(assignment.ref, { active: false, updatedAt: time(), updatedBy: actor.userId });
      tx.create(collection("groupActivity").doc(), { academyId: academy, groupId, action: "deleted", actorId: actor.userId, at: time() });
    });
  }
  async function list(): Promise<MemberGroupView[]> {
    const groups = await collection("memberGroups").where("active", "==", true).get();
    return Promise.all(groups.docs.map(async (doc) => {
      const group = doc.data() as MemberGroup;
      return { groupId: doc.id, name: group.name, ...(group.site ? { site: group.site } : {}), studentIds: group.studentIds, revision: group.revision, active: group.active, updatedAt: group.updatedAt, members: await membersOf(group, time()) };
    })).then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name)));
  }
  async function syncMember(groupId: string, session: SessionRecord, studentId: string, actor: Actor) {
    const receipt = receiptRef(groupId, session.sessionId, studentId);
    const originRef = collection("groupBookingOrigins").doc(groupKey(session.sessionId, studentId));
    const exclusionRef = collection("groupSessionExclusions").doc(groupKey(session.sessionId, studentId));
    try {
      await db.runTransaction(async (tx) => {
        // Group edits, directory deletion, exclusions and subscription changes all invalidate this transaction.
        const [group, assignment, student, memberships, exclusion, origin, sessionDoc, previousReceipt, ...bookings] = await Promise.all([
          tx.get(collection("memberGroups").doc(groupId)), tx.get(assignmentRef(groupId, session)),
          tx.get(collection("students").doc(studentId)), tx.get(collection("memberships").where("studentId", "==", studentId)),
          tx.get(exclusionRef), tx.get(originRef), tx.get(collection("sessions").doc(session.sessionId)), tx.get(receipt),
          ...buildBookingIdCandidates(session.sessionId, studentId).map((id) => tx.get(collection("bookings").doc(id))),
        ]);
        const liveSession = sessionDoc.data() as SessionRecord | undefined;
        if (!liveSession || liveSession.academyId !== academy || liveSession.status !== "scheduled" || Date.parse(liveSession.startAt) <= Date.now()) return;
        if (!group.data()?.active || !group.data()?.studentIds.includes(studentId) || !assignment.exists || !covers(assignment.data() as Assignment, liveSession)) return;
        const base = { academyId: academy, groupId, sessionId: session.sessionId, studentId, authorisationRef: assignment.get("authorisationRef"), updatedAt: time() };
        const saveResult = (state: string, reason: string, bookingId?: string) => {
          const previous = previousReceipt.data();
          if (previous?.state === state && previous?.reason === reason && previous?.bookingId === bookingId) return;
          tx.set(receipt, { ...base, state, reason, ...(bookingId ? { bookingId } : {}) });
        };
        if (exclusion.exists) { saveResult("excluded", "Removed from this class"); return; }
        const active = activeMemberships(memberships.docs, academy, studentId, liveSession.startAt);
        const existing = bookings.find((booking) => booking.data()?.status === "confirmed");
        const available = student.exists && student.data()?.academyId === academy && student.data()?.active !== false && student.data()?.status === "active";
        if (!available || !active.length) {
          if (existing && origin.data()?.owned === true && origin.data()?.bookingId === existing.id) {
            await cancelBookingInTransaction({ firestore: db as unknown as BookingFirestore, transaction: tx as unknown as BookingTransaction,
              academyId: academy, request: { sessionId: session.sessionId, studentId, reason: available ? "Group member has no active subscription" : "Group member is no longer active" },
              actorId: actor.userId, actorRole: actor.role, actorIp: actor.ip ?? null, now: time(), isStaffOverride: true, suppressGroupRebooking: false });
          }
          saveResult("blocked", available ? "Missing Payment" : "Member is no longer active");
          return;
        }
        if (existing) {
          saveResult("registered", "Registered", existing.id);
          return;
        }
        const booking = await confirmBookingInTransaction({ firestore: db as unknown as BookingFirestore, transaction: tx as unknown as BookingTransaction,
          academyId: academy, request: { kind: "membership", sessionId: session.sessionId, studentId, membershipId: active[0]!.membershipId },
          actorId: actor.userId, actorRole: actor.role, actorIp: actor.ip ?? null, now: time(), groupRegistration: true, groupOverride: true });
        tx.set(originRef, { academyId: academy, sessionId: session.sessionId, studentId, bookingId: booking.bookingId, owned: true });
        saveResult("registered", "Registered", booking.bookingId);
      });
    } catch (error) {
      if (!(error instanceof BookingTransactionError)) throw error;
      await receipt.set({ academyId: academy, groupId, sessionId: session.sessionId, studentId, state: "blocked", reason: reasonOf(error), updatedAt: time() });
    }
  }
  async function syncSession(sessionId: string, actor: Actor = systemActor) {
    const session = await sessionById(sessionId);
    if (session.status !== "scheduled" || Date.parse(session.startAt) <= Date.now() || "courseId" in session) return;
    for (const assignment of await assignmentsFor(session)) {
      const group = (await collection("memberGroups").doc(assignment.get("groupId")).get()).data() as MemberGroup | undefined;
      if (!group?.active) continue;
      // Sequential processing respects the class capacity and gives stable partial-success results.
      for (const studentId of group.studentIds) await syncMember(group.groupId, session, studentId, actor);
    }
  }
  async function enrol(groupId: string, sessionId: string, actor: Actor) {
    if (actor.role === "system") throw new HttpsError("permission-denied", "A group requires explicit office registration.");
    const session = await sessionById(sessionId);
    if (session.status !== "scheduled" || Date.parse(session.startAt) <= Date.now() || "courseId" in session) throw new HttpsError("failed-precondition", "Choose an upcoming regular class.");
    await db.runTransaction(async (tx) => {
      const ref = assignmentRef(groupId, session);
      const [group, current] = await Promise.all([tx.get(collection("memberGroups").doc(groupId)), tx.get(ref)]);
      if (!group.data()?.active) throw new HttpsError("not-found", "Group not found.");
      if (!offeredFor(group.data() as MemberGroup, session)) throw new HttpsError("failed-precondition", "Choose a group from this class's site.");
      const previous = current.data() as Assignment | undefined;
      const fromIndex = Math.min(previous?.fromIndex ?? Infinity, session.weeklyIndex ?? 0);
      const authority = collection("groupActivity").doc();
      const authorisedAt = time();
      tx.set(ref, { academyId: academy, groupId, sessionId, seriesId: session.weeklySeriesId ?? null, fromIndex, startAt: previous && previous.startAt < session.startAt ? previous.startAt : session.startAt, active: true, authorisedBy: actor.userId, authorisedRole: actor.role, authorisedAt, authorisationRef: authority.path, updatedAt: authorisedAt, updatedBy: actor.userId });
      tx.create(authority, { academyId: academy, groupId, sessionId, action: "registered", actorId: actor.userId, actorRole: actor.role, at: authorisedAt, scope: session.weeklySeriesId ? "this-and-following-weeks" : "this-session" });
    });
    await syncSession(sessionId, actor);
  }
  async function sessionGroups(sessionId: string, includeAvailable: boolean): Promise<GroupSessionView[]> {
    const session = await sessionById(sessionId);
    const [assignments, receipts, exclusions, bookings] = await Promise.all([
      assignmentsFor(session), collection("groupRegistrationResults").where("sessionId", "==", sessionId).get(),
      collection("groupSessionExclusions").where("sessionId", "==", sessionId).get(), collection("bookings").where("sessionId", "==", sessionId).get(),
    ]);
    const assignedIds = new Set(assignments.map((doc) => String(doc.get("groupId"))));
    const groupIds = new Set(assignedIds);
    for (const receipt of receipts.docs) groupIds.add(String(receipt.get("groupId")));
    // Groups already registered stay visible whatever their site; new ones are offered per site.
    const available = includeAvailable
      ? (await collection("memberGroups").where("active", "==", true).get()).docs.filter((doc) => groupIds.has(doc.id) || offeredFor(doc.data() as MemberGroup, session))
      : [];
    const missingIds = [...groupIds].filter((id) => !available.some((doc) => doc.id === id));
    const groups = [...available, ...(missingIds.length ? await db.getAll(...missingIds.map((id) => collection("memberGroups").doc(id))) : [])];
    return Promise.all(groups.filter((doc) => doc.exists).map(async (doc) => {
      const group = doc.data() as MemberGroup;
      const studentIds = [...new Set([...group.studentIds, ...receipts.docs.filter((row) => row.get("groupId") === doc.id).map((row) => String(row.get("studentId")))])];
      const members = await membersOf({ ...group, studentIds }, session.startAt);
      return { groupId: doc.id, name: group.name, ...(group.site ? { site: group.site } : {}), active: group.active, assigned: assignedIds.has(doc.id) || receipts.docs.some((row) => row.get("groupId") === doc.id), recurring: Boolean(session.weeklySeriesId), members: members.map((member) => {
        const result = receipts.docs.find((row) => row.get("groupId") === doc.id && row.get("studentId") === member.studentId);
        const excluded = exclusions.docs.some((row) => row.get("studentId") === member.studentId);
        const registered = bookings.docs.some((row) => row.get("studentId") === member.studentId && row.get("status") === "confirmed");
        const state = registered ? "registered" : excluded ? "excluded" : member.missingPayment || result?.get("state") === "blocked" ? "blocked" : "pending";
        return { ...member, state, reason: registered ? "Registered" : excluded ? "Removed from this class" : member.missingPayment ? "Missing Payment" : result?.get("reason") ?? "Not registered yet" };
      }) } as GroupSessionView;
    })).then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name)));
  }
  async function exclude(groupId: string, sessionId: string, studentId: string, actor: Actor) {
    const session = await sessionById(sessionId);
    await db.runTransaction(async (tx) => {
      const [group, assignment, ...bookings] = await Promise.all([
        tx.get(collection("memberGroups").doc(groupId)), tx.get(assignmentRef(groupId, session)),
        ...buildBookingIdCandidates(sessionId, studentId).map((id) => tx.get(collection("bookings").doc(id))),
      ]);
      const receipt = await tx.get(receiptRef(groupId, sessionId, studentId));
      if (!receipt.exists && (!group.data()?.studentIds.includes(studentId) || !assignment.exists || !covers(assignment.data() as Assignment, session)))
        throw new HttpsError("failed-precondition", "This member is not registered through this group.");
      if (bookings.some((booking) => booking.data()?.status === "confirmed")) {
        await cancelBookingInTransaction({ firestore: db as unknown as BookingFirestore, transaction: tx as unknown as BookingTransaction,
          academyId: academy, request: { sessionId, studentId, reason: "Removed from this class by the office" }, actorId: actor.userId,
          actorRole: actor.role, actorIp: actor.ip ?? null, now: time(), isStaffOverride: true });
      }
      tx.set(collection("groupSessionExclusions").doc(groupKey(sessionId, studentId)), { academyId: academy, sessionId, studentId, createdAt: time(), createdBy: actor.userId });
      tx.set(receiptRef(groupId, sessionId, studentId), { academyId: academy, groupId, sessionId, studentId, state: "excluded", reason: "Removed from this class", updatedAt: time() });
    });
  }
  async function syncUpcoming(groupId?: string) {
    const assignments = await (groupId ? collection("groupAssignments").where("groupId", "==", groupId) : collection("groupAssignments").where("active", "==", true)).get();
    const sessions = new Set<string>();
    for (const doc of assignments.docs) {
      const assignment = doc.data() as Assignment;
      if (!assignment.active) continue;
      const rows = assignment.seriesId ? (await collection("sessions").where("weeklySeriesId", "==", assignment.seriesId).get()).docs : [await collection("sessions").doc(assignment.sessionId).get()];
      for (const row of rows) {
        if (!row.exists) continue;
        const session = row.data() as SessionRecord;
        if (covers(assignment, session) && Date.parse(session.startAt) > Date.now()) sessions.add(session.sessionId);
      }
    }
    // Chronological order makes weekly allowance allocation predictable.
    const rows = sessions.size ? await db.getAll(...[...sessions].map((id) => collection("sessions").doc(id))) : [];
    rows.sort((a, b) => String(a.get("startAt")).localeCompare(String(b.get("startAt"))));
    for (const row of rows) await syncSession(row.id);
  }
  return { save, remove, list, enrol, exclude, sessionGroups, syncSession, syncUpcoming };
}

/** Called inside directory deletion, so deleting a member and removing group membership are atomic. */
export async function removeMemberFromGroups(db: Firestore, tx: Transaction, academy: string, studentId: string) {
  const groups = await tx.get(db.collection(`${root(academy)}/memberGroups`).where("studentIds", "array-contains", studentId));
  for (const doc of groups.docs) tx.update(doc.ref, { studentIds: (doc.get("studentIds") as string[]).filter((id) => id !== studentId), revision: Number(doc.get("revision")) + 1, updatedAt: time() });
}
