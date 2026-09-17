"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  memberHowHeardOptions,
  memberInitialContactOptions,
} from "@bpt-jersey/domain/members/directory";
import {
  academyDateOf,
  deriveBmi,
  deriveShortNameVariants,
  memberAgeOn,
  type FullMemberProfile,
} from "@bpt-jersey/domain/members/profile";

import {
  MemberDetailsConflictError,
  MemberDetailsSaveError,
  saveMemberDetails,
  searchMemberNames,
} from "../../../../lib/member-profile-client";
import {
  countryOptions,
  dialCodes,
  draftFromDetails,
  idExpiryNotice,
  isDraftDirty,
  payloadFromDraft,
  type DetailsDraft,
  type DetailsDraftField,
} from "./details-form-model";

type SaveState = "idle" | "saving" | "saved" | "invalid" | "conflict" | "error";

const bmiLabels = {
  underweight: "Underweight",
  healthy: "Healthy",
  overweight: "Overweight",
  obese: "Obese",
} as const;

/**
 * A stored `howHeard` or `initialContact` is free text, while the update input is an enum: a value
 * from outside the list would make an untouched save fail with nothing on screen to explain it. The
 * select keeps the stored value visible, says it is no longer a choice and marks itself invalid
 * until the user picks a listed one - never silently kept and never silently dropped.
 */
const outOfListMessage = "This stored value is no longer a choice. Pick one from the list.";

const saveFallbackError = "Unable to save member details. Please try again.";

function isOutOfList(value: string, options: readonly string[]): boolean {
  return value !== "" && !options.includes(value);
}

function OutOfListHint() {
  return (
    <span className="member-record-error" role="alert">
      {outOfListMessage}
    </span>
  );
}

function fieldId(field: DetailsDraftField): string {
  return `member-details-${field}`;
}

