import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { courseCollection, assertCourseOffice, courseFailure, type CourseActor } from "./course-store.js";
/** Office-only, academy-scoped export. Storage keys and third-party identity are omitted. */
export async function exportCourseSubjectData(db: Firestore, actor: CourseActor, subjectUid: string, cursor?: string) {
  assertCourseOffice(actor);
  const sources = [
    {name:"courseCandidates", field:"applicantUid", fields:["kind","fullName","dateOfBirth","contactEmail","contactPhone","applicantName","trainingCenter","trainingTimePreferences"]},
    {name:"courseEnrolments", field:"applicantUid", fields:["courseId","status","priceMinor","currency","acceptedTerms","acceptedAt","reference","expiresAt","submittedAt","approvedAt","accessFrom","decisionReason","createdAt","receivedMinor","refundedMinor","pendingRefundMinor"]},
    {name:"courseProofs", field:"applicantUid", fields:["enrolmentId","mime","sizeBytes","state","createdAt","attachedAt"]},
    {name:"courseNotices", field:"recipientUid", fields:["courseId","enrolmentId","kind","title","message","createdAt","readAt"]},
  ];
  const separator=(cursor??"0:").indexOf(":"); const phase=Number((cursor??"0:").slice(0,separator)); const after=(cursor??"0:").slice(separator+1);
  const source=sources[phase]; if(!source||separator<0)courseFailure("invalid","Refresh the export cursor.");
  let query=courseCollection(db,actor.academyId,source.name).where(source.field,"==",subjectUid).orderBy(FieldPath.documentId());
  if(after)query=query.startAfter(after);
  const page=await query.limit(31).get();const docs=page.docs.slice(0,30);
  return {items:docs.map(doc=>{const raw=doc.data();const data:Record<string,unknown>={};for(const field of source.fields){if(source.name==="courseCandidates"&&raw.kind==="minor"&&["fullName","dateOfBirth"].includes(field))continue;if(raw[field]!==undefined)data[field]=raw[field];}return {collection:source.name,recordId:doc.id,data};}),cursor:page.size>30?`${phase}:${docs[29]!.id}`:phase<sources.length-1?`${phase+1}:`:null};
}
