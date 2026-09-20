import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { courseRecordIdSchema, type CourseEnrolment } from "@bpt-jersey/domain/courses";
import { resolveCourseParticipantInTransaction } from "./course-participants.js";
import { courseCollection, assertCourseActorLive, assertCourseOffice, courseFailure, type CourseActor } from "./course-store.js";
/** Office-only, academy-scoped export. Storage keys and third-party identity are omitted. */
export async function exportCourseSubjectData(db: Firestore, actor: CourseActor, subjectUid: string, cursor?: string, studentId?: string) {
  assertCourseOffice(actor);
  courseRecordIdSchema.parse(subjectUid);
  if (studentId) {
    courseRecordIdSchema.parse(studentId);
    const match = cursor === undefined ? null : /^participant:([0-9a-f-]{36})$/iu.exec(cursor);
    if (cursor !== undefined && !match) courseFailure("invalid", "Refresh the participant export cursor.");
    return db.runTransaction(async tx => {
      await assertCourseActorLive(db, tx, actor);
      const participant = await resolveCourseParticipantInTransaction(db, tx, {uid: subjectUid, academyId: actor.academyId, role: "shopper"}, {kind: "student", studentId});
      let query = courseCollection(db, actor.academyId, "courseEnrolments").where("studentId", "==", participant.studentId).orderBy(FieldPath.documentId());
      if (match) query = query.startAfter(match[1]);
      const page = await tx.get(query.limit(31)); const docs = page.docs.slice(0, 30);
      return {
        items: docs.map(doc => {
          const enrolment = doc.data() as CourseEnrolment;
          if (enrolment.academyId !== actor.academyId || enrolment.studentId !== participant.studentId) courseFailure("forbidden", "The participant record needs office review.");
          return {collection: "courseEnrolments", recordId: doc.id, data: {fullName: participant.fullName, dateOfBirth: participant.dateOfBirth, courseId: enrolment.courseId, status: enrolment.status}};
        }),
        cursor: page.size > 30 ? `participant:${docs[29]!.id}` : null,
      };
    });
  }
  const sources = [
    {name:"courseCandidates", field:"applicantUid", fields:["kind","fullName","dateOfBirth","contactEmail","contactPhone","applicantName","trainingCenter","trainingTimePreferences"]},
    {name:"courseEnrolments", field:"applicantUid", fields:["courseId","status","priceMinor","currency","acceptedTerms","acceptedAt","reference","expiresAt","submittedAt","approvedAt","accessFrom","decisionReason","createdAt","receivedMinor","refundedMinor","pendingRefundMinor"]},
    {name:"courseProofs", field:"applicantUid", fields:["enrolmentId","mime","sizeBytes","state","createdAt","attachedAt"]},
    {name:"courseNotices", field:"recipientUid", fields:["courseId","enrolmentId","kind","title","message","createdAt","readAt"]},
  ];
  const separator=(cursor??"0:").indexOf(":"); const phase=Number((cursor??"0:").slice(0,separator)); const after=(cursor??"0:").slice(separator+1);
  const source=sources[phase]; if(!source||separator<0||!Number.isInteger(phase))courseFailure("invalid","Refresh the export cursor.");
  let query=courseCollection(db,actor.academyId,source.name).where(source.field,"==",subjectUid).orderBy(FieldPath.documentId());
  if(after)query=query.startAfter(after);
  const page=await query.limit(31).get();const docs=page.docs.slice(0,30);
  return {items:docs.map(doc=>{const raw=doc.data();const data:Record<string,unknown>={};for(const field of source.fields){if(source.name==="courseCandidates"&&raw.kind==="minor"&&["fullName","dateOfBirth"].includes(field))continue;if(raw[field]!==undefined)data[field]=raw[field];}return {collection:source.name,recordId:doc.id,data};}),cursor:page.size>30?`${phase}:${docs[29]!.id}`:phase<sources.length-1?`${phase+1}:`:null};
}