function Field({
  field,
  label,
  hint,
  children,
  wide = false,
}: {
  field: DetailsDraftField | "recommendedBySearch" | "bmi";
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`login-field${wide ? " member-record-wide" : ""}`}>
      <label htmlFor={`member-details-${field}`}>{label}</label>
      {children}
      {hint === undefined ? null : (
        <p className="member-record-hint" id={`member-details-${field}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function RecommendedByPicker({
  value,
  studentId,
  invalid,
  onChange,
}: {
  value: string;
  studentId: string;
  invalid: boolean;
  onChange: (studentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly { studentId: string; fullName: string }[]>([]);
  const [chosenName, setChosenName] = useState<string>();
  const [searchState, setSearchState] = useState<"idle" | "searching" | "error">("idle");

  async function search(): Promise<void> {
    setSearchState("searching");
    try {
      const members = await searchMemberNames(query);
      setResults(members.filter((member) => member.studentId !== studentId));
      setSearchState("idle");
    } catch {
      setSearchState("error");
    }
  }

  if (value !== "") {
    return (
      <div className="login-field member-record-wide">
        <span className="member-record-hint">Recommended by</span>
        {/* ponytail: a stored recommender loaded from the record shows without a name; resolving it
            would spend a read per open. The name shows once chosen in this session. */}
        <p>{chosenName ?? "A member is recorded"}</p>
        <button
          className="member-record-link"
          onClick={() => {
            onChange("");
            setChosenName(undefined);
          }}
          type="button"
        >
          Clear recommended by
        </button>
      </div>
    );
  }

  return (
    <div className="login-field member-record-wide">
      <label htmlFor="member-details-recommendedBySearch">Recommended by</label>
      <input
        aria-invalid={invalid}
        autoComplete="off"
        id="member-details-recommendedBySearch"
        maxLength={80}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void search();
          }
        }}
        type="search"
        value={query}
      />
      <button
        className="member-record-link"
        disabled={searchState === "searching"}
        onClick={() => void search()}
        type="button"
      >
        Find member
      </button>
      {searchState === "error" ? (
        <p className="member-record-hint" role="alert">
          Unable to search members. Please try again.
        </p>
      ) : null}
      {results.length === 0 ? null : (
        <ul className="member-record-results">
          {results.map((member) => (
            <li key={member.studentId}>
              <span>{member.fullName}</span>{" "}
              <button
                aria-label={`Choose ${member.fullName}`}
                className="member-record-link"
                onClick={() => {
                  setChosenName(member.fullName);
                  setResults([]);
                  onChange(member.studentId);
                }}
                type="button"
              >
                Choose
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DetailsTab({
  profile,
  onDirtyChange,
  onSaved,
}: {
  profile: FullMemberProfile;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const [baseline, setBaseline] = useState<DetailsDraft>(() => draftFromDetails(profile.details));
  const [draft, setDraft] = useState<DetailsDraft>(baseline);
  const [requestId, setRequestId] = useState(() => globalThis.crypto.randomUUID());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveErrorMessage, setSaveErrorMessage] = useState(saveFallbackError);
  const [invalidFields, setInvalidFields] = useState<readonly DetailsDraftField[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = isDraftDirty(baseline, draft);
  const today = academyDateOf(new Date().toISOString());

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return undefined;
    function warn(event: BeforeUnloadEvent): void {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    function saveShortcut(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  }, []);

  function update(field: DetailsDraftField, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
    // A changed draft is a different request; a retry of the same draft keeps its id (idempotent).
    setRequestId(globalThis.crypto.randomUUID());
    setInvalidFields((current) => current.filter((entry) => entry !== field));
    setSaveState((current) => (current === "saving" ? current : "idle"));
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saveState === "saving") return;
    const result = payloadFromDraft(profile.details, draft, requestId);
    if (!result.ok) {
      setInvalidFields(result.fields);
      setSaveState("invalid");
      const [first] = result.fields;
      if (first !== undefined) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setInvalidFields([]);
    setSaveState("saving");
    try {
      await saveMemberDetails(result.payload);
      setBaseline(draft);
      setRequestId(globalThis.crypto.randomUUID());
      setSaveState("saved");
      onSaved();
    } catch (error) {
      if (error instanceof MemberDetailsConflictError) {
        setInvalidFields(["membershipNumber"]);
        setSaveState("conflict");
        document.getElementById(fieldId("membershipNumber"))?.focus();
      } else {
        // The client turns every save failure into one safe sentence, so a rate limit can say that
        // waiting is the fix. Anything else (a bug in this page) keeps the generic sentence.
        setSaveErrorMessage(
          error instanceof MemberDetailsSaveError && error.message !== ""
            ? error.message
            : saveFallbackError,
        );
        setSaveState("error");
      }
    }
  }

  function text(
    field: DetailsDraftField,
    maxLength: number,
    type: "text" | "email" | "tel" | "date" = "text",
    extra: { required?: boolean; describedBy?: boolean } = {},
  ) {
    return (
      <input
        aria-describedby={extra.describedBy ? `${fieldId(field)}-hint` : undefined}
        aria-invalid={invalidFields.includes(field)}
        id={fieldId(field)}
        maxLength={type === "date" ? undefined : maxLength}
        onChange={(event) => update(field, event.target.value)}
        required={extra.required}
        type={type}
        value={draft[field]}
      />
    );
  }

  function choice(field: "howHeard" | "initialContact", options: readonly string[]) {
    const outOfList = isOutOfList(draft[field], options);
    return (
      <select
        aria-describedby={outOfList ? `${fieldId(field)}-hint` : undefined}
        aria-invalid={invalidFields.includes(field) || outOfList}
        id={fieldId(field)}
        onChange={(event) => update(field, event.target.value)}
        value={draft[field]}
      >
        <option value="">Not set</option>
        {outOfList ? <option value={draft[field]}>{draft[field]}</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  const shortNames = deriveShortNameVariants(draft.fullName);
  const shortNameOptions =
    draft.shortName === "" || shortNames.includes(draft.shortName)
      ? shortNames
      : [draft.shortName, ...shortNames];
  const age = memberAgeOn(draft.dateOfBirth, today);
  const bmi = deriveBmi(
    draft.weightKg.trim() === "" ? undefined : Number(draft.weightKg),
    draft.heightCm.trim() === "" ? undefined : Number(draft.heightCm),
  );
  const expiry = idExpiryNotice(draft.idCardExpiresOn, today);

  return (
    <form
      aria-label="Member details"
      className="member-record-form"
      noValidate
      onSubmit={(event) => void save(event)}
      ref={formRef}
    >
      <fieldset>
        <legend>Identification</legend>
        <Field field="fullName" label="Full name">
          {text("fullName", 160, "text", { required: true })}
        </Field>
        <Field field="shortName" label="Short name">
          <select
            id={fieldId("shortName")}
            onChange={(event) => update("shortName", event.target.value)}
            value={draft.shortName}
          >
            <option value="">Not set</option>
            {shortNameOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
        <Field
          field="membershipNumber"
          label="Member No."
          hint={
            profile.nextFreeMemberNumber !== undefined && draft.membershipNumber === "" ? (
              <button
                className="member-record-link"
                onClick={() => update("membershipNumber", profile.nextFreeMemberNumber ?? "")}
                type="button"
              >
                {`Use next free number ${profile.nextFreeMemberNumber}`}
              </button>
            ) : undefined
          }
        >
          {text("membershipNumber", 64)}
        </Field>
        <Field field="nickname" label="Nickname" hint="Internal. Never shown to the member.">
          {text("nickname", 64, "text", { describedBy: true })}
        </Field>
      </fieldset>

      <fieldset>
        <legend>Contacts</legend>
        <Field field="email" label="E-mail">
          {text("email", 320, "email")}
        </Field>
        <Field field="phoneCountryCode" label="Mobile country code">
          <select
            id={fieldId("phoneCountryCode")}
            onChange={(event) => update("phoneCountryCode", event.target.value)}
            value={draft.phoneCountryCode}
          >
            <option value="">No code</option>
            {dialCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <Field field="phoneLocalNumber" label="Mobile number">
          {text("phoneLocalNumber", 58, "tel")}
        </Field>
        <Field field="emergencyContactFullName" label="Emergency contact name">
          {text("emergencyContactFullName", 160)}
        </Field>
        <Field field="emergencyContactRelationship" label="Emergency contact relationship">
          {text("emergencyContactRelationship", 64)}
        </Field>
        <Field field="emergencyContactPhoneNumber" label="Emergency contact phone">
          {text("emergencyContactPhoneNumber", 64, "tel")}
        </Field>
        <Field
          field="emergencyContactAlternatePhoneNumber"
          label="Emergency contact alternate phone"
        >
          {text("emergencyContactAlternatePhoneNumber", 64, "tel")}
        </Field>
      </fieldset>

      <fieldset>
        <legend>Address</legend>
        <Field field="addressLine" label="Address" wide>
          {text("addressLine", 240)}
        </Field>
        <Field field="city" label="City">
          {text("city", 120)}
        </Field>
        <Field field="postCode" label="Postal code">
          {text("postCode", 16)}
        </Field>
        <Field field="country" label="Country">
          <select
            id={fieldId("country")}
            onChange={(event) => update("country", event.target.value)}
            value={draft.country}
          >
            <option value="">Not set</option>
            {countryOptions().map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset>
        <legend>Documents</legend>
        <Field field="idCardNumber" label="ID card no.">
          {text("idCardNumber", 64)}
        </Field>
        <Field
          field="idCardExpiresOn"
          label="ID expiry"
          hint={
            expiry === null
              ? undefined
              : expiry.kind === "expired"
                ? "ID card expired"
                : expiry.days === 0
                  ? "ID card expires today"
                  : `ID card expires in ${expiry.days} days`
          }
        >
          {text("idCardExpiresOn", 10, "date", { describedBy: expiry !== null })}
        </Field>
        <Field field="healthNumber" label="Health number">
          {text("healthNumber", 64)}
        </Field>
        <Field field="vatNumber" label="Tax number">
          {text("vatNumber", 64)}
        </Field>
        <Field field="profession" label="Profession">
          {text("profession", 120)}
        </Field>
      </fieldset>

      <fieldset>
        <legend>Personal</legend>
        <Field field="gender" label="Gender">
          <select
            id={fieldId("gender")}
            onChange={(event) => update("gender", event.target.value)}
            value={draft.gender}
          >
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="unknown">Not stated</option>
          </select>
        </Field>
        <Field
          field="dateOfBirth"
          label="Date of birth"
          hint={age === null ? undefined : `${age} years old`}
        >
          {text("dateOfBirth", 10, "date", { required: true, describedBy: age !== null })}
        </Field>
        <Field field="weightKg" label="Weight (kg)">
          <input
            aria-invalid={invalidFields.includes("weightKg")}
            id={fieldId("weightKg")}
            inputMode="decimal"
            max={400}
            min={1}
            onChange={(event) => update("weightKg", event.target.value)}
            step={0.1}
            type="number"
            value={draft.weightKg}
          />
        </Field>
        <Field field="heightCm" label="Height (cm)">
          <input
            aria-invalid={invalidFields.includes("heightCm")}
            id={fieldId("heightCm")}
            inputMode="numeric"
            max={250}
            min={30}
            onChange={(event) => update("heightCm", event.target.value)}
            step={1}
            type="number"
            value={draft.heightCm}
          />
        </Field>
        <div className="login-field">
          <span className="member-record-hint" id="member-details-bmi-label">
            BMI
          </span>
          <output aria-labelledby="member-details-bmi-label" role="status">
            {bmi === null ? "—" : `${bmi.value.toFixed(1)} · ${bmiLabels[bmi.category]}`}
          </output>
        </div>
      </fieldset>

      <fieldset>
        <legend>Registration</legend>
        <Field field="registeredOn" label="Registration date">
          {text("registeredOn", 10, "date")}
        </Field>
        <Field
          field="howHeard"
          label="How they heard"
          hint={isOutOfList(draft.howHeard, memberHowHeardOptions) ? <OutOfListHint /> : undefined}
        >
          {choice("howHeard", memberHowHeardOptions)}
        </Field>
        <Field
          field="initialContact"
          label="Initial contact"
          hint={
            isOutOfList(draft.initialContact, memberInitialContactOptions) ? (
              <OutOfListHint />
            ) : undefined
          }
        >
          {choice("initialContact", memberInitialContactOptions)}
        </Field>
        <RecommendedByPicker
          invalid={invalidFields.includes("recommendedByStudentId")}
          onChange={(value) => update("recommendedByStudentId", value)}
          studentId={profile.header.studentId}
          value={draft.recommendedByStudentId}
        />
      </fieldset>

      <fieldset>
        <legend>Notes</legend>
        <Field
          field="internalNotes"
          label="Internal notes"
          hint="Internal. Never shown to the member."
          wide
        >
          <textarea
            aria-describedby={`${fieldId("internalNotes")}-hint`}
            aria-invalid={invalidFields.includes("internalNotes")}
            id={fieldId("internalNotes")}
            maxLength={2000}
            onChange={(event) => update("internalNotes", event.target.value)}
            rows={5}
            value={draft.internalNotes}
          />
        </Field>
      </fieldset>

      <div className="member-record-save-bar">
        <button className="member-record-button" disabled={saveState === "saving"} type="submit">
          {saveState === "saving" ? "Saving details" : "Save details"}
        </button>
        <p className="member-record-hint">
          {dirty ? "Unsaved changes. " : ""}Ctrl or Cmd + S saves.
        </p>
        {saveState === "saved" ? <p role="status">Details saved.</p> : null}
        {/* `payloadFromDraft` maps an unmappable issue to `fullName`, so the highlighting alone can
            point at a field that looks right: this generic line always goes with it. */}
        {saveState === "invalid" ? <p role="alert">Check the highlighted fields.</p> : null}
        {saveState === "conflict" ? (
          <p role="alert">That member number is already used by another member.</p>
        ) : null}
        {saveState === "error" ? <p role="alert">{saveErrorMessage}</p> : null}
      </div>
    </form>
  );
}
