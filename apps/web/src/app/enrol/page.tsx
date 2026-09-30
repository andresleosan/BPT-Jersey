"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  EnrolmentRequestClientView,
  EnrolmentRequestDetails,
} from "@bpt-jersey/domain/members/enrolment-requests";
import { ClientAuthProvider, useClientSession } from "../../lib/client-auth";
import {
  enrolmentWaiverTermsAcknowledgement,
  enrolmentWaiverTermsTitle,
  enrolmentWaiverTermsVersion,
} from "@bpt-jersey/domain/consents/enrolment-waiver";
import {
  createEnrolmentRequestId,
  listMyEnrolmentRequests,
  submitEnrolmentRequest,
  uploadEnrolmentPaymentProof,
  withdrawEnrolmentRequest,
} from "../../lib/enrolment-client";
import {
  parseEnrolmentRequestDetails,
  enrolmentPaymentTotal,
  parseEnrolmentRequestSubmission,
  maximumEnrolmentRequestMinors,
  trialPlanChoice,
  type EnrolmentLevelDeclaration,
  type EnrolmentPlanChoice,
} from "@bpt-jersey/domain/members/enrolment-requests";
import { ageOnDate } from "@bpt-jersey/domain/schedule/member-calendar";
import type { LevelDefinitionRecord } from "@bpt-jersey/domain/levels";
import { getLevelCatalog } from "../../lib/levels-client";
import { loadAccountPeople } from "../../lib/account-people";
import { getFamily } from "../../lib/family-client";
import { getClientProfile } from "../../lib/profile-client";
import { beltsForAge, LevelDeclaration } from "./level-declaration";
import { EnrolmentBankDetails, useEnrolmentBankDetails } from "./payment-instructions";
import { EnrolmentPlanChoices } from "./plan-choices";
import { EnrolmentWaiverText } from "./waiver-text";
import "./enrolment-steps.css";

const preferenceOptions = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
] as const;

const centerOptions = ["Town", "West"] as const;
const genderOptions = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "unknown", label: "Prefer not to say" },
] as const;

type Preference = (typeof preferenceOptions)[number]["value"];
type Center = (typeof centerOptions)[number];
type Gender = (typeof genderOptions)[number]["value"];

/**
 * Every student starts as "No, I'm new" on the free trial; the details step asks each of them
 * whether they have trained before, and an experienced student names their belt on the plans step.
 */
const beginnerDeclaration: EnrolmentLevelDeclaration = {
  experience: "beginner",
  declaredLevelKey: null,
};

type Experience = EnrolmentLevelDeclaration["experience"];

const westBeginnerNotice =
  "Beginners start with the Introduction Class in Town. West is open once you have trained before or hold a paid plan.";
// Adults only (Luis, 2026-10-01): the adult Free Trial for beginners is the Introduction Class,
// which runs only in Town. Adults who have trained before get one regular class at their centre.
const westAdultTrialNotice =
  "Free Trial in West: adults who have never trained can only attend the Introduction Class, and it runs only in Town. If you have trained before, choose that above to use your free class in West.";

type MinorForm = {
  selectedPlan: EnrolmentPlanChoice | "";
  declaration: EnrolmentLevelDeclaration;
  /** Set when this beginner chose West and was moved to Town, so the reason is shown. */
  movedToTown: boolean;
  fullName: string;
  dateOfBirth: string;
  gender: Gender;
  trainingCenter: Center;
  trainingTimePreferences: Preference[];
};

type ApplicantForm = {
  selectedPlan: EnrolmentPlanChoice | "";
  declaration: EnrolmentLevelDeclaration;
  movedToTown: boolean;
  /** The "Who is joining" choice: a guardian enrols children and may also train themselves. */
  guardian: boolean;
  /** Whether the applicant trains: always for an adult student, opt-in for a guardian. */
  applicantIsStudent: boolean;
  fullName: string;
  dateOfBirth: string;
  phoneNumber: string;
  email: string;
  trainingCenter: Center;
  trainingTimePreferences: Preference[];
  gender: Gender;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  minors: MinorForm[];
  waiverAccepted: boolean;
};

const emptyMinor: MinorForm = {
  selectedPlan: trialPlanChoice,
  declaration: beginnerDeclaration,
  movedToTown: false,
  fullName: "",
  dateOfBirth: "",
  gender: "unknown",
  trainingCenter: "Town",
  trainingTimePreferences: [],
};

const emptyForm: ApplicantForm = {
  selectedPlan: trialPlanChoice,
  declaration: beginnerDeclaration,
  movedToTown: false,
  guardian: false,
  applicantIsStudent: true,
  fullName: "",
  dateOfBirth: "",
  phoneNumber: "",
  email: "",
  trainingCenter: "Town",
  trainingTimePreferences: [],
  gender: "unknown",
  emergencyName: "",
  emergencyRelationship: "",
  emergencyPhone: "",
  minors: [],
  waiverAccepted: false,
};

/** The three ways to join (spec 2026-09-30 D5). */
type Who = "self" | "child" | "both";
const allWhoOptions: readonly Readonly<{ value: Who; label: string }>[] = [
  { value: "self", label: "Just me" },
  { value: "child", label: "My child or children" },
  { value: "both", label: "Me and my child or children" },
];
const who = (form: ApplicantForm): Who =>
  !form.guardian ? "self" : form.applicantIsStudent ? "both" : "child";
