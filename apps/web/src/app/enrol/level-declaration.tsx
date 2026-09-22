import type { EnrolmentLevelDeclaration } from "@bpt-jersey/domain/members/enrolment-requests";
import type { LevelDefinitionRecord } from "@bpt-jersey/domain/levels";

/**
 * The stripe number lives in the definition's name — `stripeNumber` is null across the whole
 * catalogue — so `Blue - 2nd Stripe` is read as two stripes of the blue belt.
 */
const stripeOrdinalPattern = /(\d+)(?:st|nd|rd|th) Stripe$/u;

function withinAgeBand(definition: LevelDefinitionRecord, age: number): boolean {
  return (definition.criteria.minAge ?? 0) <= age && age <= (definition.criteria.maxAge ?? 200);
}

/** Belts an applicant of this age could hold: kids, teens and adult bands never mix. */
export function beltsForAge(
  definitions: readonly LevelDefinitionRecord[],
  age: number,
): readonly LevelDefinitionRecord[] {
  return definitions
    .filter((definition) => definition.kind === "belt" && withinAgeBand(definition, age))
    .sort((left, right) => left.sequence - right.sequence);
}

/** The stripes of one belt, ascending, each with the definition key that declares it. */
export function stripesForBelt(
  definitions: readonly LevelDefinitionRecord[],
  beltKey: string,
): readonly Readonly<{ definitionKey: string; stripes: number }>[] {
  return definitions
    .filter(
      (definition) => definition.kind === "stripe" && definition.parentDefinitionKey === beltKey,
    )
    .map((definition) => ({
      definitionKey: definition.definitionKey,
      stripes: Number(stripeOrdinalPattern.exec(definition.name)?.[1] ?? 0),
    }))
    .filter((stripe) => stripe.stripes > 0)
    .sort((left, right) => left.stripes - right.stripes);
}

/**
 * The belt a student who declared nothing starts on. The office opens a trial student's level with
 * it, so it has to be the white belt of their own age band — a nine-year-old beginner may not be
 * opened on the adult white belt. The highest sequence wins where two bands overlap, which is the
 * older of the two: a ten-year-old starts on the teens white belt, not the kids one.
 */
export function defaultWhiteBelt(
  definitions: readonly LevelDefinitionRecord[],
  age: number,
): string | undefined {
  return definitions
    .filter(
      (definition) =>
        definition.kind === "belt" &&
        definition.name.toUpperCase().startsWith("WHITE BELT") &&
        withinAgeBand(definition, age),
    )
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1)?.definitionKey;
}

/**
 * What the applicant says about where they are starting from. A beginner declares nothing and gets
 * two free Introduction Classes; anybody else names the belt and stripes they train at today and
 * gets one. Nothing here is verified — the office confirms the level when it reviews the request.
 */
export function LevelDeclaration({
  id,
  age,
  definitions,
  value,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  age: number;
  definitions: readonly LevelDefinitionRecord[];
  value: EnrolmentLevelDeclaration;
  disabled: boolean;
  onChange: (next: EnrolmentLevelDeclaration) => void;
}>) {
  const belts = beltsForAge(definitions, age);

  if (value.experience === "beginner") {
    return (
      <div className="enrol-level-declaration">
        <button
          className="button button-secondary"
          disabled={disabled}
          onClick={() =>
            onChange({
              experience: "experienced",
              declaredLevelKey: belts[0]?.definitionKey ?? null,
            })
          }
          type="button"
        >
          I&apos;m not a Beginner
        </button>
      </div>
    );
  }

  const backToBeginner = (
    <button
      className="button button-secondary"
      disabled={disabled}
      onClick={() => onChange({ experience: "beginner", declaredLevelKey: null })}
      type="button"
    >
      I am a beginner
    </button>
  );

  // No catalogue, no honest list of belts. The applicant is told so and can still send the request
  // as a beginner; the declaration stays incomplete, and the form refuses to send it that way.
  const firstBelt = belts[0];
  if (!firstBelt) {
    return (
      <div className="enrol-level-declaration">
        <p role="alert">
          Belt selection is unavailable right now — the office will confirm your level.
        </p>
        {backToBeginner}
      </div>
    );
  }

  const declared = definitions.find(
    (definition) => definition.definitionKey === value.declaredLevelKey,
  );
  const beltKey =
    declared?.kind === "stripe"
      ? (declared.parentDefinitionKey ?? firstBelt.definitionKey)
      : (declared?.definitionKey ?? firstBelt.definitionKey);
  const stripes = stripesForBelt(definitions, beltKey);
  const declaredStripes =
    declared?.kind === "stripe"
      ? (stripes.find((stripe) => stripe.definitionKey === declared.definitionKey)?.stripes ?? 0)
      : 0;

  return (
    <div className="enrol-level-declaration">
      <label className="enrol-field" htmlFor={`${id}-belt`}>
        Belt
        <select
          disabled={disabled}
          id={`${id}-belt`}
          // A stripe belongs to one belt, so changing the belt drops the stripes with it.
          onChange={(event) =>
            onChange({ experience: "experienced", declaredLevelKey: event.target.value })
          }
          value={beltKey}
        >
          {belts.map((belt) => (
            <option key={belt.definitionKey} value={belt.definitionKey}>
              {belt.name}
            </option>
          ))}
        </select>
      </label>
      <label className="enrol-field" htmlFor={`${id}-stripes`}>
        Stripes
        <select
          disabled={disabled}
          id={`${id}-stripes`}
          onChange={(event) => {
            const wanted = stripes.find((stripe) => String(stripe.stripes) === event.target.value);
            onChange({
              experience: "experienced",
              declaredLevelKey: wanted?.definitionKey ?? beltKey,
            });
          }}
          value={String(declaredStripes)}
        >
          <option value="0">No stripes</option>
          {stripes.map((stripe) => (
            <option key={stripe.definitionKey} value={String(stripe.stripes)}>
              {stripe.stripes === 1 ? "1 stripe" : `${stripe.stripes} stripes`}
            </option>
          ))}
        </select>
      </label>
      {backToBeginner}
    </div>
  );
}
