import { FieldPath, type Firestore } from "firebase-admin/firestore";
import type { Course, CourseEnrolment } from "@bpt-jersey/domain/courses";
import { canAccessCourseSession, courseRecordIdSchema } from "@bpt-jersey/domain/courses";
import { buildBookingIdCandidates, type SessionRecord, type SessionOperationalStatus } from "@bpt-jersey/domain/schedule";
import type { PreClassAttendee, PreClassView } from "@bpt-jersey/domain/schedule/pre-class";
import { courseCollection, courseData, courseFailure, type CourseActor } from "./course-store.js";
export async function requireCourseRosterAccess(db: Firestore, actor: CourseActor, sessionId: string): Promise<SessionRecord> {
  const session=courseData<SessionRecord>(await courseCollection(db,actor.academyId,"sessions").doc(courseRecordIdSchema.parse(sessionId)).get());
  if(!session.courseId)return session;
  const course=courseData<Course>(await courseCollection(db,actor.academyId,"courses").doc(session.courseId).get());
  if(course.status==="draft"||session.coursePublicationRevision!==course.publicationRevision)courseFailure("forbidden","This session is not published.");
  if(["owner","administrator"].includes(actor.role))return session;
  if(["coach","headCoach"].includes(actor.role)&&course.instructor.kind==="staff"){
    const staff=(await courseCollection(db,actor.academyId,"staff").doc(course.instructor.staffId).get()).data();
    if(staff?.userId===actor.uid&&staff.active===true&&staff.status==="active")return session;
  }
  courseFailure("forbidden","This course is assigned to a different coach.");
}
export async function getCourseRoster(db: Firestore, actor: CourseActor, sessionId: string, cursor?: string): Promise<PreClassView & {cursor:string|null}> {
  const session=await requireCourseRosterAccess(db,actor,sessionId);
  if(!session.courseId)courseFailure("invalid","Choose a course session.");
  let query=courseCollection(db,actor.academyId,"courseEnrolments").where("courseId","==",session.courseId).where("status","in",["approved","withdrawal_requested"]).orderBy(FieldPath.documentId());
  if(cursor)query=query.startAfter(cursor);
  const page=await query.limit(31).get();const docs=page.docs.slice(0,30);const attendees:PreClassAttendee[]=[];
  for(const doc of docs){const enrolment=doc.data() as CourseEnrolment;if(!enrolment.studentId||!canAccessCourseSession(enrolment,session))continue;
    const [student,bookings,attendance]=await Promise.all([courseCollection(db,actor.academyId,"students").doc(enrolment.studentId).get(),db.getAll(...buildBookingIdCandidates(sessionId,enrolment.studentId).map(id=>courseCollection(db,actor.academyId,"bookings").doc(id))),courseCollection(db,actor.academyId,"attendance").where("sessionId","==",sessionId).where("studentId","==",enrolment.studentId).limit(2).get()]);
    const data=student.data();if(!data||data.active!==true||data.status!=="active")continue;
    const record=attendance.docs.find(d=>!d.data().correctionOf)?.data();
    const booking=bookings.find(d=>d.exists)?.data();
    const status:SessionOperationalStatus=record?.state==="attended"?"attended":record?.state==="late"?"late":record?.state==="no_show"?"no_show":booking?.absent?"absent":"booked_not_arrived";
    attendees.push({studentId:enrolment.studentId,displayName:String(data.fullName??data.displayName??"Participant"),source:"booked",status,attendedCount:0,comparableSessionCount:0,lastAttendedAt:null});
  }
  return {session,attendees,evidence:{open:session.status!=="cancelled"&&session.endAt>new Date().toISOString(),windowDays:0,minAttendances:0,comparableSessionCount:0,bookedCount:attendees.length,suggestedCount:0},refreshedAt:new Date().toISOString(),cursor:page.size>30?docs[29]!.id:null};
}
