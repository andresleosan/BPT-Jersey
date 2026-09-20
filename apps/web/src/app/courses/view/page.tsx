import type { Metadata } from "next";
import { CourseDetail } from "./course-detail";
import "../courses.css";
export const metadata: Metadata = {title: "Course details | BPT Jersey"};
export default function CourseViewPage() {return <main className="course-page"><nav className="course-topnav" aria-label="Course navigation"><a href="/courses">← All courses</a><a href="/account/courses">My courses</a></nav><CourseDetail /></main>;}
