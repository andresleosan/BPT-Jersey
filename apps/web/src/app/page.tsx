const classLineup = [
  { time: "4:15 PM", name: "Kids BJJ", detail: "Ages 5–8", tone: "violet" },
  { time: "5:15 PM", name: "Junior BJJ", detail: "Ages 9–13", tone: "ink" },
  { time: "6:30 PM", name: "Adults Gi", detail: "All levels", tone: "violet" },
] as const;

const platformAreas = [
  {
    label: "Families",
    title: "Know what happens next.",
    copy: "Schedules, attendance, progress, memberships, and documents in one trusted family view.",
  },
  {
    label: "Coaches",
    title: "Coach with context.",
    copy: "See the room, record meaningful progress, and keep every student moving forward.",
  },
  {
    label: "Academy",
    title: "Run the day clearly.",
    copy: "Check-ins, child collection, payments, and follow-ups stay visible when the mat gets busy.",
  },
] as const;

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20">
      <path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="BPT Jersey home">
          <span>BPT</span>
          <span>Jersey</span>
        </a>

        <nav className="primary-nav" aria-label="Primary navigation">
          <a href="#academy">The academy</a>
          <a href="#platform">The platform</a>
          <a className="nav-cta" href="#contact">
            Start training
          </a>
        </nav>
      </header>

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Brazilian Power Team · Jersey</p>
          <h1 id="hero-title">
            Built for the mat.
            <span>Ready for everything around it.</span>
          </h1>
          <p className="hero-intro">
            One disciplined home for training, families, coaches, and the daily work that keeps a
            Brazilian Jiu-Jitsu academy moving.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#academy">
              Discover BPT Jersey
              <ArrowIcon />
            </a>
            <a className="button button-secondary" href="#platform">
              Explore the platform
            </a>
          </div>
          <p className="location-line">
            <span aria-hidden="true" />
            Brazilian Jiu-Jitsu in Jersey, Channel Islands
          </p>
        </div>

        <aside className="mat-board" aria-label="Sample academy schedule">
          <div className="board-kicker">
            <span>On the mat</span>
            <span>Today</span>
          </div>
          <h2>Tonight at BPT</h2>
          <ol className="class-lineup">
            {classLineup.map((classItem) => (
              <li key={classItem.time}>
                <span
                  className={`class-marker class-marker-${classItem.tone}`}
                  aria-hidden="true"
                />
                <time>{classItem.time}</time>
                <span className="class-name">{classItem.name}</span>
                <span className="class-detail">{classItem.detail}</span>
              </li>
            ))}
          </ol>
          <div className="board-footer">
            <span>Doors open 15 minutes before class</span>
            <span className="live-status">
              <span aria-hidden="true" />
              Academy ready
            </span>
          </div>
        </aside>
      </section>

      <section className="academy-section" id="academy" aria-labelledby="academy-title">
        <p className="section-number">01 / The academy</p>
        <div className="section-heading">
          <h2 id="academy-title">Train with purpose. Belong to the team.</h2>
          <p>
            BPT Jersey brings serious Brazilian Jiu-Jitsu instruction into a welcoming environment
            where children and adults can build skill, confidence, and discipline.
          </p>
        </div>
        <div className="academy-principles" aria-label="Academy principles">
          <p>Technical standards</p>
          <p>Clear progression</p>
          <p>Strong community</p>
        </div>
      </section>

      <section className="platform-section" id="platform" aria-labelledby="platform-title">
        <div className="platform-heading">
          <p className="section-number">02 / The platform</p>
          <h2 id="platform-title">One academy. One clear system.</h2>
        </div>
        <div className="platform-grid">
          {platformAreas.map((area) => (
            <article key={area.label}>
              <p>{area.label}</p>
              <h3>{area.title}</h3>
              <p>{area.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="contact-section" id="contact" aria-labelledby="contact-title">
        <div>
          <p className="eyebrow">Your first class starts here</p>
          <h2 id="contact-title">Step onto the mat.</h2>
        </div>
        <a className="button button-light" href="https://bptjersey.com/" rel="noreferrer">
          Visit BPT Jersey
          <ArrowIcon />
        </a>
      </section>

      <footer>
        <p>Brazilian Power Team Jersey</p>
        <p>Discipline on the mat. Clarity beyond it.</p>
      </footer>
    </main>
  );
}
