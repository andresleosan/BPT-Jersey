import type { Metadata } from "next";

import { CourseCatalogue } from "./course-catalogue";
import "./courses.css";

export const metadata: Metadata = {
  title: "Courses and seminars | BPT Jersey",
  description:
    "Explore focused BPT Jersey courses and seminars with set dates, clear coaching and one programme fee.",
  alternates: { canonical: "/courses" },
};

export default function CoursesPage() {
  return (
    <main className="course-page">
      <nav className="course-topnav" aria-label="Course navigation">
        <a className="course-wordmark" href="/">
          BPT Jersey
        </a>
        <a href="/account/courses">My courses</a>
      </nav>

      <header className="course-page-hero">
        <p className="course-eyebrow">Focused training at BPT Jersey</p>
        <h1>Courses &amp; seminars</h1>
        <p className="course-intro">
          Train one subject across a clear set of dates. A regular membership is not required.
        </p>
      </header>

      <CourseCatalogue />
    </main>
  );
}