const withWho = (form: ApplicantForm, next: Who): ApplicantForm => ({
  ...form,
  guardian: next !== "self",
  applicantIsStudent: next !== "child",
});

// An applicant is told the truth about every state, including the two the approval introduced: a
// request being processed is not "waiting", and one whose approval stopped is not "approved".
const statusLabels = {
  submitted: "Waiting for the academy",
  returned: "Sent back to you",
  approving: "Being processed by the academy",
  "approval-failed": "The academy is looking into it",
  approved: "Approved",
  withdrawn: "Withdrawn",
} as const;

function trimmed(value: string): string | undefined {
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

/**
 * Turns the form into the submission contract. Empty optional fields are dropped rather than sent
 * as empty strings, because the contract rejects an empty string where it accepts an absent field.
 */
function toDetails(form: ApplicantForm, requestId: string): EnrolmentRequestDetails {
  const emergencyContact =
    trimmed(form.emergencyName) &&
    trimmed(form.emergencyRelationship) &&
    trimmed(form.emergencyPhone)
      ? {
          fullName: form.emergencyName.trim(),
          relationship: form.emergencyRelationship.trim(),
          phoneNumber: form.emergencyPhone.trim(),
        }
      : undefined;
  return {
    requestId,
    applicantIsStudent: form.applicantIsStudent,
    applicant: {
      fullName: form.fullName.trim(),
      dateOfBirth: form.dateOfBirth,
      trainingCenter: form.applicantIsStudent
        ? form.trainingCenter
        : (form.minors[0]?.trainingCenter ?? form.trainingCenter),
      trainingTimePreferences: form.applicantIsStudent ? [...form.trainingTimePreferences] : [],
      gender: form.gender,
      phoneNumber: form.phoneNumber.trim(),
      ...(trimmed(form.email) === undefined ? {} : { email: form.email.trim() }),
      ...(emergencyContact === undefined ? {} : { emergencyContact }),
    },
    minors: (form.guardian ? form.minors : []).map((minor) => ({
      fullName: minor.fullName.trim(),
      dateOfBirth: minor.dateOfBirth,
      gender: minor.gender,
      trainingCenter: minor.trainingCenter,
      trainingTimePreferences: [...minor.trainingTimePreferences],
      ...(emergencyContact ? { emergencyContact } : {}),
    })),
    // Only the version travels. The server stores the hash of the text it holds, so the acceptance
    // names words the academy can reproduce rather than words this form claims were on screen.
    waiverAcceptance: { version: enrolmentWaiverTermsVersion, accepted: true },
  };
}

function validate(
  form: ApplicantForm,
  requestId: string,
  effectiveDate: string,
): string | undefined {
  if (!form.fullName.trim()) return "Enter your full name.";
  if (!form.dateOfBirth) return "Enter your date of birth.";
  // Required here, unlike on the administrative form: the academy cannot open a client record
  // without a phone number, and office is not standing in front of this applicant to ask.
  if (!form.phoneNumber.trim()) return "Enter a phone number the academy can reach you on.";
  if (form.trainingTimePreferences.length === 0 && form.applicantIsStudent) {
    return "Choose at least one training time.";
  }
  if (form.guardian && form.minors.length === 0) {
    return "Add the child you are enrolling.";
  }
  for (const minor of form.guardian ? form.minors : []) {
    if (!minor.fullName.trim()) return "Enter every child's full name.";
    if (!minor.dateOfBirth) return "Enter every child's date of birth.";
    if (minor.trainingTimePreferences.length === 0) {
      return "Choose at least one training time for every child.";
    }
  }
  const emergencyFields = [form.emergencyName, form.emergencyRelationship, form.emergencyPhone];
  if (
    emergencyFields.some((value) => value.trim()) &&
    !emergencyFields.every((value) => value.trim())
  ) {
    return "Complete the emergency contact name, relationship and phone number.";
  }
  // Last, so somebody who accepted and then missed a field is not told to accept again.
  if (!form.waiverAccepted) {
    return "Read and accept the waiver before sending your request.";
  }
  const parsed = parseEnrolmentRequestDetails(toDetails(form, requestId), effectiveDate);
  if (!parsed.ok) {
    const problem = parsed.error[0];
    if (problem?.path.includes("dateOfBirth")) {
      return "Check the dates of birth: applicants must be 18 or over and children must be under 18.";
    }
    if (problem?.path.includes("email")) return "Enter a valid email address.";
    return "Check that all details are complete and valid before choosing plans.";
  }
  return undefined;
}

/**
 * The club's waiver, shown in full rather than linked. An acceptance is only worth storing if the
 * person could read what they accepted without leaving the form, and the stored acceptance names
 * this exact version.
 */
function WaiverTerms({
  accepted,
  onChange,
}: Readonly<{ accepted: boolean; onChange: (next: boolean) => void }>) {
  return (
    <fieldset className="enrol-waiver">
      <legend>{enrolmentWaiverTermsTitle}</legend>
      <p className="enrol-hint">Version {enrolmentWaiverTermsVersion}.</p>
      <EnrolmentWaiverText />
      <label className="enrol-waiver-accept">
        <input
          checked={accepted}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>{enrolmentWaiverTermsAcknowledgement}</span>
      </label>
    </fieldset>
  );
}

type StudentPlacement = Pick<
  MinorForm,
  "declaration" | "movedToTown" | "selectedPlan" | "trainingCenter"
>;

/**
 * Applies a student's experience answer and centre together. Beginners start at Town with the
 * Introduction Class, so a beginner who is at (or picks) West is moved to Town and told why. A
 * change of centre resets the plan to the trial, as the plans differ per centre.
 */
function placeStudent<T extends StudentPlacement>(
  student: T,
  experience: Experience,
  trainingCenter: Center,
): T {
  const moved = experience === "beginner" && trainingCenter === "West";
  const nextCenter: Center = moved ? "Town" : trainingCenter;
  return {
    ...student,
    declaration:
      experience === student.declaration.experience
        ? student.declaration
        : { experience, declaredLevelKey: null },
    trainingCenter: nextCenter,
    selectedPlan: nextCenter === student.trainingCenter ? student.selectedPlan : trialPlanChoice,
    movedToTown: moved,
  };
}

function ExperienceQuestion({
  id,
  child,
  experience,
  onChange,
}: Readonly<{
  id: string;
  child: boolean;
  experience: Experience;
  onChange: (next: Experience) => void;
}>) {
  return (
    <fieldset className="enrol-experience">
      <legend>
        {child
          ? "Does this child have Brazilian Jiu-Jitsu experience?"
          : "Do you have Brazilian Jiu-Jitsu experience?"}
      </legend>
      <label htmlFor={`${id}-beginner`}>
        <input
          checked={experience === "beginner"}
          id={`${id}-beginner`}
          name={id}
          onChange={() => onChange("beginner")}
          type="radio"
        />
        {child ? "No, they are new" : "No, I'm new"}
      </label>
      <label htmlFor={`${id}-experienced`}>
        <input
          checked={experience === "experienced"}
          id={`${id}-experienced`}
          name={id}
          onChange={() => onChange("experienced")}
          type="radio"
        />
        {child ? "Yes, they have trained before" : "Yes, I have trained before"}
      </label>
    </fieldset>
  );
}

function TownNotice({ shown, adult = false }: Readonly<{ shown: boolean; adult?: boolean }>) {
  return shown ? (
    <p className="enrol-message enrol-centre-notice" role="status">
      {adult ? westAdultTrialNotice : westBeginnerNotice}
    </p>
  ) : null;
}

function togglePreference(list: readonly Preference[], value: Preference): Preference[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function StatusCard({
  request,
  busy,
  onWithdraw,
}: Readonly<{
  request: EnrolmentRequestClientView;
  busy: boolean;
  onWithdraw: () => void;
}>) {
  return (
    <section className="enrol-status" aria-labelledby="enrol-status-title">
      <p className="account-eyebrow">Your request</p>
      <h2 id="enrol-status-title">{statusLabels[request.status]}</h2>
      <p>Sent on {new Date(request.submittedAt).toLocaleDateString("en-GB")}.</p>
      {request.status === "submitted" ? (
        <p>
          The academy reviews requests in person at reception. You will be able to book classes once
          they confirm your place.
        </p>
      ) : null}
      {request.status === "returned" && request.reviewNote ? (
        <p className="enrol-review-note">
          <strong>The academy asked for a change:</strong> {request.reviewNote}
        </p>
      ) : null}
      <div className="hero-actions">
        {request.status === "submitted" || request.status === "returned" ? (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={onWithdraw}
            type="button"
          >
            Withdraw this request
          </button>
        ) : null}
        <a className="button button-secondary" href="/">
          Back to the home page
        </a>
      </div>
    </section>
  );
}

/** The belt of somebody who answered that they have trained before, right under that answer. */
function BeltPicker({
  id,
  dateOfBirth,
  declaration,
  definitions,
  loading,
  onChange,
}: Readonly<{
  id: string;
  dateOfBirth: string;
  declaration: EnrolmentLevelDeclaration;
  definitions: readonly LevelDefinitionRecord[];
  loading: boolean;
  onChange: (next: EnrolmentLevelDeclaration) => void;
}>) {
  if (declaration.experience === "beginner") return null;
  if (!dateOfBirth) return <p className="enrol-hint">Enter the date of birth to choose the belt.</p>;
  if (loading && definitions.length === 0) return <p className="enrol-hint">Loading belts…</p>;
  return (
    <LevelDeclaration
      id={id}
      age={ageOnDate(dateOfBirth, new Date().toISOString().slice(0, 10))}
      definitions={definitions}
      value={declaration}
      disabled={false}
      onChange={onChange}
    />
  );
}

function MinorFields({
  minor,
  index,
  definitions,
  catalogLoading,
  onChange,
  onRemove,
}: Readonly<{
  minor: MinorForm;
  index: number;
  definitions: readonly LevelDefinitionRecord[];
  catalogLoading: boolean;
  onChange: (next: MinorForm) => void;
  onRemove: () => void;
}>) {
  const prefix = `enrol-minor-${index}`;
  return (
    <fieldset className="enrol-minor">
      <legend>Child {index + 1}</legend>
      <label className="enrol-field" htmlFor={`${prefix}-name`}>
        Full name
        <input
          id={`${prefix}-name`}
          maxLength={160}
          onChange={(event) => onChange({ ...minor, fullName: event.target.value })}
          value={minor.fullName}
        />
      </label>
      <label className="enrol-field" htmlFor={`${prefix}-dob`}>
        Date of birth
        <input
          id={`${prefix}-dob`}
          onChange={(event) =>
            onChange({
              ...minor,
              dateOfBirth: event.target.value,
              selectedPlan: trialPlanChoice,
              declaration: { ...minor.declaration, declaredLevelKey: null },
            })
          }
          type="date"
          value={minor.dateOfBirth}
        />
      </label>
      <label className="enrol-field" htmlFor={`${prefix}-gender`}>
        Gender
        <select
          id={`${prefix}-gender`}
          onChange={(event) => onChange({ ...minor, gender: event.target.value as Gender })}
          value={minor.gender}
        >
          {genderOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <ExperienceQuestion
        id={`${prefix}-experience`}
        child
        experience={minor.declaration.experience}
        onChange={(experience) => onChange(placeStudent(minor, experience, minor.trainingCenter))}
      />
      <BeltPicker
        id={`${prefix}-level`}
        dateOfBirth={minor.dateOfBirth}
        declaration={minor.declaration}
        definitions={definitions}
        loading={catalogLoading}
        onChange={(declaration) => onChange({ ...minor, declaration })}
      />
      <label className="enrol-field" htmlFor={`${prefix}-center`}>
        Training centre
        <select
          id={`${prefix}-center`}
          onChange={(event) =>
            onChange(
              placeStudent(minor, minor.declaration.experience, event.target.value as Center),
            )
          }
          value={minor.trainingCenter}
        >
          {centerOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <TownNotice shown={minor.movedToTown} />
      <fieldset className="enrol-preferences">
        <legend>Training times</legend>
        {preferenceOptions.map((option) => (
          <label key={option.value} htmlFor={`${prefix}-${option.value}`}>
            <input
              checked={minor.trainingTimePreferences.includes(option.value)}
              id={`${prefix}-${option.value}`}
              onChange={() =>
                onChange({
                  ...minor,
                  trainingTimePreferences: togglePreference(
                    minor.trainingTimePreferences,
                    option.value,
                  ),
                })
              }
              type="checkbox"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <button className="button button-secondary" onClick={onRemove} type="button">
        Remove child {index + 1}
      </button>
    </fieldset>
  );
}

function EnrolContent() {
  const { session, status } = useClientSession();
  const [form, setForm] = useState<ApplicantForm>(emptyForm);
  const [step, setStep] = useState<"details" | "plans" | "payment">("details");
  const [proof, setProof] = useState<File>();
  const [proofId, setProofId] = useState<string>();
  const [paidOn, setPaidOn] = useState("");
  const [reference, setReference] = useState("");
  const effectiveDate = new Date().toISOString().slice(0, 10);
  // The belt catalogue is read once and never blocks the form: a student who cannot be offered
  // belts is told the office will confirm their level.
  const [definitions, setDefinitions] = useState<readonly LevelDefinitionRecord[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const selections = {
    ...(form.applicantIsStudent && form.selectedPlan ? { applicant: form.selectedPlan } : {}),
    minors: form.guardian
      ? form.minors
          .filter((minor) => minor.selectedPlan)
          .map((minor) => minor.selectedPlan as EnrolmentPlanChoice)
      : [],
  };
  const beltsUnavailable = (dateOfBirth: string) =>
    beltsForAge(definitions, dateOfBirth ? ageOnDate(dateOfBirth, effectiveDate) : 0).length === 0;
  // An experienced trial student at Town whose belts could not be offered goes to the office as a
  // beginner, and the office confirms the level. West never takes a beginner, so there the belt
  // stays required and the form refuses to send without it.
  const declarationToSend = (student: MinorForm | ApplicantForm): EnrolmentLevelDeclaration =>
    student.declaration.experience === "experienced" &&
    student.declaration.declaredLevelKey === null &&
    student.trainingCenter === "Town" &&
    student.selectedPlan === trialPlanChoice &&
    beltsUnavailable(student.dateOfBirth)
      ? beginnerDeclaration
      : student.declaration;
  // One declaration per student the plan selections name, in the same order: the contract reads
  // them side by side and a trial without its declaration is refused.
  const levelDeclarations = {
    ...(form.applicantIsStudent && form.selectedPlan ? { applicant: declarationToSend(form) } : {}),
    minors: form.guardian
      ? form.minors.filter((minor) => minor.selectedPlan).map(declarationToSend)
      : [],
  };
  const paymentTotal = enrolmentPaymentTotal(selections);
  const isTrial = [selections.applicant, ...selections.minors].some(
    (plan) => plan === trialPlanChoice,
  );
  const [requestId, setRequestId] = useState(createEnrolmentRequestId);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    stepHeading.current?.focus();
  }, [step]);
  const [requests, setRequests] = useState<readonly EnrolmentRequestClientView[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const signedIn = status === "signed-in";
  const bankDetails = useEnrolmentBankDetails(
    signedIn && session ? `${session.uid}:${session.role ?? ""}` : undefined,
  );
  const alreadyStudent = session?.role === "guardian" || session?.role === "adultStudent";
  // Existing-member mode (spec 2026-09-30 §2): My plan links here with `?for=`.
  const requestedFor = useMemo((): Who | undefined => {
    const value = new URLSearchParams(globalThis.location?.search ?? "").get("for");
    return value === "child" || value === "self" || value === "both" ? value : undefined;
  }, []);
  const [existing, setExisting] = useState<Readonly<{ allowed: readonly Who[] }>>();
  const [existingFailed, setExistingFailed] = useState(false);
  const seededPhone = useRef("");
  useEffect(() => {
    if (!alreadyStudent || !requestedFor) return;
    let active = true;
    void (async () => {
      const people = await loadAccountPeople();
      const trains = people.some((person) => person.via === "self");
      const allowed: readonly Who[] = trains ? ["child"] : ["self", "child", "both"];
      // The holder's contact: their own client record when they train, else the family tutor.
      const [own, family] = await Promise.all([
        trains ? getClientProfile() : undefined,
        trains ? undefined : getFamily(),
      ]);
      const contact = own
        ? {
            fullName: own.user.displayName,
            email: own.user.email ?? "",
            phoneNumber: own.user.phoneNumber ?? "",
          }
        : family
          ? {
              fullName: family.tutor.displayName,
              email: family.tutor.email ?? "",
              phoneNumber: family.tutor.phoneNumber ?? "",
            }
          : undefined;
      if (!contact) throw new Error("No account contact");
      seededPhone.current = contact.phoneNumber;
      if (!active) return;
      const start = allowed.includes(requestedFor) ? requestedFor : allowed[0]!;
      setForm((current) => ({
        ...withWho(current, start),
        ...contact,
        ...(own?.student.dateOfBirth ? { dateOfBirth: own.student.dateOfBirth } : {}),
        // The holder is the child's emergency contact, never their own (review M4).
        ...(start === "child"
          ? {
              emergencyName: contact.fullName,
              emergencyRelationship: "Parent",
              emergencyPhone: contact.phoneNumber,
            }
          : {}),
        minors: start === "self" || current.minors.length > 0 ? current.minors : [emptyMinor],
      }));
      setExisting({ allowed });
    })().catch(() => {
      if (active) setExistingFailed(true);
    });
    return () => {
      active = false;
    };
  }, [alreadyStudent, requestedFor]);
  const whoOptions = existing
    ? allWhoOptions.filter((option) => existing.allowed.includes(option.value))
    : allWhoOptions;

  // The belts need a signed-in account: ask once the session is ready, not while it is restoring.
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    // ponytail: three tries cover a cold start; after that the belts are reported unavailable.
    void (async () => {
      for (let attempt = 0; attempt < 3 && active; attempt += 1) {
        try {
          const catalog = await getLevelCatalog();
          if (active) setDefinitions(catalog.definitions);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
      if (active) setCatalogLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    void listMyEnrolmentRequests()
      .then((items) => {
        if (active) setRequests(items);
      })
      .catch(() => {
        if (active) {
          setRequests([]);
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [signedIn]);

  /**
   * El prellenado es una cortesía: siembra el nombre y el correo de la sesión una vez y no vuelve
   * a tocarlos. Dejar de sembrarlos cuando el campo está vacío era el bug: `form.email.length` y
   * `form.fullName.length` estaban en el array de dependencias, así que al borrar el último
   * carácter la longitud pasaba a 0, el efecto se volvía a ejecutar y reescribía el valor. Vaciar
   * el campo era imposible.
   *
   * La guarda es una referencia a lo ya sembrado, no la longitud del campo. Con ella un refresco
   * de sesión que devuelve el mismo correo no reescribe lo que el solicitante acaba de vaciar, y
   * un cambio de cuenta —correo distinto— sí siembra de nuevo, que es lo que un usuario esperaría
   * al iniciar sesión con otra identidad.
   */
  const seededEmail = useRef<string | undefined>(undefined);
  const seededFullName = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Existing-member mode fills these from the account instead.
    if (requestedFor && alreadyStudent) return;
    const email = session?.email;
    if (email && seededEmail.current !== email) {
      seededEmail.current = email;
      setForm((current) => ({ ...current, email }));
    }
    const displayName = session?.displayName;
    if (displayName && seededFullName.current !== displayName) {
      seededFullName.current = displayName;
      setForm((current) => ({ ...current, fullName: displayName }));
    }
  }, [session?.email, session?.displayName, requestedFor, alreadyStudent]);

  // Anything the applicant still holds, not only what they can still act on. A request the academy
  // is processing, or one whose approval stopped, has to show its state: dropping back to a blank
  // form would invite a second submission the server is going to refuse anyway.
  const openRequest = useMemo(
    () =>
      // A request still in progress wins over an older approved one (review M6).
      requests?.find(
        (request) => request.status !== "withdrawn" && request.status !== "approved",
      ) ??
      (existing ? undefined : requests?.find((request) => request.status === "approved")),
    [requests, existing],
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    const problem = validate(form, requestId, effectiveDate);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage(undefined);
    if (
      step !== "details" &&
      ((form.applicantIsStudent && !form.selectedPlan) ||
        (form.guardian && form.minors.some((minor) => !minor.selectedPlan)))
    ) {
      setMessage("Choose an available plan for every student.");
      return;
    }
    // Somebody who has trained before names the belt they train at. Without a catalogue the belt
    // cannot be picked: Town still takes the request (the office confirms the level), West does not.
    const beltMissing = [
      ...(form.applicantIsStudent ? [form] : []),
      ...(form.guardian ? form.minors : []),
    ].filter((student) => {
      const declaration = declarationToSend(student);
      return declaration.experience === "experienced" && declaration.declaredLevelKey === null;
    });
    if (beltMissing.some((student) => !beltsUnavailable(student.dateOfBirth))) {
      setMessage("Choose a belt for every student who has trained before.");
      return;
    }
    if (beltMissing.some((student) => student.trainingCenter === "West")) {
      setMessage(
        "Belt selection is unavailable right now, and West needs your belt. Try again later, or choose Town in your details.",
      );
      return;
    }
    // The belt is picked next to the experience answer, so it is checked before the plans step.
    if (step === "details") {
      setStep("plans");
      return;
    }
    if (step === "plans") {
      setProofId(undefined);
      setStep("payment");
      return;
    }
    if (
      paymentTotal > 0 &&
      ((!proof && !proofId) || !paidOn || paidOn > effectiveDate || !reference.trim())
    ) {
      setMessage("Add the transfer date, reference and a PNG or JPEG screenshot before sending.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const uploaded =
        paymentTotal > 0
          ? (proofId ?? (await uploadEnrolmentPaymentProof(requestId, proof!)))
          : undefined;
      if (uploaded) setProofId(uploaded);
      const parsed = parseEnrolmentRequestSubmission(
        {
          ...toDetails(form, requestId),
          ...(existing ? { existingMember: true } : {}),
          planSelections: selections,
          levelDeclarations,
          ...(uploaded
            ? {
                payment: {
                  proofId: uploaded,
                  amountMinor: paymentTotal,
                  paidOn,
                  reference: reference.trim(),
                },
              }
            : {}),
        },
        effectiveDate,
      );
      if (!parsed.ok)
        throw new Error(
          parsed.error[0]?.code === "beginner_must_start_at_town"
            ? "Beginners start at Town with the Introduction Class."
            : "Check your selected plans and payment details before sending.",
        );
      const saved = await submitEnrolmentRequest(parsed.value);
      setRequests([saved, ...(requests ?? [])]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send your request.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function withdraw(enrolmentRequestId: string): Promise<void> {
    setBusy(true);
    setMessage(undefined);
    try {
      const updated = await withdrawEnrolmentRequest(enrolmentRequestId);
      setStep("details");
      setRequestId(createEnrolmentRequestId());
      setProof(undefined);
      setProofId(undefined);
      setRequests((current) =>
        (current ?? []).map((item) =>
          item.enrolmentRequestId === updated.enrolmentRequestId ? updated : item,
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to withdraw your request.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return <div className="client-auth-loading" aria-busy="true" />;
  }

  if (!signedIn) {
    return (
      <main className="enrol-page" id="main-content" aria-labelledby="enrol-title">
        <p className="account-eyebrow">BPT Jersey / Join</p>
        <h1 id="enrol-title">Join the academy</h1>
        <p className="client-destination-intro">
          Sign in first so the academy knows who is asking, then fill in one form. Nothing is
          confirmed until reception reviews it.
        </p>
        <a className="button button-primary" href="/login?returnTo=%2Fenrol">
          Sign in to apply
        </a>
      </main>
    );
  }

  if (alreadyStudent && requests === undefined) {
    return (
      <main className="enrol-page" id="main-content">
        <p role="status">Checking your registration…</p>
      </main>
    );
  }
  if (alreadyStudent && loadFailed) {
    return (
      <main className="enrol-page" id="main-content">
        <p role="alert">
          We could not check your registration. Reload this page to try again, or contact the
          academy.
        </p>
        <a className="button button-primary" href="/account">
          Go to your account
        </a>
      </main>
    );
  }
  if (alreadyStudent && requestedFor && existingFailed) {
    return (
      <main className="enrol-page" id="main-content">
        <p role="alert">
          We could not load your account details. Reload this page to try again, or contact the
          academy.
        </p>
        <a className="button button-primary" href="/account/membership">
          Back to My plan
        </a>
      </main>
    );
  }
  if (alreadyStudent && requestedFor && !existing) {
    return (
      <main className="enrol-page" id="main-content">
        <p role="status">Loading your details…</p>
      </main>
    );
  }
  if (alreadyStudent && !existing && (!openRequest || openRequest.status === "approved")) {
    return (
      <main className="enrol-page" id="main-content" aria-labelledby="enrol-title">
        <p className="account-eyebrow">BPT Jersey / Join</p>
        <h1 id="enrol-title">You are already enrolled</h1>
        <p className="client-destination-intro">
          The academy has your place. Your profile, classes and waiver live in your account.
        </p>
        <a className="button button-primary" href="/account">
          Go to your account
        </a>
      </main>
    );
  }

  return (
    <main className="enrol-page" id="main-content" aria-labelledby="enrol-title">
      <p className="account-eyebrow">BPT Jersey / Join</p>
      <h1 id="enrol-title">{existing ? "Add to your account" : "Join the academy"}</h1>
      <p className="client-destination-intro">
        {existing
          ? "Your details are filled in from your account. Add who is joining, accept the waiver and choose a plan. The academy reviews it before confirming."
          : "Complete your details, then choose a plan for each student. The academy reviews your request before confirming your registration."}
      </p>

      {message ? (
        <p className="enrol-message" role="alert">
          {message}
        </p>
      ) : null}
      {loadFailed ? (
        <p className="enrol-message" role="status">
          We could not check whether you already have a request open. You can still send one.
        </p>
      ) : null}

      {openRequest ? (
        <StatusCard
          busy={busy}
          onWithdraw={() => void withdraw(openRequest.enrolmentRequestId)}
          request={openRequest}
        />
      ) : (
        <form className="enrol-form" noValidate onSubmit={(event) => void submit(event)}>
          <ol className="enrol-steps" aria-label="Registration progress">
            <li aria-current={step === "details" ? "step" : undefined}>1. Your details</li>
            <li aria-current={step === "plans" ? "step" : undefined}>2. Choose plans</li>
            <li aria-current={step === "payment" ? "step" : undefined}>3. Payment and review</li>
          </ol>
          {step === "details" ? (
            <>
              <fieldset className="enrol-who">
                <legend>Who is joining</legend>
                {whoOptions.map((option) => (
                  <label htmlFor={`enrol-who-${option.value}`} key={option.value}>
                    <input
                      checked={who(form) === option.value}
                      id={`enrol-who-${option.value}`}
                      name="enrol-who"
                      onChange={() => setForm(withWho(form, option.value))}
                      type="radio"
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>

              <fieldset className="enrol-applicant">
                <legend>{form.guardian ? "Your details as the guardian" : "Your details"}</legend>
                {existing ? (
                  <p className="enrol-hint">
                    Name, phone and email come from your account. To change them, go to Settings.
                  </p>
                ) : null}
                <label className="enrol-field" htmlFor="enrol-name">
                  Full name
                  <input
                    autoComplete="name"
                    id="enrol-name"
                    readOnly={existing !== undefined}
                    maxLength={160}
                    onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                    value={form.fullName}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-dob">
                  Date of birth
                  <input
                    autoComplete="bday"
                    id="enrol-dob"
                    onChange={(event) =>
                      setForm({
                        ...form,
                        dateOfBirth: event.target.value,
                        selectedPlan: trialPlanChoice,
                        declaration: { ...form.declaration, declaredLevelKey: null },
                      })
                    }
                    type="date"
                    value={form.dateOfBirth}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-phone">
                  Phone (required)
                  <input
                    autoComplete="tel"
                    id="enrol-phone"
                    // An account without a phone must still be able to add one here (review M5).
                    readOnly={existing !== undefined && Boolean(seededPhone.current)}
                    maxLength={64}
                    onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })}
                    type="tel"
                    value={form.phoneNumber}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-email">
                  Email
                  <input
                    autoComplete="email"
                    id="enrol-email"
                    readOnly={existing !== undefined}
                    maxLength={320}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    type="email"
                    value={form.email}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-gender">
                  Gender
                  <select
                    id="enrol-gender"
                    onChange={(event) => setForm({ ...form, gender: event.target.value as Gender })}
                    value={form.gender}
                  >
                    {genderOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {form.applicantIsStudent ? (
                  <>
                    <ExperienceQuestion
                      id="enrol-experience"
                      child={false}
                      experience={form.declaration.experience}
                      onChange={(experience) =>
                        setForm(placeStudent(form, experience, form.trainingCenter))
                      }
                    />
                    <BeltPicker
                      id="enrol-level"
                      dateOfBirth={form.dateOfBirth}
                      declaration={form.declaration}
                      definitions={definitions}
                      loading={catalogLoading}
                      onChange={(declaration) => setForm({ ...form, declaration })}
                    />
                    <label className="enrol-field" htmlFor="enrol-center">
                      Training centre
                      <select
                        id="enrol-center"
                        onChange={(event) =>
                          setForm(
                            placeStudent(
                              form,
                              form.declaration.experience,
                              event.target.value as Center,
                            ),
                          )
                        }
                        value={form.trainingCenter}
                      >
                        {centerOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <TownNotice
                      adult={!form.dateOfBirth || ageOnDate(form.dateOfBirth, effectiveDate) >= 16}
                      shown={form.movedToTown}
                    />
                    <fieldset className="enrol-preferences">
                      <legend>Training times</legend>
                      {preferenceOptions.map((option) => (
                        <label key={option.value} htmlFor={`enrol-time-${option.value}`}>
                          <input
                            checked={form.trainingTimePreferences.includes(option.value)}
                            id={`enrol-time-${option.value}`}
                            onChange={() =>
                              setForm({
                                ...form,
                                trainingTimePreferences: togglePreference(
                                  form.trainingTimePreferences,
                                  option.value,
                                ),
                              })
                            }
                            type="checkbox"
                          />
                          {option.label}
                        </label>
                      ))}
                    </fieldset>
                  </>
                ) : null}
              </fieldset>

              <fieldset className="enrol-emergency">
                <legend>Emergency contact</legend>
                <p className="enrol-hint">
                  Optional here, and required before the first class. The academy stores it with the
                  student record and nowhere else.
                </p>
                <label className="enrol-field" htmlFor="enrol-emergency-name">
                  Name
                  <input
                    id="enrol-emergency-name"
                    maxLength={160}
                    onChange={(event) => setForm({ ...form, emergencyName: event.target.value })}
                    value={form.emergencyName}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-emergency-relationship">
                  Relationship
                  <input
                    id="enrol-emergency-relationship"
                    maxLength={64}
                    onChange={(event) =>
                      setForm({ ...form, emergencyRelationship: event.target.value })
                    }
                    value={form.emergencyRelationship}
                  />
                </label>
                <label className="enrol-field" htmlFor="enrol-emergency-phone">
                  Phone
                  <input
                    id="enrol-emergency-phone"
                    maxLength={64}
                    onChange={(event) => setForm({ ...form, emergencyPhone: event.target.value })}
                    type="tel"
                    value={form.emergencyPhone}
                  />
                </label>
              </fieldset>

              {form.guardian ? (
                <section className="enrol-minors" aria-labelledby="enrol-minors-title">
                  <h2 id="enrol-minors-title">Children joining</h2>
                  {form.minors.map((minor, index) => (
                    <MinorFields
                      index={index}
                      definitions={definitions}
                      catalogLoading={catalogLoading}
                      key={index}
                      minor={minor}
                      onChange={(next) =>
                        setForm({
                          ...form,
                          minors: form.minors.map((item, position) =>
                            position === index ? next : item,
                          ),
                        })
                      }
                      onRemove={() =>
                        setForm({
                          ...form,
                          minors: form.minors.filter((_item, position) => position !== index),
                        })
                      }
                    />
                  ))}
                  <button
                    className="button button-secondary"
                    disabled={form.minors.length >= maximumEnrolmentRequestMinors}
                    onClick={() =>
                      setForm({ ...form, minors: [...form.minors, { ...emptyMinor }] })
                    }
                    type="button"
                  >
                    Add a child
                  </button>
                </section>
              ) : null}

              <WaiverTerms
                accepted={form.waiverAccepted}
                onChange={(next) => setForm({ ...form, waiverAccepted: next })}
              />

              <button className="button button-primary" type="submit">
                Continue to plans
              </button>
            </>
          ) : step === "plans" ? (
            <>
              <h2 ref={stepHeading} tabIndex={-1}>
                Choose your plans
              </h2>
              <p className="enrol-hint">
                Select one plan for each student. Your choices will be sent to the academy for
                approval.
              </p>
              {form.applicantIsStudent ? (
                <EnrolmentPlanChoices
                  id="applicant"
                  fullName={form.fullName}
                  dateOfBirth={form.dateOfBirth}
                  trainingCenter={form.trainingCenter}
                  effectiveDate={effectiveDate}
                  selectedPlan={form.selectedPlan}
                  declaration={form.declaration}
                  age={form.dateOfBirth ? ageOnDate(form.dateOfBirth, effectiveDate) : 0}
                  disabled={busy}
                  onChange={(selectedPlan) => setForm({ ...form, selectedPlan })}
                />
              ) : null}
              {form.guardian &&
                form.minors.map((minor, index) => (
                  <EnrolmentPlanChoices
                    key={index}
                    id={`child-${index}`}
                    fullName={minor.fullName}
                    dateOfBirth={minor.dateOfBirth}
                    trainingCenter={minor.trainingCenter}
                    effectiveDate={effectiveDate}
                    selectedPlan={minor.selectedPlan}
                    declaration={minor.declaration}
                    age={minor.dateOfBirth ? ageOnDate(minor.dateOfBirth, effectiveDate) : 0}
                    disabled={busy}
                    onChange={(selectedPlan) =>
                      setForm({
                        ...form,
                        minors: form.minors.map((item, position) =>
                          position === index ? { ...item, selectedPlan } : item,
                        ),
                      })
                    }
                  />
                ))}
              <div className="hero-actions">
                <button
                  className="button button-secondary"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    setStep("details");
                    setMessage(undefined);
                  }}
                >
                  Back to details
                </button>
                <button className="button button-primary" disabled={busy} type="submit">
                  {paymentTotal > 0 ? "Continue to payment" : "Continue to review"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 ref={stepHeading} tabIndex={-1}>
                {paymentTotal > 0 ? "Payment and review" : "Review your registration"}
              </h2>
              {paymentTotal > 0 ? (
                <fieldset disabled={busy} className="enrol-applicant">
                  <legend>Bank transfer evidence</legend>
                  <EnrolmentBankDetails {...bankDetails} />
                  <p>
                    Transfer total: <strong>£{(paymentTotal / 100).toFixed(2)}</strong>. Upload one
                    screenshot covering the prepaid plans. Pay-as-you-go classes are paid separately
                    at class.
                  </p>
                  <label className="enrol-field">
                    Transfer date
                    <input
                      type="date"
                      max={effectiveDate}
                      value={paidOn}
                      onChange={(event) => setPaidOn(event.target.value)}
                    />
                  </label>
                  <label className="enrol-field">
                    Transfer reference
                    <input
                      maxLength={120}
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </label>
                  <label className="enrol-field">
                    Payment screenshot (PNG or JPEG, up to 2 MB)
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={(event) => {
                        setProof(event.target.files?.[0]);
                        setProofId(undefined);
                      }}
                    />
                  </label>
                  {proof ? (
                    <p role="status">
                      Selected: {proof.name}
                      {proofId ? " · uploaded" : ""}
                    </p>
                  ) : null}
                  <p className="enrol-hint">
                    Only academy administrators can review your screenshot. Registration remains
                    pending until they check the transfer.
                  </p>
                </fieldset>
              ) : (
                <p>
                  {isTrial
                    ? "No payment is required for a trial. Send your request and the academy will confirm your first free classes."
                    : "No payment or screenshot is required to register for Pay as you go. You can send your request now and pay for each class when you attend."}
                </p>
              )}
              <div className="hero-actions">
                <button
                  className="button button-secondary"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    setStep("plans");
                    setMessage(undefined);
                  }}
                >
                  Back to plans
                </button>
                <button className="button button-primary" disabled={busy} type="submit">
                  {busy ? "Sending request..." : "Send request to the academy"}
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </main>
  );
}

export default function EnrolPage() {
  return (
    <ClientAuthProvider>
      <ScopedEnrolContent />
    </ClientAuthProvider>
  );
}

function ScopedEnrolContent() {
  const { session } = useClientSession();
  return <EnrolContent key={`${session?.uid ?? "signed-out"}:${session?.role ?? "none"}`} />;
}
