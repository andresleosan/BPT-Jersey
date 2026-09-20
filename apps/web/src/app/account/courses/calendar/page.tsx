"use client";
import { useMemo } from "react";
import { CourseSessionGate, type CourseSession } from "../../../../lib/courses/course-session";
import { createFirebaseCalendarRepository } from "../../../../lib/calendar/firebase-calendar-repository";
import type { CalendarMember } from "../../../../lib/calendar";
import { signOutFromAuth } from "../../../../lib/auth-client";
import { MemberCalendar } from "../../calendar/member-calendar";
import "../../account.css";
import "../../../courses/courses.css";
function CourseCalendar({session}:{session:CourseSession}) {const role=session.role as CalendarMember["role"];const repository=useMemo(()=>createFirebaseCalendarRepository({role,displayName:"My training",scope:"courses"}),[role,session.uid]);return <MemberCalendar repository={repository} session={{role,displayName:"My training"}} onSignOut={()=>void signOutFromAuth()}/>;}
export default function CourseCalendarPage(){return <CourseSessionGate>{session=><CourseCalendar session={session}/>}</CourseSessionGate>;}
