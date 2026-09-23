"use client";

import {
  programAgeLimits,
  programSites,
  type ProgramAgeRange,
  type ProgramSite,
} from "@bpt-jersey/domain/schedule/classes-services";

type Audience = Readonly<{ ageRange: ProgramAgeRange | null; sites: readonly ProgramSite[] }>;

const ages = Array.from(
  { length: programAgeLimits.max - programAgeLimits.min + 1 },
  (_, index) => programAgeLimits.min + index,
);

/**
 * Who can book a type: its age range and its training centres. Members only see, and can only
 * book, sessions of types that admit their age on the session date and the session's centre.
 */
export function AudienceFields({
  id,
  value,
  onChange,
}: Readonly<{ id: string; value: Audience; onChange: (next: Audience) => void }>) {
  const range = value.ageRange;
  return (
    <fieldset className="types-audience">
      <legend>Who can book</legend>
      <div className="types-age">
        <label className="types-field" htmlFor={`${id}-from`}>
          From age
          <select
            id={`${id}-from`}
            value={range?.minAge ?? ""}
            onChange={(event) => {
              const minAge = event.target.value === "" ? null : Number(event.target.value);
              onChange({
                ...value,
                ageRange:
                  minAge === null
                    ? null
                    : {
                        minAge,
                        maxAge:
                          range?.maxAge === undefined || range.maxAge === null
                            ? null
                            : Math.max(range.maxAge, minAge),
                      },
              });
            }}
          >
            <option value="">All ages</option>
            {ages.map((age) => (
              <option key={age} value={age}>
                {age}
              </option>
            ))}
          </select>
        </label>
        <label className="types-field" htmlFor={`${id}-to`}>
          To age
          <select
            id={`${id}-to`}
            disabled={range === null}
            value={range?.maxAge ?? "over"}
            onChange={(event) =>
              range &&
              onChange({
                ...value,
                ageRange: {
                  minAge: range.minAge,
                  maxAge: event.target.value === "over" ? null : Number(event.target.value),
                },
              })
            }
          >
            <option value="over">and over</option>
            {ages
              .filter((age) => age >= (range?.minAge ?? programAgeLimits.min))
              .map((age) => (
                <option key={age} value={age}>
                  {age}
                </option>
              ))}
          </select>
        </label>
      </div>
      <fieldset className="types-sites" aria-describedby={`${id}-sites-hint`}>
        <legend>Training centre</legend>
        <div className="types-checks types-checks-inline">
          {programSites.map((site) => (
            <label key={site}>
              <input
                type="checkbox"
                checked={value.sites.includes(site)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    sites: programSites.filter((candidate) =>
                      candidate === site ? event.target.checked : value.sites.includes(candidate),
                    ),
                  })
                }
              />
              {site}
            </label>
          ))}
        </div>
        <span className="types-hint" id={`${id}-sites-hint`}>
          None ticked: offered at both centres.
        </span>
      </fieldset>
    </fieldset>
  );
}

export function audienceSummary(program: Partial<Audience>): string {
  const range = program.ageRange ?? null;
  const ages =
    range === null
      ? "All ages"
      : range.maxAge === null
        ? `Ages ${range.minAge}+`
        : `Ages ${range.minAge}-${range.maxAge}`;
  const sites = program.sites?.length ? program.sites.join(" & ") : "Town & West";
  return `${ages} · ${sites}`;
}
