import type { Metadata } from "next";

import { academyContent } from "../content/academy";
import Image from "next/image";

import { CourseCatalogue } from "./courses/course-catalogue";
import { CoursePromotionBar } from "./courses/course-promotion-bar";

import { PlanPriceList } from "./plan-price-list";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/** "2026-08-07" -> "7 August 2026", read as a calendar date so no time zone can shift it. */
function checkedOn(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="BPT Jersey home">
          <Image
            alt="BPT Jersey logo"
            className="site-logo"
            height={96}
            src="/bpt-jersey-logo.png"
            width={144}
          />
          <span>BPT</span>
          <span>Jersey</span>
        </a>

        <nav className="primary-nav" aria-label="Primary navigation">
          <a href="#top">Home</a>
          <a href="#classes">Classes</a>
          <a href="#programmes">Programmes</a>
          <a href="/courses">Courses</a>
          <a href="#shop">Shop</a>
          <a href="#locations">Locations</a>
          <a href="#contact">Contact</a>
          <a className="nav-cta" href="/login">
            Sign in
          </a>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Brazilian Power Team · Jersey</p>
            <h1 aria-label={academyContent.identity.title} id="hero-title">
              {academyContent.identity.titleLines.map((line) => (
                <span aria-hidden="true" className="hero-title-line" key={line}>
                  {line}
                </span>
              ))}
            </h1>
            <p className="hero-intro">{academyContent.identity.intro}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#classes">
                View classes
              </a>
              <a className="button button-secondary" href="/enrol">
                Book a free class
              </a>
            </div>
          </div>

          <aside className="hero-location" id="locations" aria-labelledby="locations-title">
            <h2 id="locations-title">Train in Jersey</h2>
            <ul className="location-list">
              {academyContent.locations.map((location) => (
                <li key={location.key}>
                  <address>
                    <strong>{location.name}</strong>
                    <span>{location.address}</span>
                    <span>
                      {location.locality}, {location.postcode}
                    </span>
                  </address>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <CoursePromotionBar />
        <div className="course-page course-landing" id="courses">
          <CourseCatalogue />
        </div>

        <section className="classes-section" id="classes" aria-labelledby="classes-title">
          <div className="section-heading">
            <h2 id="classes-title">Classes in Jersey</h2>
            <p>{academyContent.notes.booking}</p>
          </div>

          <div className="schedule-table-wrap schedule-board">
            <table className="schedule-table">
              <caption>Weekly timetable</caption>
              <thead>
                <tr>
                  <th scope="col">Location</th>
                  <th scope="col">Days</th>
                  <th scope="col">Time</th>
                  <th scope="col">Discipline</th>
                  <th scope="col">Level</th>
                </tr>
              </thead>
              <tbody>
                {academyContent.schedule.map((entry) => (
                  <tr
                    className="schedule-row"
                    key={`${entry.location}-${entry.days}-${entry.time}-${entry.discipline}`}
                  >
                    <td className="schedule-location">{entry.location}</td>
                    <td className="schedule-day">{entry.days}</td>
                    <td className="schedule-time">
                      <time>{entry.time}</time>
                    </td>
                    <td className="schedule-discipline">{entry.discipline}</td>
                    <td className="schedule-level">{entry.level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="instructors-block">
            <div className="section-heading">
              <h3>The coaching team</h3>
            </div>
            <ul className="instructor-list">
              {academyContent.instructors.map((instructor) => (
                <li className="instructor-card" key={instructor.name}>
                  <strong>{instructor.name}</strong>
                  <span>{instructor.credential}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="programs-section" id="programmes" aria-labelledby="programs-title">
          <div className="section-heading">
            <h2 id="programs-title">Who the classes are for</h2>
          </div>
          <ul className="program-list">
            {academyContent.programs.map((program) => (
              <li className="program-card" key={program.label}>
                <h3>{program.title}</h3>
                <p>{program.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="fees-section" id="fees" aria-labelledby="fees-title">
          <div className="section-heading">
            <h2 id="fees-title">Memberships and prices</h2>
          </div>
          <PlanPriceList />
        </section>

        <section className="merch-section" id="shop" aria-labelledby="shop-title">
          <div className="section-heading">
            <h2 id="shop-title">Club shop</h2>
            <p>{academyContent.notes.merchandise}</p>
          </div>
          <ul className="merch-grid" aria-label="Merchandise categories">
            {academyContent.merchandise.map((category) => (
              <li className="merch-card" key={category.key}>
                <figure className="merch-figure">
                  <Image
                    alt={category.imageAlt}
                    className="merch-image"
                    height={1125}
                    sizes="(max-width: 50rem) 100vw, 20vw"
                    src={category.image}
                    width={900}
                  />
                </figure>
                <h3>{category.title}</h3>
                <p>{category.description}</p>
              </li>
            ))}
          </ul>
          <div className="hero-actions merch-actions">
            <a className="button button-primary" href="/login?returnTo=%2Fshop">
              Sign in to order
            </a>
            <a className="button button-secondary" href="/shop">
              Open the club shop
            </a>
          </div>
        </section>

        <section className="contact-section" id="contact" aria-labelledby="contact-title">
          <div className="section-heading">
            <h2 id="contact-title">Start with a free class</h2>
            <p>{academyContent.notes.contact}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="/enrol">
                Book a free class
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>Brazilian Power Team Jersey</p>
        <p>Timetable checked {checkedOn(academyContent.lastVerified)}.</p>
        <a className="site-footer-staff" href="/staff/login">
          Staff sign-in
        </a>
      </footer>
    </>
  );
}
