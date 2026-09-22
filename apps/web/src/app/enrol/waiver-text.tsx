import { enrolmentWaiverTermsSections } from "@bpt-jersey/domain/consents/enrolment-waiver";

/** The club's waiver in full, shared by /enrol and the one-off acceptance in /account. */
export function EnrolmentWaiverText() {
  return (
    <div className="enrol-waiver-scroll" tabIndex={0} role="region" aria-label="Waiver terms">
      {enrolmentWaiverTermsSections.map((section) => (
        <article key={section.heading}>
          <h3>{section.heading}</h3>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.bullets === undefined ? null : (
            <ul>
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}
