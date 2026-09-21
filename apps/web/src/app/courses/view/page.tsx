import type { Metadata } from "next";

import { CourseDetail } from "./course-detail";
import "../courses.css";

export const metadata: Metadata = {
  title: "Course details | BPT Jersey",
};

export default function CourseViewPage() {
  return (
    <main className="course-page">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <nav className="course-topnav" aria-label="Course navigation">
        <a className="course-wordmark" href="/">
          BPT Jersey
        </a>
        <div className="course-topnav-links">
          <a href="/courses">All courses</a>
          <a href="/account/courses">My courses</a>
        </div>
      </nav>
      <div id="main-content">
        <CourseDetail />
      </div>
    </main>
  );
}
