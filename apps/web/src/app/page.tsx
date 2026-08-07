import { academyContent } from "../content/academy";

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="BPT Jersey home">
          <span>BPT</span>
          <span>Jersey</span>
        </a>

        <nav className="primary-nav" aria-label="Primary navigation">
          <a href="#top">Home</a>
          <a href="#classes">Classes</a>
          <a href="#programs">Programs</a>
          <a href="#locations">Locations</a>
          <a href="#contact">Contact</a>
          <a className="nav-cta" href="#contact">
            Book a free class
          </a>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Brazilian Power Team · Jersey</p>
            <h1 id="hero-title">{academyContent.identity.title}</h1>
            <p className="hero-intro">{academyContent.identity.intro}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#classes">
                View classes
              </a>
              <a className="button button-secondary" href="#contact">
                Book a free class
              </a>
            </div>
          </div>

          <aside className="hero-location" id="locations" aria-label="Academy location">
            <p className="section-kicker">Train in Jersey</p>
            <address>
              <strong>{academyContent.location.name}</strong>
              <span>{academyContent.location.address}</span>
              <span>
                {academyContent.location.locality}, {academyContent.location.postcode}
              </span>
            </address>
          </aside>
        </section>

        <section className="classes-section" id="classes" aria-labelledby="classes-title">
          <div className="section-heading">
            <p className="section-kicker">The weekly timetable</p>
            <h2 id="classes-title">Classes in Jersey</h2>
            <p>{academyContent.notes.booking}</p>
          </div>

          <div className="schedule-table-wrap schedule-board">
            <table className="schedule-table">
              <caption>Published class schedule</caption>
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
              <p className="section-kicker">The coaching team</p>
              <h3>Learn from experienced instructors</h3>
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

        <section className="programs-section" id="programs" aria-labelledby="programs-title">
          <div className="section-heading">
            <p className="section-kicker">Choose your starting point</p>
            <h2 id="programs-title">Find your way onto the mat</h2>
          </div>
          <ul className="program-list program-grid">
            {academyContent.programs.map((program) => (
              <li className="program-card" key={program.label}>
                <p className="card-label">{program.label}</p>
                <h3>{program.title}</h3>
                <p>{program.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="fees-section" id="fees" aria-labelledby="fees-title">
          <div className="section-heading">
            <p className="section-kicker">Published fees</p>
            <h2 id="fees-title">Simple ways to train</h2>
          </div>
          <ul className="fee-list fee-grid">
            {academyContent.fees.map((fee) => (
              <li className="fee-card" key={fee.label}>
                <p className="card-label">{fee.label}</p>
                <p className="fee-amount">{fee.amount}</p>
                <p>{fee.detail}</p>
              </li>
            ))}
          </ul>
          <p className="fee-note">{academyContent.notes.booking}</p>
        </section>

        <section className="platform-section" id="platform" aria-labelledby="platform-title">
          <div className="section-heading">
            <p className="section-kicker">A clearer academy experience</p>
            <h2 id="platform-title">One academy. One clear system.</h2>
            <p>
              Keep the details around training clear for families, coaches, and the academy team.
            </p>
          </div>
          <div className="platform-preview">
            <article className="platform-card">
              <p className="card-label">Families</p>
              <h3>Stay close to progress.</h3>
              <p>See schedules, attendance, memberships, and progress in one trusted view.</p>
            </article>
            <article className="platform-card">
              <p className="card-label">Coaches</p>
              <h3>Coach with context.</h3>
              <p>Keep the room, student progress, and next steps visible as training develops.</p>
            </article>
            <article className="platform-card">
              <p className="card-label">Academy team</p>
              <h3>Run the day clearly.</h3>
              <p>Bring classes, attendance, memberships, and follow-up into one clear system.</p>
            </article>
          </div>
        </section>

        <section className="contact-section" id="contact" aria-labelledby="contact-title">
          <div className="section-heading">
            <p className="section-kicker">Your first class starts here</p>
            <h2 id="contact-title">Start with a free class</h2>
            <p>{academyContent.notes.contact}</p>
            <div className="hero-actions">
              <a className="button button-secondary" href="#contact">
                Book a free class
              </a>
            </div>
          </div>
          <address className="contact-details">
            <strong>{academyContent.location.name}</strong>
            <span>
              {academyContent.location.address}, {academyContent.location.locality},{" "}
              {academyContent.location.postcode}
            </span>
          </address>
        </section>
      </main>

      <footer className="site-footer">
        <p>Brazilian Power Team Jersey</p>
        <p>Train with purpose. Belong to the team.</p>
        <p>Public information last verified {academyContent.lastVerified}.</p>
      </footer>
    </>
  );
}
