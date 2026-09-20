import type { Metadata } from "next";
import { CourseCatalogue } from "./course-catalogue";
import "./courses.css";
export const metadata: Metadata = {title: "Courses and seminars | BPT Jersey", description: "Explore BPT Jersey courses and seminars. One payment, a set programme of weekly sessions.", alternates: {canonical: "/courses"}};
export default function CoursesPage() {return <main className="course-page"><nav className="course-topnav" aria-label="Course navigation"><a href="/">BPT Jersey</a><a href="/account/courses">My courses</a></nav><h1>Courses &amp; seminars</h1><p className="course-intro">Focused training with a clear start and finish. One payment covers your remaining sessions, with no regular membership required.</p><CourseCatalogue /></main>;}
